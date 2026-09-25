import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Who signed up for an upcoming gathering, as far as members' friends are concerned.
 *
 * The sign-up form lives in the owner's Google Drive. An Apps Script there sends only each
 * respondent's name and chosen dates; the LINE ID and age columns never leave Google. This module
 * keeps only the members a name could be matched to, plus a head count per date. Names it cannot
 * match are dropped, never stored or logged, and a member reading a date sees the count, whether
 * they signed up themselves, and the names of their own friends only.
 */

export interface FormRegistrationPush {
  formTitle?: string;
  responses: Array<{ name: string; dates: string[] }>;
}

export interface EventRegistrationView {
  date: string;
  total: number;
  registered: boolean;
  friends: string[];
}

const KEY_LABEL = 'qingmu:form-registrations:v1';
const DAY_MS = 86_400_000;

/** The push key is derived from the session secret, so the deployment needs no new secret. */
export function deriveFormRegistrationKey(sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(KEY_LABEL).digest('hex');
}

export function formRegistrationKeyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Instead of a key, the Apps Script can send the Google identity token it runs with
 * (ScriptApp.getIdentityToken), so nothing secret has to be pasted anywhere. Google signs it for
 * the script project's own OAuth client (the audience). A token is accepted only for an admin's
 * account and only for one audience: the configured one, or else the first one accepted, which is
 * then kept, so a token another app obtained for the same account is refused.
 */
export interface FormSyncIdentity {
  /** Checks Google's signature, issuer and expiry, whatever the audience. */
  verify: (idToken: string) => Promise<{ subject: string; audience: string }>;
  ownerSubjects: string[];
  audience?: string;
}

export async function formSyncIdentityMatches(db: DatabaseSync, identity: FormSyncIdentity, idToken: string, now: Date): Promise<boolean> {
  let claims: { subject: string; audience: string };
  try {
    claims = await identity.verify(idToken);
  } catch {
    return false;
  }
  if (!identity.ownerSubjects.includes(claims.subject)) return false;
  if (identity.audience) return claims.audience === identity.audience;
  db.prepare('INSERT OR IGNORE INTO form_sync_audience(id, audience, pinned_at) VALUES(1, ?, ?)').run(claims.audience, now.toISOString());
  const pinned = db.prepare('SELECT audience FROM form_sync_audience WHERE id = 1').get() as { audience: string };
  return pinned.audience === claims.audience;
}

export function ensureEventRegistrationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_registrations (
      event_date TEXT NOT NULL,
      member_id TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(event_date, member_id)
    );
    CREATE TABLE IF NOT EXISTS event_registration_totals (
      event_date TEXT PRIMARY KEY,
      total INTEGER NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS form_sync_audience (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      audience TEXT NOT NULL,
      pinned_at TEXT NOT NULL
    );
  `);
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '');
}

function taipeiDay(date: Date): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** "9/27（六）" or "10月4日" → ISO dates, placed in the year that keeps them within half a year of now. */
export function parseEventDates(label: string, now: Date): string[] {
  const today = taipeiDay(now);
  const year = Number(today.slice(0, 4));
  const found = new Set<string>();
  for (const match of label.normalize('NFKC').matchAll(/(\d{1,2})\s*[/月]\s*(\d{1,2})/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let best: string | null = null;
    for (const candidateYear of [year - 1, year, year + 1]) {
      const iso = `${candidateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const time = Date.parse(`${iso}T00:00:00Z`);
      if (Number.isNaN(time) || new Date(time).getUTCDate() !== day) continue;
      if (Math.abs(time - Date.parse(`${today}T00:00:00Z`)) <= 183 * DAY_MS) best = iso;
    }
    if (best) found.add(best);
  }
  return [...found];
}

function matcher(db: DatabaseSync): (name: string) => string | null {
  const members = (db.prepare('SELECT id, display_name FROM members WHERE disabled_at IS NULL OR disabled_at = 0').all() as Array<{ id: string; display_name: string }>)
    .map((member) => ({ id: member.id, name: normalizeName(member.display_name) }))
    .filter((member) => member.name.length > 0);
  return (raw) => {
    const name = normalizeName(raw);
    if (!name) return null;
    const exact = members.filter((member) => member.name === name);
    if (exact.length > 0) return exact.length === 1 ? exact[0].id : null;
    // A member saved by given name (光佑) matches the form's full name (林光佑), only when unambiguous.
    const bySuffix = members.filter((member) => member.name.length >= 2 && name.length > member.name.length && name.endsWith(member.name));
    return bySuffix.length === 1 ? bySuffix[0].id : null;
  };
}

export function readFormRegistrationPush(body: unknown): FormRegistrationPush | null {
  if (!body || typeof body !== 'object') return null;
  const responses = (body as { responses?: unknown }).responses;
  if (!Array.isArray(responses) || responses.length > 5000) return null;
  const clean: FormRegistrationPush['responses'] = [];
  for (const row of responses) {
    const name = (row as { name?: unknown })?.name;
    const dates = (row as { dates?: unknown })?.dates;
    if (typeof name !== 'string' || name.length > 80 || !Array.isArray(dates) || dates.length > 40) return null;
    if (!dates.every((label) => typeof label === 'string' && label.length <= 200)) return null;
    clean.push({ name, dates: dates as string[] });
  }
  return { responses: clean };
}

/**
 * Each push is the whole picture for upcoming dates: dates from yesterday on are replaced, so a
 * cancelled sign-up disappears; earlier dates are left as they were.
 */
export function replaceEventRegistrations(db: DatabaseSync, push: FormRegistrationPush, now: Date): Array<{ date: string; total: number; matched: number }> {
  const match = matcher(db);
  const byDate = new Map<string, { names: Set<string>; members: Set<string> }>();
  for (const response of push.responses) {
    const name = normalizeName(response.name);
    if (!name) continue;
    const memberId = match(response.name);
    for (const label of response.dates) {
      for (const date of parseEventDates(label, now)) {
        const entry = byDate.get(date) ?? { names: new Set<string>(), members: new Set<string>() };
        entry.names.add(name);
        if (memberId) entry.members.add(memberId);
        byDate.set(date, entry);
      }
    }
  }
  const syncedAt = now.toISOString();
  const from = taipeiDay(new Date(now.getTime() - DAY_MS));
  const insertMember = db.prepare('INSERT INTO event_registrations(event_date, member_id, synced_at) VALUES(?,?,?)');
  const upsertTotal = db.prepare('INSERT INTO event_registration_totals(event_date, total, synced_at) VALUES(?,?,?) ON CONFLICT(event_date) DO UPDATE SET total = excluded.total, synced_at = excluded.synced_at');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM event_registrations WHERE event_date >= ?').run(from);
    db.prepare('DELETE FROM event_registration_totals WHERE event_date >= ?').run(from);
    for (const [date, entry] of byDate) {
      if (date < from) continue;
      for (const memberId of entry.members) insertMember.run(date, memberId, syncedAt);
      upsertTotal.run(date, entry.names.size, syncedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return [...byDate.entries()]
    .filter(([date]) => date >= from)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entry]) => ({ date, total: entry.names.size, matched: entry.members.size }));
}

export function getEventRegistrationView(db: DatabaseSync, viewerId: string, date: string): EventRegistrationView {
  const totalRow = db.prepare('SELECT total FROM event_registration_totals WHERE event_date = ?').get(date) as { total: number } | undefined;
  const registered = Boolean(db.prepare('SELECT 1 FROM event_registrations WHERE event_date = ? AND member_id = ?').get(date, viewerId));
  const friends = (db.prepare(`SELECT m.display_name AS name FROM event_registrations r
      JOIN friendships f ON (f.member_low = ? AND f.member_high = r.member_id) OR (f.member_high = ? AND f.member_low = r.member_id)
      JOIN members m ON m.id = r.member_id AND (m.disabled_at IS NULL OR m.disabled_at = 0)
      WHERE r.event_date = ?`).all(viewerId, viewerId, date) as Array<{ name: string }>)
    .map((row) => row.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { date, total: totalRow?.total ?? 0, registered, friends };
}
