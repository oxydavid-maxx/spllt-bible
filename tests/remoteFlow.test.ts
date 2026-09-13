import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import { readReminderPreferences, saveReminderPreferences, registerDeviceDeliveryToken } from '../server/reminderPreferences';
import { importMeetingSchedules } from '../server/meetingSchedules';
import { createReminderWorker, discoverDueMeetingEvents } from '../server/reminderWorker';
import { sendDueMeetingEvent } from '../server/remoteReminders';
import { createRemoteConfiguration } from '../server/remoteConfiguration';
import { createHttpServer } from '../server/http';

const opened: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); for (const db of opened.splice(0)) db.close(); });
const due = new Date('2030-09-13T03:00:00.000Z');
const source = { sourceRef: 'isolated-test-authority', schedules: [{ memberId: 'test:a', rpgId: 'test:rpg', meetingId: 'test:m', title: 'Isolated test schedule', startsAt: '2030-09-13T03:30:00.000Z', timeZone: 'Asia/Taipei', revision: 1, status: 'SCHEDULED' as const }] };
function setup() {
  const db = createDatabase({ members: [{ id: 'test:a', displayName: 'Test A', groupId: 'test:g' }, { id: 'test:b', displayName: 'Test B', groupId: 'test:g2' }], groupProfiles: [{ memberId: 'test:a', groupId: 'test:g', groupName: 'Test G', rpgId: 'test:rpg', rpgName: 'Test RPG', linkStatus: 'READY', callUrl: 'https://example.test/keep-link' }] }); opened.push(db);
  return db;
}
function armed() {
  const db = setup();
  importMeetingSchedules(db.db, source, { apply: true });
  saveReminderPreferences(db.db, 'test:a', { readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 1 });
  registerDeviceDeliveryToken(db.db, { memberId: 'test:a', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 1 });
  return db;
}

describe('remote authoritative schedule and normal dispatcher', () => {
  it('excludes disabled accounts from normal discovery and rejects a previously discovered event before dispatch', async () => {
    const db = armed(); const queued = discoverDueMeetingEvents(db.db, due)[0];
    const send = vi.fn(async () => ({ messageId: 'must-not-send' }));
    db.db.prepare('UPDATE members SET disabled_at=1 WHERE id=?').run('test:a');
    expect(discoverDueMeetingEvents(db.db, due)).toEqual([]);
    const worker = createReminderWorker({ db: db.db, now: () => due, send });
    await worker.tick(); await sendDueMeetingEvent(db.db, queued, send, due);
    expect(send).not.toHaveBeenCalled();
  });
  it('fresh device validation rejects a disabled owner while exact device revoke still succeeds', async () => {
    const db = armed(); const api = createApiHandler({ db });
    db.db.prepare('UPDATE members SET disabled_at=1 WHERE id=?').run('test:a');
    const headers = { 'x-qingmu-installation-id': 'test:installation', 'x-qingmu-device-token': 'isolated-token' };
    expect(await api({ method: 'POST', url: '/api/device/reminders/validate', headers, body: JSON.stringify({ meeting_id: 'test:m', schedule_revision: 1 }) })).toMatchObject({ status: 403 });
    expect(await api({ method: 'POST', url: '/api/device/reminders/revoke', headers, body: JSON.stringify({ member_id: 'test:a', binding_version: 1, owner_generation: 1 }) })).toMatchObject({ status: 200, body: { revoked: true } });
  });
  it('rechecks account disablement after claiming and before the deferred provider invocation', async () => {
    const db = armed(); const send = vi.fn(async () => ({ messageId: 'must-not-send' }));
    const pending = sendDueMeetingEvent(db.db, discoverDueMeetingEvents(db.db, due)[0], send, due);
    db.db.prepare('UPDATE members SET disabled_at=1 WHERE id=?').run('test:a');
    await pending; expect(send).not.toHaveBeenCalled();
    expect(db.db.prepare('SELECT status FROM reminder_deliveries').get()).toMatchObject({ status: 'DROPPED' });
  });
  it('previews without writes, then imports only meeting fields of an existing member/RPG', () => {
    const db = setup();
    const before = db.db.prepare('SELECT * FROM member_group_profiles').all();
    expect(importMeetingSchedules(db.db, source)).toMatchObject({ applied: false, changed: 1 });
    expect(db.db.prepare('SELECT * FROM member_group_profiles').all()).toEqual(before);
    expect(importMeetingSchedules(db.db, source, { apply: true })).toMatchObject({ applied: true, changed: 1 });
    expect(db.db.prepare('SELECT call_url, group_name, rpg_name FROM member_group_profiles').get()).toMatchObject({ call_url: 'https://example.test/keep-link', group_name: 'Test G', rpg_name: 'Test RPG' });
    expect(readReminderPreferences(db.db, 'test:a').meetings[0]).toMatchObject({ meetingId: 'test:m', scheduleRevision: 1, triggerAt: due.toISOString() });
    expect(importMeetingSchedules(db.db, source, { apply: true })).toMatchObject({ changed: 0 });
  });
  it('rejects unknown targets and conflicting/stale revisions atomically', () => {
    const db = setup();
    expect(() => importMeetingSchedules(db.db, { ...source, schedules: [...source.schedules, { ...source.schedules[0], memberId: 'test:missing' }] }, { apply: true })).toThrow('UNKNOWN_MEETING_TARGET');
    expect(readReminderPreferences(db.db, 'test:a').meetings).toEqual([]);
    importMeetingSchedules(db.db, source, { apply: true });
    expect(() => importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], title: 'Conflicting revision' }] }, { apply: true })).toThrow('MEETING_REVISION_CONFLICT');
    importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], revision: 2, status: 'CANCELLED' }] }, { apply: true });
    expect(() => importMeetingSchedules(db.db, source, { apply: true })).toThrow('STALE_MEETING_REVISION');
  });
  it.each([{ startsAt: 'not-a-date' }, { startsAt: '2030-02-30T03:00:00Z' }, { timeZone: 'No/SuchZone' }, { revision: 0 }, { status: 'MAYBE' }])('rejects invalid authoritative schedule input %j', patch => {
    const db = setup();
    expect(() => importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], ...patch }] }, { apply: true })).toThrow(/INVALID_/);
    expect(readReminderPreferences(db.db, 'test:a').meetings).toEqual([]);
  });
  it('dispatches from the normal timer once and records the provider acknowledgment', async () => {
    const db = armed(); const send = vi.fn(async () => ({ messageId: 'projects/test/messages/isolated-1' }));
    const callbacks: Array<() => Promise<void>> = [];
    const worker = createReminderWorker({ db: db.db, now: () => due, send, timer: { setInterval: cb => { callbacks.push(cb); return cb; }, clearInterval: () => undefined } });
    worker.start(); worker.start(); expect(callbacks).toHaveLength(1);
    await callbacks[0](); await callbacks[0]();
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.db.prepare('SELECT status, provider_message_id FROM reminder_deliveries').get()).toMatchObject({ status: 'SENT', provider_message_id: 'projects/test/messages/isolated-1' });
    await worker.stop();
    importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], revision: 2 }] }, { apply: true });
    await callbacks[0](); // An already queued callback cannot dispatch after stop.
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rechecks cancellation, revision, preference and owner state before sending', async () => {
    const db = armed(); const send = vi.fn(async () => ({ messageId: 'must-not-send' }));
    const event = discoverDueMeetingEvents(db.db, due)[0];
    importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], revision: 2, status: 'CANCELLED' }] }, { apply: true });
    expect(await sendDueMeetingEvent(db.db, event, send, due)).toMatchObject({ decision: 'DROP_CANCELLED' });
    importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], revision: 3 }] }, { apply: true });
    expect(await sendDueMeetingEvent(db.db, event, send, due)).toMatchObject({ decision: 'DROP_STALE' });
    const current = discoverDueMeetingEvents(db.db, due)[0];
    saveReminderPreferences(db.db, 'test:a', { readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 2 });
    expect(await sendDueMeetingEvent(db.db, current, send, due)).toMatchObject({ decision: 'DROP_DISABLED' });
    expect(send).not.toHaveBeenCalled();
  });
  it('does not send expired events or a token reassigned to another member', async () => {
    const db = armed(); const event = discoverDueMeetingEvents(db.db, due)[0]; const send = vi.fn(async () => ({ messageId: 'must-not-send' }));
    expect(await sendDueMeetingEvent(db.db, event, send, new Date(due.getTime() + 301_000))).toMatchObject({ decision: 'DROP_EXPIRED' });
    registerDeviceDeliveryToken(db.db, { memberId: 'test:b', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 2 });
    expect(await sendDueMeetingEvent(db.db, event, send, due)).toMatchObject({ decision: 'DROP_UNKNOWN' });
    expect(send).not.toHaveBeenCalled();
  });
  it('claims before async transport so overlapping ticks do not send twice', async () => {
    const db = armed(); const event = discoverDueMeetingEvents(db.db, due)[0];
    let resolve!: (value: { messageId: string }) => void;
    const send = vi.fn(() => new Promise<{ messageId: string }>(done => { resolve = done; }));
    const first = sendDueMeetingEvent(db.db, event, send, due);
    expect(await sendDueMeetingEvent(db.db, event, send, due)).toMatchObject({ decision: 'UNKNOWN_RECONCILE' });
    resolve({ messageId: 'ack' }); await first; expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'empty-ack'])('keeps %s provider outcome UNKNOWN without blind retries', async outcome => {
    const db = armed(); let count = 0;
    const worker = createReminderWorker({ db: db.db, now: () => due, send: async () => { count++; if (outcome === 'throw') throw new Error('timeout-after-accept'); return { messageId: null }; } });
    await worker.tick(); await worker.tick();
    expect(count).toBe(1); expect(db.db.prepare('SELECT status FROM reminder_deliveries').get()).toMatchObject({ status: 'UNKNOWN' });
  });
  it('bounds an unresolved sender and ignores its late acknowledgment after UNKNOWN', async () => {
    vi.useFakeTimers();
    const db = armed(); const event = discoverDueMeetingEvents(db.db, due)[0];
    let resolve!: (value: { messageId: string }) => void;
    const pending = sendDueMeetingEvent(db.db, event, () => new Promise(done => { resolve = done; }), due, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ decision: 'UNKNOWN_RECONCILE' });
    resolve({ messageId: 'late-ack' }); await Promise.resolve();
    expect(db.db.prepare('SELECT status FROM reminder_deliveries').get()).toMatchObject({ status: 'UNKNOWN' });
  });
  it('device-validates fresh revision and bound member without trusting any requested owner', async () => {
    const db = armed(); const api = createApiHandler({ db });
    const request = (revision: number, token = 'isolated-token') => api({ method: 'POST', url: '/api/device/reminders/validate', headers: { 'x-qingmu-installation-id': 'test:installation', 'x-qingmu-device-token': token, 'x-qingmu-member-id': 'test:b' }, body: JSON.stringify({ meeting_id: 'test:m', schedule_revision: revision, member_id: 'test:b' }) });
    expect(await request(1)).toMatchObject({ status: 200, body: { valid: true, memberId: 'test:a', meetingId: 'test:m', scheduleRevision: 1, status: 'SCHEDULED' } });
    expect(await request(1, 'wrong-token')).toMatchObject({ status: 403 });
    importMeetingSchedules(db.db, { ...source, schedules: [{ ...source.schedules[0], revision: 2, status: 'CANCELLED' }] }, { apply: true });
    expect(await request(1)).toMatchObject({ status: 200, body: { valid: false, memberId: 'test:a', scheduleRevision: 2, status: 'CANCELLED' } });
    registerDeviceDeliveryToken(db.db, { memberId: 'test:b', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 2 });
    expect(await request(1)).toMatchObject({ status: 403 });
  });
  it('does not activate a schedule lacking its authority reference', async () => {
    const db = armed();
    db.db.exec('UPDATE member_group_profiles SET schedule_source_ref=NULL');
    expect(discoverDueMeetingEvents(db.db, due)).toEqual([]);
    expect(readReminderPreferences(db.db, 'test:a').meetings).toEqual([]);
    const api = createApiHandler({ db });
    expect(await api({ method: 'POST', url: '/api/device/reminders/validate', headers: { 'x-qingmu-installation-id': 'test:installation', 'x-qingmu-device-token': 'isolated-token' }, body: JSON.stringify({ meeting_id: 'test:m', schedule_revision: 1 }) })).toMatchObject({ status: 403 });
    expect(importMeetingSchedules(db.db, source, { apply: true })).toMatchObject({ changed: 1 });
    expect(discoverDueMeetingEvents(db.db, due)).toHaveLength(1);
  });
  it('missing config leaves no sender while disabled autostart never claims readiness', () => {
    expect(createRemoteConfiguration({})).toMatchObject({ status: 'REMOTE_PENDING', delivery: null });
    expect(createRemoteConfiguration({ QINGMU_FCM_PROJECT_ID: 'test', QINGMU_FCM_CREDENTIAL_FILE: 'not-present.json', QINGMU_REMINDER_WORKER_AUTOSTART: 'true' })).toMatchObject({ status: 'REMOTE_PENDING', delivery: null });
  });
  it('uses the assembled normal HTTP factory to start an injected configured dispatcher', async () => {
    for (const key of ['QINGMU_FIXTURE_ROSTER', 'QINGMU_INVITE_SEED_FILE', 'QINGMU_GROUP_PROFILE_FILE', 'QINGMU_GOOGLE_SERVER_CLIENT_ID', 'QINGMU_SESSION_SECRET']) vi.stubEnv(key, '');
    const db = armed(); const callbacks: Array<() => Promise<void>> = []; const send = vi.fn(async () => ({ messageId: 'http-factory-ack' }));
    const backend = createHttpServer({ database: db, fixtureToken: 'isolated-http-fixture', reminderDelivery: { enabled: true, send }, reminderWorker: { autostart: true, now: () => due, timer: { setInterval: cb => { callbacks.push(cb); return cb; }, clearInterval: () => undefined } } });
    expect(backend.remoteStatus).toBe('REMOTE_READY'); expect(callbacks).toHaveLength(1); await callbacks[0](); expect(send).toHaveBeenCalledTimes(1);
    await backend.worker?.stop();
  });
});
