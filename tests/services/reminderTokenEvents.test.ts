import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';
import { registerReminderDevice } from '../../src/services/reminderDevice';

function store() { const values = new Map<string, string>(); return { getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } }; }
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const owners: ReminderRuntimeOwner[] = [];
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); clearAuthSession(); });

async function nativeEventFixture() {
  const secureStore = store(); const emitted: Array<{ type: string; data: string }> = [];
  let listener: ((token: { type: string; data: string }) => void) | null = null;
  let currentToken = 'token-a';
  const getToken = vi.fn(async () => { const token = { type: 'android', data: currentToken }; emitted.push(token); return token; });
  let bindingVersion = 0;
  const register = vi.fn(async (input: { ownerGeneration?: number }) => ({ registered: true, bindingVersion: ++bindingVersion, ownerGeneration: input.ownerGeneration }));
  const save = vi.fn(async (input: any) => ({ memberId: 'member:a', ...input, remoteDeliveryStatus: 'REMOTE_READY' as const, meetings: [] }));
  setAuthSession({ memberId: 'member:a', sessionToken: 'session-a' });
  const owner = new ReminderRuntimeOwner({
    scheduler: { requestPermission: async () => 'granted', list: async () => [], schedule: async () => {}, cancel: async () => {}, cancelForMember: async () => {} } as any,
    secureStore, createApiClient: () => ({ getReminderSnapshot: async () => ({ memberId: 'member:a', readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 5, preferenceGeneration: 8, remoteDeliveryStatus: 'REMOTE_READY', meetings: [] }), saveReminderPreferences: save, registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true }),
    loadNotificationSource: async () => ({ getDevicePushTokenAsync: getToken, addPushTokenListener: next => { listener = next; return { remove: () => { if (listener === next) listener = null; } }; } }), generateInstallationId: () => 'installation-a',
  });
  owners.push(owner); owner.start(); await settle();
  return { owner, getToken, register, save, emitted, emit: (data: string) => { currentToken = data; listener?.({ type: 'android', data }); }, pump: async () => { for (let i = 0; i < 6 && emitted.length; i++) { listener?.(emitted.shift()!); await settle(); } } };
}

describe('Expo token getter emission boundary', () => {
  it('does not re-enter the native getter or rebind when getter success emits the same token', async () => {
    const f = await nativeEventFixture();
    expect(f.register).toHaveBeenCalledOnce();
    // Installed Android PushTokenModule resolves getToken, then invokes onNewToken.
    await f.pump();
    expect(f.getToken).toHaveBeenCalledOnce();
    expect(f.register).toHaveBeenCalledOnce();
    expect(f.emitted).toHaveLength(0);
    await f.owner.savePreferences({ readingEnabled: false, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    await f.pump();
    expect(f.getToken).toHaveBeenCalledOnce(); expect(f.register).toHaveBeenCalledOnce();
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ readingEnabled: false, meetingAdvanceMinutes: 30 }));
  });

  it('uses a real rotation event token directly and ignores repeated identical rotations', async () => {
    const f = await nativeEventFixture(); f.emitted.length = 0;
    f.emit('token-b'); f.emit('token-b'); await settle(); await settle();
    expect(f.getToken).toHaveBeenCalledOnce();
    expect(f.register).toHaveBeenCalledTimes(2);
    f.emit('token-b'); await settle();
    expect(f.register).toHaveBeenCalledTimes(2);
  });
});

describe('shared registration producer idempotency', () => {
  it('does not POST again for the same committed member/installation/token/generation', async () => {
    const secureStore = store();
    const register = vi.fn(async () => ({ registered: true, bindingVersion: 1, ownerGeneration: 2 }));
    const options = { secureStore, memberId: 'member:a', ownerGeneration: 2, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: 'same-token' }) }, generateInstallationId: () => 'installation-dedupe', api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true } };
    await registerReminderDevice(options); await registerReminderDevice(options);
    expect(register).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent identical registration attempts before either response commits', async () => {
    const secureStore = store(); let resolve!: (value: any) => void;
    const response = new Promise<any>(done => { resolve = done; });
    const register = vi.fn(() => response);
    const options = { secureStore, memberId: 'member:a', ownerGeneration: 2, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: 'same-token' }) }, generateInstallationId: () => 'installation-inflight', api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true } };
    const first = registerReminderDevice(options); const second = registerReminderDevice(options); await settle();
    try { expect(register).toHaveBeenCalledOnce(); }
    finally { resolve({ registered: true, bindingVersion: 1, ownerGeneration: 2 }); await Promise.all([first, second]); }
  });
});
