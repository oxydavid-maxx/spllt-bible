import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  repository: null as any, listeners: new Set<(value: string) => void>(), focused: true,
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, epoch: 1 },
  read: vi.fn(), save: vi.fn(),
}));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, AppState: { currentState: 'active', addEventListener: (_: string, fn: (s: string) => void) => { state.listeners.add(fn); return { remove: () => state.listeners.delete(fn) }; } } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined }));
vi.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => require('react').useEffect(() => state.focused ? fn() : undefined, [fn, state.focused]) }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.auth, getAuthSnapshot: () => state.auth, isCurrentAuthSession: () => true }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: () => state.repository }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: state.read, saveCompletion: state.save }) }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: async () => undefined }));
import { createMobileRepository } from '../../src/storage/mobileRepository';
import { useCompletionController, type UseCompletionControllerValue } from '../../src/services/useCompletionController';
import { getReadingPlan, getReadingSessionSnapshot, resetReadingPlan, setSelectedReadingDate } from '../../src/ui/readingSession';
let db: DatabaseSync; let tree: TestRenderer.ReactTestRenderer | null = null; let value: UseCompletionControllerValue;
const day = (taskDate = '2026-10-19', status = 'UNREPORTED', revision = 0, references = ['PSA.1']) => ({ taskDate, planId: 'church-2026-09', references, sourceRevision: 2, sourceDigest: 'fixture', status, revision, canComplete: true });
let remote = [day()];
function Harness() { value = useCompletionController({ planId: 'church-2026-09', taskDate: '2026-10-19', canComplete: true }); return React.createElement('Record', value.record); }
async function mount() { await act(async () => { tree = TestRenderer.create(React.createElement(Harness)); }); }
async function foreground() { await act(async () => { state.listeners.forEach(fn => fn('background')); state.listeners.forEach(fn => fn('active')); }); }
async function focus() { await act(async () => { state.focused = false; tree!.update(React.createElement(Harness)); }); await act(async () => { state.focused = true; tree!.update(React.createElement(Harness)); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T04:00:00Z'));
  db = new DatabaseSync(':memory:'); state.repository = createMobileRepository({ execSync: s => db.exec(s), runSync: (s, ...p) => db.prepare(s).run(...p as any[]), getFirstSync: (s, ...p) => db.prepare(s).get(...p as any[]) as any, getAllSync: (s, ...p) => db.prepare(s).all(...p as any[]) as any });
  state.focused = true; remote = [day()]; state.read.mockReset().mockImplementation(async () => ({ today: '2026-10-19', timezone: 'Asia/Taipei', days: remote }));
  state.save.mockReset().mockResolvedValue({ ok: false, conflict: false, error: 'NETWORK_ERROR' }); resetReadingPlan(); setSelectedReadingDate('2026-10-19');
});
afterEach(() => { act(() => tree?.unmount()); tree = null; db.close(); vi.useRealTimers(); resetReadingPlan(); });
it('uses a successful remote schedule, including corrections, additions and deletions, without idle reads (1)', async () => {
  await mount();
  expect(getReadingSessionSnapshot().day?.references).toEqual(['PSA.1']);
  const initial = state.read.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); }); expect(state.read).toHaveBeenCalledTimes(initial);
  remote = [day('2026-10-19', 'UNREPORTED', 0, ['REV.2']), day('2026-10-20', 'UNREPORTED', 0, ['REV.3'])];
  await foreground(); expect(state.read).toHaveBeenCalledTimes(initial + 1);
  expect(getReadingSessionSnapshot().day?.references).toEqual(['REV.2']);
  expect(getReadingPlan().dates).toContain('2026-10-20'); expect(getReadingPlan().dates).not.toContain('2026-10-21');
  remote = [day('2026-10-20')]; await focus();
  expect(getReadingSessionSnapshot().selectedDate).toBe('2026-10-19'); expect(getReadingSessionSnapshot().day).toBeUndefined();
});
it('refreshes completed and undone records from another phone on foreground and tab return, once and never idle (2)', async () => {
  await mount(); const initial = state.read.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(600_000); }); expect(state.read).toHaveBeenCalledTimes(initial);
  remote = [day('2026-10-19', 'COMPLETED', 1)]; await foreground();
  expect(value.record).toMatchObject({ status: 'COMPLETED', revision: 1, syncStatus: 'CONFIRMED' });
  expect(state.read).toHaveBeenCalledTimes(initial + 1);
  remote = [day('2026-10-19', 'NOT_COMPLETED', 2)]; await focus();
  expect(value.record).toMatchObject({ status: 'NOT_COMPLETED', revision: 2 });
});
it('never overwrites a local pending completion with a remote read that finishes after the tap (2)', async () => {
  await mount();
  let resolve!: (v: unknown) => void; state.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await foreground(); expect(state.read).toHaveBeenCalledTimes(2);
  await act(async () => { await value.complete(); });
  expect(value.record.syncStatus).toBe('PENDING_SAVE');
  await act(async () => { resolve({ today: '2026-10-19', timezone: 'Asia/Taipei', days: [day('2026-10-19', 'NOT_COMPLETED', 8)] }); });
  expect(value.record).toMatchObject({ status: 'COMPLETED', syncStatus: 'PENDING_SAVE' });
  expect(state.repository.pendingCount()).toBe(1);
});
it('retains the bundled schedule when the remote read fails (1)', async () => {
  state.read.mockRejectedValue(new Error('offline')); const before = getReadingSessionSnapshot().day;
  await mount(); expect(getReadingSessionSnapshot().day).toEqual(before);
});


it('uses the unchanged public reading-days/completion routes for cross-phone updates within their 62-day contract (1/2)', async () => {
  const { createDatabase } = await import('../../server/db');
  const { createApiHandler } = await import('../../server/routes');
  const { createApiClient } = await vi.importActual<typeof import('../../src/services/apiClient')>('../../src/services/apiClient');
  const server = createDatabase({ members: [{ id: 'fixture:self', displayName: 'Fixture', groupId: 'G01' }] });
  const api = createApiHandler({ db: server, fixtureToken: 'token', now: () => new Date('2026-10-19T04:00:00Z') });
  const requests: string[] = [];
  const client = createApiClient({ baseUrl: 'https://fixture.test', memberId: 'fixture:self', token: 'token', fetchImpl: (async (url: string, init?: RequestInit) => {
    requests.push(url);
    const response = await api({ method: init?.method ?? 'GET', url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body as string | undefined });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof fetch });
  const previous = state.auth.session;
  state.auth.session = { memberId: 'fixture:self', sessionToken: 'token' };
  let lastRead: ReturnType<typeof client.getReadingDays>;
  state.read.mockImplementation((from, to) => { lastRead = client.getReadingDays(from, to); return lastRead; });
  try {
    await mount(); await act(async () => { await lastRead; }); expect(value.record.status).toBe('UNREPORTED');
    server.db.prepare('UPDATE reading_days SET references_json = ?, source_revision = 9 WHERE task_date = ?').run(JSON.stringify(['REV.9']), '2026-10-19');
    server.db.prepare('DELETE FROM reading_days WHERE task_date = ?').run('2026-10-20');
    const write = await client.saveCompletion({ memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-10-19', desiredStatus: 'COMPLETED', operationId: 'other-phone', expectedRevision: 0, syncStatus: 'PENDING_SAVE' });
    expect(write.ok).toBe(true);
    await foreground(); await act(async () => { await lastRead; });
    expect(value.record).toMatchObject({ status: 'COMPLETED', syncStatus: 'CONFIRMED' });
    expect(getReadingSessionSnapshot().day?.references).toEqual(['REV.9']);
    expect(getReadingPlan().dates).not.toContain('2026-10-20');
    expect(requests.filter(url => url.includes('/api/me/reading-days'))).toHaveLength(2);
    for (const input of requests.filter(url => url.includes('/api/me/reading-days'))) {
      const url = new URL(input); expect((Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!)) / 86_400_000 + 1).toBeLessThanOrEqual(62);
    }
  } finally { server.db.close(); state.auth.session = previous; }
});


it('starts a fresh visible read after a second foreground, and ignores the older in-flight answer (1/2)', async () => {
  await mount();
  let resolve!: (v: unknown) => void;
  state.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await foreground();
  remote = [day('2026-10-19', 'COMPLETED', 1, ['REV.8'])];
  await foreground();
  expect(state.read).toHaveBeenCalledTimes(3);
  expect(value.record.status).toBe('COMPLETED');
  await act(async () => { resolve({ today: '2026-10-19', timezone: 'Asia/Taipei', days: [day()] }); });
  expect(value.record.status).toBe('COMPLETED'); expect(getReadingSessionSnapshot().day?.references).toEqual(['REV.8']);
});
