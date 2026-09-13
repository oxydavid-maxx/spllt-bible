import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredReminderDeviceRevokeTransport, createConfiguredReminderDeviceRevoker, revokeConfiguredReminderDeviceBinding, revokeConfiguredReminderDeviceBindingResult } from '../../src/services/configuredReminderHeadless';
import type { ReminderDeviceBinding } from '../../src/services/reminderDevice';

const binding: ReminderDeviceBinding = { memberId: 'member:one', installationId: 'test-installation', token: 'test-device-token', bindingVersion: 3, ownerGeneration: 7 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture() {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ revoked: true })));
  expect(createConfiguredReminderDeviceRevoker).toBeTypeOf('function');
  return { fetchImpl, revoke: createConfiguredReminderDeviceRevoker({ apiBaseUrl: 'https://reminder.test', fetchImpl }) };
}

describe('device-authorized captured binding revocation', () => {
  it('sends only the captured device headers and exact owner/version/generation without a Bearer session', async () => {
    const f = fixture();
    await expect(f.revoke(binding)).resolves.toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledExactlyOnceWith('https://reminder.test/api/device/reminders/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-qingmu-installation-id': binding.installationId, 'x-qingmu-device-token': binding.token },
      body: JSON.stringify({ member_id: binding.memberId, binding_version: binding.bindingVersion, owner_generation: binding.ownerGeneration }), signal: expect.any(AbortSignal),
    });
  });

  it('never rereads a newer binding or uses caller mutations after dispatch', async () => {
    const f = fixture();
    const captured = { ...binding };
    const operation = f.revoke(captured);
    Object.assign(captured, { memberId: 'member:two', installationId: 'new-installation', token: 'new-token', ownerGeneration: 9, bindingVersion: 5 });
    await expect(operation).resolves.toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ 'x-qingmu-installation-id': binding.installationId, 'x-qingmu-device-token': binding.token }), body: JSON.stringify({ member_id: binding.memberId, binding_version: 3, owner_generation: 7 }) }));
  });

  it.each([null, {}, { ...binding, memberId: '' }, { ...binding, installationId: '' }, { ...binding, token: '' }, { ...binding, bindingVersion: undefined }, { ...binding, bindingVersion: 0 }, { ...binding, bindingVersion: 1.5 }, { ...binding, ownerGeneration: -1 }, { ...binding, ownerGeneration: Number.POSITIVE_INFINITY }])('fails closed for missing or invalid immutable binding: %j', async (candidate) => {
    const f = fixture();
    await expect(f.revoke(candidate as ReminderDeviceBinding)).resolves.toBe(false);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['http', 'false', 'json', 'null', 'network'])('returns false on %s rejection', async (mode) => {
    const f = fixture();
    if (mode === 'http') f.fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    if (mode === 'false') f.fetchImpl.mockResolvedValueOnce(new Response('{"revoked":false}'));
    if (mode === 'json') f.fetchImpl.mockResolvedValueOnce(new Response('bad-json'));
    if (mode === 'null') f.fetchImpl.mockResolvedValueOnce(new Response('null'));
    if (mode === 'network') f.fetchImpl.mockRejectedValueOnce(new Error('offline'));
    await expect(f.revoke(binding)).resolves.toBe(false);
  });

  it('returns false at two seconds even if the fetch implementation ignores abort', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.fetchImpl.mockImplementationOnce(() => new Promise(() => {}));
    const operation = f.revoke(binding);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(operation).resolves.toBe(false);
    expect(((f.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the configured production export without loading interactive auth or secure storage', async () => {
    expect(revokeConfiguredReminderDeviceBinding).toBeTypeOf('function');
    const fetchImpl = vi.fn(async () => new Response('{"revoked":true}'));
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubEnv('EXPO_PUBLIC_QINGMU_API_BASE_URL', 'https://configured.test');
    expect(await revokeConfiguredReminderDeviceBinding(binding)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://configured.test/api/device/reminders/revoke', expect.any(Object));
  });
});

describe('tri-state device revoke transport', () => {
  it.each([
    [200, { revoked: true }, 'REVOKED'],
    [403, { error: 'DEVICE_DELIVERY_REVOKED' }, 'ALREADY_INVALID'],
    [403, { error: 'DEVICE_DELIVERY_FORBIDDEN' }, 'RETRY'],
    [401, { error: 'DEVICE_DELIVERY_REVOKED' }, 'RETRY'],
    [404, { error: 'DEVICE_DELIVERY_REVOKED' }, 'RETRY'],
    [400, { error: 'DEVICE_DELIVERY_REVOKED' }, 'RETRY'],
    [500, { error: 'DEVICE_DELIVERY_REVOKED' }, 'RETRY'],
    [200, { revoked: false }, 'RETRY'],
  ] as const)('maps exact HTTP/body %s/%j to %s', async (status, body, expected) => {
    expect(createConfiguredReminderDeviceRevokeTransport).toBeTypeOf('function');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    expect(await createConfiguredReminderDeviceRevokeTransport({ apiBaseUrl: 'https://reminder.test', fetchImpl })(binding)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the boolean wrapper false for already-invalid while exposing the tri-state result', async () => {
    expect(revokeConfiguredReminderDeviceBindingResult).toBeTypeOf('function');
    const fetchImpl = vi.fn(async () => new Response('{"error":"DEVICE_DELIVERY_REVOKED"}', { status: 403 }));
    vi.stubGlobal('fetch', fetchImpl);
    expect(await revokeConfiguredReminderDeviceBindingResult(binding)).toBe('ALREADY_INVALID');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await revokeConfiguredReminderDeviceBinding(binding)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('classifies an abort-ignoring timeout as retryable', async () => {
    vi.useFakeTimers();
    expect(createConfiguredReminderDeviceRevokeTransport).toBeTypeOf('function');
    const fetchImpl = vi.fn((): Promise<Response> => new Promise(() => {}));
    const operation = createConfiguredReminderDeviceRevokeTransport({ apiBaseUrl: 'https://reminder.test', fetchImpl })(binding);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await operation).toBe('RETRY');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
