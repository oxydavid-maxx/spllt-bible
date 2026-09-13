import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { verifySessionToken } from './session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const deviceId = (token: string) => /^qmd_([0-9a-f-]{36})\.[A-Za-z0-9_-]{43}$/.exec(token)?.[1] ?? null;
function matchesHash(token: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(expected, 'hex'));
}
export function ensureMobileSessionSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('device','legacy-revocation')), created_at INTEGER NOT NULL, revoked_at INTEGER
  ); CREATE INDEX IF NOT EXISTS auth_sessions_member ON auth_sessions(member_id);`);
  const columns = db.prepare('PRAGMA table_info(members)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'disabled_at')) db.exec('ALTER TABLE members ADD COLUMN disabled_at INTEGER');
}
export function isMemberEnabled(db: DatabaseSync, memberId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM members WHERE id=? AND disabled_at IS NULL').get(memberId));
}
export function createDeviceSession(db: DatabaseSync, memberId: string) {
  if (!isMemberEnabled(db, memberId)) throw new Error('ACCOUNT_DISABLED');
  const id = randomUUID();
  const token = `qmd_${id}.${randomBytes(32).toString('base64url')}`;
  db.prepare('INSERT INTO auth_sessions(session_id,member_id,token_hash,kind,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)').run(id, memberId, hashToken(token), 'device', now());
  return { sessionToken: token, memberId, sessionKind: 'device' as const, expiresInSeconds: null };
}
export function resolveDeviceSession(db: DatabaseSync, token: string): string | null {
  const id = deviceId(token); if (!id) return null;
  const row = db.prepare(`SELECT s.member_id,s.token_hash FROM auth_sessions s JOIN members m ON m.id=s.member_id
    WHERE s.session_id=? AND s.kind='device' AND s.revoked_at IS NULL AND m.disabled_at IS NULL`).get(id) as { member_id: string; token_hash: string } | undefined;
  return row && matchesHash(token, row.token_hash) ? row.member_id : null;
}
export function isLegacySessionRevoked(db: DatabaseSync, token: string): boolean {
  return Boolean(db.prepare("SELECT session_id FROM auth_sessions WHERE token_hash=? AND kind='legacy-revocation'").get(hashToken(token)));
}
/** Exact bearer-scoped revoke. Repeats succeed; no client member/device ID is trusted. */
export function revokeSession(db: DatabaseSync, token: string, sessionSecret: string): boolean {
  const id = deviceId(token);
  if (id) {
    const row = db.prepare("SELECT token_hash FROM auth_sessions WHERE session_id=? AND kind='device'").get(id) as { token_hash: string } | undefined;
    if (!row || !matchesHash(token, row.token_hash)) return false;
    db.prepare('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE session_id=?').run(now(), id);
    return true;
  }
  const memberId = verifySessionToken(token, sessionSecret);
  if (!memberId) return false;
  const hash = hashToken(token);
  db.prepare("INSERT OR IGNORE INTO auth_sessions(session_id,member_id,token_hash,kind,created_at,revoked_at) VALUES(?,?,?,'legacy-revocation',?,?)").run(`legacy:${hash}`, memberId, hash, now(), now());
  return true;
}
