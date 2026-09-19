import { notifyAuthExpired } from './authState';
import type { JournalQueuedCommand, JournalSyncResult } from '../storage/journalStore';

/**
 * Transport for the devotional journal.
 *
 * Every path here is `/api/me/journal…`. There is no member parameter anywhere in this file, and
 * there should never be one: the server has no route shaped that way, so a client method that
 * looked like it could fetch somebody else's writing would be describing a capability that does not
 * exist. See server/journal.ts.
 */

export interface JournalApiOptions {
  baseUrl: string;
  token: string;
  memberId: string;
  fetchImpl?: typeof fetch;
}

export interface RemoteJournalEntry {
  taskDate: string;
  body: string;
  revision: number;
  updatedAt: number | null;
}

const REQUEST_TIMEOUT_MS = 10_000;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Rebuilt from named keys, never passed through, so an unexpected field cannot reach the UI. */
function parseEntry(value: unknown): RemoteJournalEntry | null {
  const item = asObject(value);
  if (!item || typeof item.taskDate !== 'string' || typeof item.body !== 'string') return null;
  if (typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0) return null;
  const updatedAt = item.updatedAt;
  if (updatedAt !== null && typeof updatedAt !== 'number') return null;
  return { taskDate: item.taskDate, body: item.body, revision: item.revision, updatedAt: updatedAt as number | null };
}

export function createJournalApiClient(options: JournalApiOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${options.token}`, 'x-qingmu-member-id': options.memberId, 'content-type': 'application/json' };
  const noteAuth = (response: Response): void => {
    if (response.status === 401 && options.token) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token });
  };

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${options.baseUrl}${path}`, { headers, signal: abort.signal, ...init });
      noteAuth(response);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** One day. A day nobody has written comes back blank at revision 0, not as an error. */
    async getEntry(taskDate: string): Promise<RemoteJournalEntry | null> {
      const response = await request(`/api/me/journal/${encodeURIComponent(taskDate)}`);
      if (!response.ok) return null;
      return parseEntry(await response.json().catch(() => null));
    },

    /** A date range, for the journal tab and for export. */
    async listEntries(from: string, to: string): Promise<RemoteJournalEntry[] | null> {
      const response = await request(`/api/me/journal?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!response.ok) return null;
      const body = asObject(await response.json().catch(() => null));
      if (!body || !Array.isArray(body.entries)) return null;
      const entries = body.entries.map(parseEntry);
      return entries.every(Boolean) ? entries as RemoteJournalEntry[] : null;
    },

    /**
     * Send one queued save. The result is deliberately narrow: confirmed, superseded by another
     * device, or worth retrying. Anything the store cannot act on differently is a retry, because a
     * journal that quietly gives up on a save is worse than one that keeps trying.
     */
    async saveEntry(command: JournalQueuedCommand): Promise<JournalSyncResult> {
      const response = await request(`/api/me/journal/${encodeURIComponent(command.taskDate)}`, {
        method: 'PUT',
        body: JSON.stringify({
          operationId: command.operationId,
          expectedRevision: command.expectedRevision,
          planId: command.planId,
          body: command.body,
        }),
      });
      const body = asObject(await response.json().catch(() => null));
      if (response.ok && body && typeof body.revision === 'number') {
        return { ok: true, revision: body.revision, updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : Date.now() };
      }
      if (response.status === 409) {
        const error = asObject(body?.error);
        const details = asObject(error?.details);
        if (error?.code === 'JOURNAL_CHANGED') {
          return { ok: false, outcome: 'CONFLICT', revision: typeof details?.revision === 'number' ? details.revision : 0 };
        }
      }
      // A rejected body (too long, malformed) would loop forever if retried, so it is reported as a
      // conflict at the revision we already hold: the store stops, keeps the text, and tells the member.
      if (response.status === 400) return { ok: false, outcome: 'CONFLICT', revision: command.expectedRevision };
      return { ok: false, outcome: 'RETRY' };
    },
  };
}
