import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredMeetingReminderValidator } from '../../src/services/configuredReminderHeadless';
import type { AuthSnapshot } from '../../src/services/authSession';
import type { HeadlessMeetingPayload } from '../../src/services/reminderDelivery';
import { REMINDER_DEVICE_BINDING_VERSION_KEY, REMINDER_DEVICE_OWNER_GENERATION_KEY, REMINDER_DEVICE_OWNER_RECEIPT_KEY, REMINDER_DEVICE_TOKEN_KEY, REMINDER_INSTALLATION_KEY } from '../../src/services/reminderDevice';

const payload: HeadlessMeetingPayload = { event: 'MEETING_REMINDER', reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2 };
const valid = { valid: true, memberId: 'member:one', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' };
const keys = [REMINDER_INSTALLATION_KEY, REMINDER_DEVICE_TOKEN_KEY, REMINDER_DEVICE_BINDING_VERSION_KEY, REMINDER_DEVICE_OWNER_GENERATION_KEY];
const signedIn: Pick<AuthSnapshot, 'status' | 'session' | 'epoch' | 'expiresAt'> = { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'test-session' }, epoch: 1, expiresAt: null };

function fixture(body: unknown = valid) {
  const storage = new Map(keys.map((key, i) => [key, ['test-installation', 'test-device-token', '3', '5'][i]]));
  storage.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify({ memberId: 'member:one', installationId: 'test-installation', token: 'test-device-token', bindingVersion: 3, ownerGeneration: 5 }));
  let auth = { ...signedIn };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  const getItemAsync = vi.fn(async (key: string) => storage.get(key) ?? null);
  const hasPersistedAuthTermination = vi.fn(async () => false);
  expect(createConfiguredMeetingReminderValidator).toBeTypeOf('function');
  const validate = createConfiguredMeetingReminderValidator({ apiBaseUrl: 'https://reminder.test', secureStore: { getItemAsync }, getAuthSnapshot: () => auth, hasPersistedAuthTermination, fetchImpl });
  return { validate, storage, fetchImpl, getItemAsync, hasPersistedAuthTermination, setAuth: (next: typeof auth) => { auth = next; } };
}

afterEach(() => { vi.useRealTimers(); });

describe('configured device-authorized meeting validation', () => {
  it('refuses a revoked expired snapshot with no session', async () => {
    const f = fixture();
    f.setAuth({ ...signedIn, status: 'expired', session: null });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['terminated', 'unreadable'])('fails closed for %s persisted auth in a cold hydrating process', async (mode) => {
    const f = fixture();
    f.setAuth({ status: 'hydrating', session: null, epoch: 0, expiresAt: null });
    if (mode === 'terminated') f.hasPersistedAuthTermination.mockResolvedValue(true);
    else f.hasPersistedAuthTermination.mockRejectedValue(new Error('storage unavailable'));
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects persisted termination committed while the validation response is pending', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(async () => { f.hasPersistedAuthTermination.mockResolvedValue(true); return new Response(JSON.stringify(valid)); });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it('posts the device credentials and exact meeting revision, then returns the backend owner', async () => {
    const f = fixture();
    await expect(f.validate(payload)).resolves.toEqual(valid);
    expect(f.fetchImpl).toHaveBeenCalledExactlyOnceWith('https://reminder.test/api/device/reminders/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-qingmu-installation-id': 'test-installation', 'x-qingmu-device-token': 'test-device-token' },
      body: JSON.stringify({ meeting_id: 'm1', schedule_revision: 2 }), signal: expect.any(AbortSignal),
    });
    for (const key of keys) expect(f.getItemAsync.mock.calls.filter(([readKey]) => readKey === key)).toHaveLength(2);
  });

  it('permits a cold hydrating process to use the owner established by device authentication', async () => {
    const f = fixture();
    f.setAuth({ status: 'hydrating', session: null, epoch: 0, expiresAt: null });
    await expect(f.validate(payload)).resolves.toEqual(valid);
  });

  it.each(['missing', 'invalid', 'ownerless'])('refuses legacy credentials without a complete owner receipt: %s', async (mode) => {
    const f = fixture();
    f.setAuth({ status: 'hydrating', session: null, epoch: 0, expiresAt: null });
    if (mode === 'missing') f.storage.delete(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
    if (mode === 'invalid') f.storage.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, 'bad-json');
    if (mode === 'ownerless') f.storage.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify({ installationId: 'test-installation', token: 'test-device-token', bindingVersion: 3, ownerGeneration: 5 }));
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the backend device owner to match the persisted receipt during a cold start', async () => {
    const f = fixture({ ...valid, memberId: 'member:two' });
    f.setAuth({ status: 'hydrating', session: null, epoch: 0, expiresAt: null });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it('rejects a cleared owner receipt even if legacy keys remain after validation dispatch', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(async () => { f.storage.delete(REMINDER_DEVICE_OWNER_RECEIPT_KEY); return new Response(JSON.stringify(valid)); });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it.each([
    null, [], { ...valid, valid: 'true' }, { ...valid, valid: false },
    { ...valid, memberId: undefined }, { ...valid, memberId: '' }, { ...valid, memberId: ' ' },
    { ...valid, meetingId: 'other' }, { ...valid, scheduleRevision: 1 }, { ...valid, scheduleRevision: '2' },
    { ...valid, scheduleRevision: -1 }, { ...valid, scheduleRevision: 0.5 }, { ...valid, scheduleRevision: Number.POSITIVE_INFINITY },
    { ...valid, status: 'CANCELLED' },
  ])('rejects a malformed, ownerless or stale response: %j', async (body) => {
    await expect(fixture(body).validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it.each([
    { ...payload, scheduleRevision: -1 }, { ...payload, scheduleRevision: 0.5 }, { ...payload, scheduleRevision: Number.NaN },
    { ...payload, scheduleRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...payload, meetingId: '' }, { ...payload, reminderId: '' },
  ])('rejects malformed request payloads before any network call: %j', async (request) => {
    const f = fixture();
    await expect(f.validate(request)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([REMINDER_INSTALLATION_KEY, REMINDER_DEVICE_TOKEN_KEY])('rejects missing device credentials before fetch: %s', async (key) => {
    const f = fixture();
    f.storage.delete(key);
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['signed-out'] as const)('does not validate an explicitly %s process', async (status) => {
    const f = fixture();
    f.setAuth({ ...signedIn, status });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a backend owner different from the currently signed-in account', async () => {
    const f = fixture({ ...valid, memberId: 'member:two' });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it.each(keys)('rejects a device binding change during validation: %s', async (key) => {
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(async () => { f.storage.set(key, 'changed'); return new Response(JSON.stringify(valid)); });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it.each([
    { ...signedIn, epoch: 2 },
    { ...signedIn, status: 'signed-out' as const, session: null },
    { ...signedIn, session: { memberId: 'member:two', sessionToken: 'other-test-session' } },
  ])('rejects an auth switch or invalidation while the response is pending: %j', async (next) => {
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(async () => { f.setAuth(next); return new Response(JSON.stringify(valid)); });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it('allows an expired interactive session when the device-bound backend owner still matches', async () => {
    const f = fixture();
    f.setAuth({ ...signedIn, status: 'expired', expiresAt: 1 });
    await expect(f.validate(payload)).resolves.toEqual(valid);
  });

  it('still rejects an expired session whose known owner differs from the device-bound response', async () => {
    const f = fixture({ ...valid, memberId: 'member:two' });
    f.setAuth({ ...signedIn, status: 'expired', expiresAt: 1 });
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it('does not mistake interactive session expiry during validation for logout', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(async () => { f.setAuth({ ...signedIn, status: 'expired', epoch: signedIn.epoch + 1 }); return new Response(JSON.stringify(valid)); });
    await expect(f.validate(payload)).resolves.toEqual(valid);
  });

  it.each(['http', 'json', 'network', 'storage'] as const)('fails closed on %s failure', async (failure) => {
    const f = fixture();
    if (failure === 'http') f.fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    if (failure === 'json') f.fetchImpl.mockResolvedValueOnce(new Response('invalid-json'));
    if (failure === 'network') f.fetchImpl.mockRejectedValueOnce(new Error('offline'));
    if (failure === 'storage') f.getItemAsync.mockRejectedValueOnce(new Error('locked'));
    await expect(f.validate(payload)).resolves.toMatchObject({ valid: false });
  });

  it.each(['fetch', 'body'] as const)('fails closed at two seconds even if %s ignores cancellation', async (phase) => {
    vi.useFakeTimers();
    const f = fixture();
    if (phase === 'fetch') f.fetchImpl.mockImplementationOnce(() => new Promise(() => {}));
    else f.fetchImpl.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) } as unknown as Response);
    const operation = f.validate(payload);
    await vi.advanceTimersByTimeAsync(1999);
    let completed = false;
    void operation.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(operation).resolves.toMatchObject({ valid: false });
    const init = (f.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
