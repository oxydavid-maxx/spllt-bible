import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReminderDeviceRevokeQueue, REMINDER_DEVICE_REVOKE_QUEUE_KEY, type ReminderDeviceRevokeResult } from '../../src/services/reminderDeviceRevokeQueue';
import type { ReminderDeviceBinding } from '../../src/services/reminderDevice';
import { createConfiguredReminderDeviceRevokeTransport } from '../../src/services/configuredReminderHeadless';

afterEach(() => { vi.useRealTimers(); });

const binding: ReminderDeviceBinding = { memberId: 'member:a', installationId: 'install-shared', token: 'test-token', bindingVersion: 2, ownerGeneration: 3 };
function store() {
  const values = new Map<string, string>([['qingmu.reminder.ownerReceipt.v1', 'new-owner-sentinel'], ['qingmu.reminder.deviceToken', 'new-owner-token']]);
  return { values, getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null), setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
}
function queue(secureStore: ReturnType<typeof store>, revoke = vi.fn(async (_binding: ReminderDeviceBinding): Promise<ReminderDeviceRevokeResult> => 'REVOKED')) {
  expect(createReminderDeviceRevokeQueue).toBeTypeOf('function');
  return { ...createReminderDeviceRevokeQueue({ secureStore, revoke }), revoke };
}
function pending(secureStore: ReturnType<typeof store>): ReminderDeviceBinding[] { return JSON.parse(secureStore.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)!).bindings; }

describe('durable device revoke queue', () => {
  it('persists once before enqueue resolves and keeps all current-owner keys untouched', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    await q.enqueue(binding);
    await q.enqueue({ ...binding });
    expect(pending(secureStore)).toEqual([binding]);
    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.setItemAsync.mock.calls.every(([key]) => key === REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBe(true);
    expect(secureStore.values.get('qingmu.reminder.ownerReceipt.v1')).toBe('new-owner-sentinel');
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBe('new-owner-token');
    expect(q.revoke).not.toHaveBeenCalled();
  });

  it.each(['RETRY', 'throw', false])('retains an offline/failed attempt (%s) for a new queue instance to retry', async (failure) => {
    const secureStore = store();
    const retry = vi.fn(async (): Promise<ReminderDeviceRevokeResult> => { if (failure === 'throw') throw new Error('offline'); return failure as ReminderDeviceRevokeResult; });
    const first = queue(secureStore, retry);
    await first.enqueue(binding);
    await first.flush();
    expect(pending(secureStore)).toEqual([binding]);
    const restarted = queue({ ...secureStore });
    await restarted.flush();
    expect(restarted.revoke).toHaveBeenCalledExactlyOnceWith(binding);
    expect(pending(secureStore)).toEqual([]);
    expect(secureStore.values.get('qingmu.reminder.ownerReceipt.v1')).toBe('new-owner-sentinel');
  });

  it.each(['REVOKED', 'ALREADY_INVALID'] as const)('removes an exact tuple only after the authoritative %s result', async (result) => {
    const secureStore = store();
    const q = queue(secureStore, vi.fn(async () => result));
    await q.enqueue(binding);
    await q.flush();
    expect(pending(secureStore)).toEqual([]);
  });

  it('shares a flush across instances while allowing enqueue during the pending network response', async () => {
    const secureStore = store();
    let release!: (result: ReminderDeviceRevokeResult) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const revoke = vi.fn(async (_captured: ReminderDeviceBinding): Promise<ReminderDeviceRevokeResult> => { started(); return new Promise((resolve) => { release = resolve; }); });
    revoke.mockImplementationOnce(async () => { started(); return new Promise((resolve) => { release = resolve; }); });
    revoke.mockResolvedValueOnce('RETRY');
    const first = queue(secureStore, revoke);
    const second = queue(secureStore, revoke);
    await first.enqueue(binding);
    const flush = first.flush();
    await began;
    expect(second.flush()).toBe(flush);
    const newer = { ...binding, memberId: 'member:b', bindingVersion: 3, ownerGeneration: 4 };
    await second.enqueue(newer);
    expect(pending(secureStore)).toEqual([binding, newer]);
    expect(revoke).toHaveBeenCalledTimes(1);
    release('REVOKED');
    await flush;
    expect(pending(secureStore)).toEqual([newer]);
    expect(revoke.mock.calls.filter(([item]) => item.memberId === binding.memberId)).toHaveLength(1);
  });

  it('serializes concurrent enqueues from multiple instances so neither durable intent is lost', async () => {
    const secureStore = store();
    const other = { ...binding, ownerGeneration: 4, bindingVersion: 3 };
    await Promise.all([queue(secureStore).enqueue(binding), queue(secureStore).enqueue(other)]);
    expect(pending(secureStore)).toEqual([binding, other]);
  });

  it.each(['bad-json', '{}', '{"version":1,"bindings":[{}]}', '{"version":2,"bindings":[]}'])('fails closed without overwriting a malformed queue: %s', async (raw) => {
    const secureStore = store();
    const q = queue(secureStore);
    secureStore.values.set(REMINDER_DEVICE_REVOKE_QUEUE_KEY, raw);
    await expect(q.enqueue(binding)).rejects.toThrow('REMINDER_REVOKE_QUEUE_INVALID');
    await expect(q.flush()).rejects.toThrow('REMINDER_REVOKE_QUEUE_INVALID');
    expect(secureStore.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBe(raw);
    expect(q.revoke).not.toHaveBeenCalled();
  });

  it('rejects enqueue when durable storage fails, then permits a later successful enqueue', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(q.enqueue(binding)).rejects.toThrow('storage unavailable');
    expect(secureStore.values.has(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBe(false);
    await q.enqueue(binding);
    expect(pending(secureStore)).toEqual([binding]);
  });

  it('does not acknowledge enqueue until the native store write has completed', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    let release!: () => void;
    secureStore.setItemAsync.mockImplementationOnce(async (key, raw) => { await new Promise<void>((resolve) => { release = resolve; }); secureStore.values.set(key, raw); });
    let acknowledged = false;
    const operation = q.enqueue(binding).then(() => { acknowledged = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acknowledged).toBe(false);
    release();
    await operation;
    expect(pending(secureStore)).toEqual([binding]);
  });

  it('rejects a silent native write failure instead of claiming enqueue is durable', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    secureStore.setItemAsync.mockResolvedValueOnce(undefined);
    await expect(q.enqueue(binding)).rejects.toThrow('REMINDER_REVOKE_QUEUE_WRITE_FAILED');
  });

  it('retains a real configured transport timeout and retries it from a fresh queue instance', async () => {
    vi.useFakeTimers();
    const secureStore = store();
    const transport = createConfiguredReminderDeviceRevokeTransport({ apiBaseUrl: 'https://reminder.test', fetchImpl: (): Promise<Response> => new Promise(() => {}) });
    const first = createReminderDeviceRevokeQueue({ secureStore, revoke: transport });
    await first.enqueue(binding);
    const flush = first.flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush;
    expect(pending(secureStore)).toEqual([binding]);
    await queue({ ...secureStore }).flush();
    expect(pending(secureStore)).toEqual([]);
  });

  it('retains the durable item if deleting the successful attempt cannot be persisted', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    await q.enqueue(binding);
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(q.flush()).rejects.toThrow('storage unavailable');
    expect(pending(secureStore)).toEqual([binding]);
    await q.flush();
    expect(pending(secureStore)).toEqual([]);
  });

  it('rejects an ownerless binding without writing or sending it', async () => {
    const secureStore = store();
    const q = queue(secureStore);
    await expect(q.enqueue({ ...binding, memberId: '' })).rejects.toThrow('REMINDER_REVOKE_BINDING_INVALID');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(q.revoke).not.toHaveBeenCalled();
  });
});
