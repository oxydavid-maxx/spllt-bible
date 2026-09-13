import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
import { clearAuthSession, getAuthSnapshot, hydrateAuthSnapshot, markAuthExpired, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY, type ReminderDeviceBinding } from '../../src/services/reminderDevice';

const a = { memberId: 'member:a', sessionToken: 'session-a' };
const bindingA: ReminderDeviceBinding = { memberId: a.memberId, installationId: 'installation-one', token: 'device-a', ownerGeneration: 17, bindingVersion: 9 };
function makeStore(binding?: ReminderDeviceBinding) {
  const values = new Map<string, string>();
  const store = { values, getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
  if (binding) seedBinding(store, binding);
  return store;
}
function seedBinding(store: ReturnType<typeof makeStore>, binding: ReminderDeviceBinding) {
  for (const [key, value] of Object.entries({ 'qingmu.reminder.installationId': binding.installationId, 'qingmu.reminder.deviceToken': binding.token, 'qingmu.reminder.bindingVersion': String(binding.bindingVersion), 'qingmu.reminder.ownerGeneration': String(binding.ownerGeneration), [REMINDER_DEVICE_OWNER_RECEIPT_KEY]: JSON.stringify(binding) })) store.values.set(key, value);
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };
const owners: ReminderRuntimeOwner[] = [];
function fixture(store = makeStore()) {
  const scheduled: any[] = [];
  const scheduler = {
    requestPermission: vi.fn(async () => 'granted' as const), list: async () => [...scheduled],
    schedule: vi.fn(async (spec: any) => { scheduled.push(spec); }),
    cancel: vi.fn(async (id: string) => { const i = scheduled.findIndex(item => item.reminderId === id); if (i >= 0) scheduled.splice(i, 1); }),
    cancelForMember: vi.fn(async (memberId: string) => { for (let i = scheduled.length - 1; i >= 0; i--) if (scheduled[i].memberId === memberId) scheduled.splice(i, 1); }),
  };
  const snapshot = { memberId: a.memberId, readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_READY' as const, meetings: [] };
  const register = vi.fn(async (input: { ownerGeneration?: number }) => ({ registered: true, bindingVersion: 9, ownerGeneration: input.ownerGeneration }));
  const save = vi.fn(async () => snapshot);
  const oldSessionRevoke = vi.fn(async () => true);
  const deviceRevoke = vi.fn(async (_binding: ReminderDeviceBinding) => true);
  const createApiClient = vi.fn(() => ({ getReminderSnapshot: async () => snapshot, saveReminderPreferences: save, registerReminderDeviceToken: register, revokeReminderDeviceToken: oldSessionRevoke }));
  let tokenListener: (() => void) | undefined;
  const removeTokenListener = vi.fn();
  const owner = new ReminderRuntimeOwner({ scheduler: scheduler as any, secureStore: store, createApiClient, revokeDeviceBinding: deviceRevoke, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'device-a' }), addPushTokenListener: listener => { tokenListener = listener; return { remove: removeTokenListener }; } }), generateInstallationId: () => 'installation-one' });
  owners.push(owner);
  return { owner, store, scheduled, scheduler, register, save, createApiClient, oldSessionRevoke, deviceRevoke, removeTokenListener, rotate: () => tokenListener?.() };
}
async function hydrateExpired(store: ReturnType<typeof makeStore>) {
  store.values.set('qingmu.session.token', a.sessionToken);
  store.values.set('qingmu.session.member', a.memberId);
  store.values.set('qingmu.session.expiresAt', '100');
  await hydrateAuthSnapshot({ secureStore: store, nowSeconds: () => 200 });
  expect(getAuthSnapshot().status).toBe('expired');
}
beforeEach(() => { clearAuthSession(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T04:00:00Z')); });
afterEach(async () => { owners.splice(0).forEach(owner => owner.dispose()); clearAuthSession(); await settle(); vi.useRealTimers(); });

describe('reminder lifetime independent of interactive token expiry', () => {
  it('keeps opt-in schedules/device binding on expiry and suspends API writes and token rotation', async () => {
    setAuthSession(a); const f = fixture(); f.owner.start(); await settle();
    expect(f.scheduled.length).toBeGreaterThan(0);
    const count = f.scheduled.length; const token = f.store.values.get('qingmu.reminder.deviceToken');
    const registrations = f.register.mock.calls.length;
    markAuthExpired(); await settle();
    expect(f.scheduled).toHaveLength(count); expect(f.scheduler.cancelForMember).not.toHaveBeenCalled();
    expect(f.store.values.get('qingmu.reminder.deviceToken')).toBe(token);
    expect(f.owner.getSnapshot()).toMatchObject({ readingEnabled: true, meetingEnabled: true });
    f.rotate(); await f.owner.savePreferences({ readingEnabled: false, meetingEnabled: false, readingTime: '09:00', meetingAdvanceMinutes: 5 }); await settle();
    expect(f.register).toHaveBeenCalledTimes(registrations); expect(f.save).not.toHaveBeenCalled();
    expect(f.removeTokenListener).toHaveBeenCalled(); expect(f.deviceRevoke).not.toHaveBeenCalled(); expect(f.oldSessionRevoke).not.toHaveBeenCalled();
  });

  it('preserves a cold expired hydration then clears its exact persistent owner on explicit logout without an expired-session API', async () => {
    const f = fixture(makeStore(bindingA)); f.scheduled.push({ memberId: a.memberId, reminderId: 'stored-reading' });
    f.owner.start(); await hydrateExpired(f.store); await settle();
    expect(f.scheduled).toHaveLength(1); expect(f.createApiClient).not.toHaveBeenCalled();
    clearAuthSession(); await settle();
    expect(f.scheduled).toHaveLength(0);
    expect(f.deviceRevoke).toHaveBeenCalledExactlyOnceWith(bindingA);
    expect(f.store.values.get('qingmu.reminder.deviceToken')).toBeUndefined();
    expect(f.store.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeUndefined();
    expect(f.createApiClient).not.toHaveBeenCalled();
  });

  it('retains an already-authorized registration result across repeated expiry signals', async () => {
    setAuthSession(a); const f = fixture(makeStore(bindingA));
    f.scheduled.push({ memberId: a.memberId, reminderId: 'stored-reading' });
    let resolve!: (result: any) => void;
    let generation!: number;
    f.register.mockImplementation(input => { generation = input.ownerGeneration!; return new Promise(done => { resolve = done; }); });
    f.owner.start(); await settle();
    expect(resolve).toBeTypeOf('function');
    markAuthExpired(); markAuthExpired();
    resolve({ registered: true, bindingVersion: 10, ownerGeneration: generation }); await settle();
    expect(f.scheduled).toHaveLength(1);
    expect(JSON.parse(f.store.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)!)).toMatchObject({ memberId: a.memberId, bindingVersion: 10, ownerGeneration: generation });
    expect(f.deviceRevoke).not.toHaveBeenCalled();
    expect(f.register).toHaveBeenCalledOnce();
  });

  it('does not use a newer owner receipt after delayed logout cleanup', async () => {
    const f = fixture(makeStore(bindingA)); f.owner.start(); await hydrateExpired(f.store); await settle();
    let release!: () => void;
    f.scheduler.cancelForMember.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    clearAuthSession(); await settle();
    expect(release).toBeTypeOf('function');
    const bindingB = { ...bindingA, memberId: 'member:b', token: 'device-b', bindingVersion: 10, ownerGeneration: 18 };
    seedBinding(f.store, bindingB);
    release(); await settle();
    expect(f.store.values.get('qingmu.reminder.deviceToken')).toBe('device-b');
    expect(JSON.parse(f.store.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)!)).toEqual(bindingB);
    expect(f.deviceRevoke.mock.calls.every(([binding]) => binding.memberId === a.memberId && binding.ownerGeneration === 17)).toBe(true);
  });

  it('fails closed rather than clearing an unknown persistent device owner', async () => {
    const f = fixture(makeStore(bindingA)); f.store.values.delete(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
    f.owner.start(); await hydrateExpired(f.store); await settle(); clearAuthSession(); await settle();
    expect(f.deviceRevoke).not.toHaveBeenCalled(); expect(f.oldSessionRevoke).not.toHaveBeenCalled();
  });
});
