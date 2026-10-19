import { getAppActiveRevision } from './appVisibility';
import type { ReadingDaySnapshot } from './apiClient';
import type { AuthSession } from './authSession';

type Snapshot = { today: string; timezone: string; days: ReadingDaySnapshot[] } | null;
const reads = new Map<string, Promise<Snapshot>>();
/** Coalesce simultaneous visible consumers only. Settled answers are never a permanent cache. */
export function readReadingDays(session: AuthSession, from: string, to: string, load: () => Promise<Snapshot>): Promise<Snapshot> {
  const key = JSON.stringify([session.memberId, session.sessionToken, from, to, getAppActiveRevision()]);
  const existing = reads.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(load); reads.set(key, request);
  const clear = () => { if (reads.get(key) === request) reads.delete(key); };
  void request.then(clear, clear);
  return request;
}

/** A departed entry cannot lend its still-pending answer to the next visit. */
export function forgetReadingDays(session: AuthSession): void {
  for (const key of reads.keys()) {
    const [memberId, token] = JSON.parse(key) as string[];
    if (memberId === session.memberId && token === session.sessionToken) reads.delete(key);
  }
}
