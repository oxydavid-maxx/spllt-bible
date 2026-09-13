import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
import { clearAuthSession, getAuthSnapshot, markAuthExpired, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY, type ReminderDeviceBinding } from '../../src/services/reminderDevice';
import { createReminderDeviceRevokeQueue, REMINDER_DEVICE_REVOKE_QUEUE_KEY } from '../../src/services/reminderDeviceRevokeQueue';
import { createReminderNotificationController } from '../../src/services/reminderNotificationEntry';

const binding: ReminderDeviceBinding = { memberId: 'member:a', installationId: 'install', token: 'device-a', bindingVersion: 9, ownerGeneration: 17 };
function fixture(active = false, sessionToken = 'session-a') {
  const values = new Map<string, string>(); const events: string[] = [];
  const store = { getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { if (key === REMINDER_DEVICE_REVOKE_QUEUE_KEY) events.push('persist-pending'); values.set(key, value); }, deleteItemAsync: async (key: string) => { if (key === REMINDER_DEVICE_OWNER_RECEIPT_KEY) events.push('clear-owner'); values.delete(key); } };
  function seed(value: ReminderDeviceBinding) {
    values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify(value)); values.set('qingmu.reminder.installationId', value.installationId); values.set('qingmu.reminder.deviceToken', value.token); values.set('qingmu.reminder.bindingVersion', String(value.bindingVersion)); values.set('qingmu.reminder.ownerGeneration', String(value.ownerGeneration));
  }
  seed(binding);
  const revoke = vi.fn(async (_binding: ReminderDeviceBinding) => { events.push('send'); return 'RETRY' as const; });
  const queue = createReminderDeviceRevokeQueue({ secureStore: store, revoke });
  const legacyRevoke = vi.fn(async () => false);
  const snapshot = { memberId: binding.memberId, readingEnabled: false, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_READY' as const, meetings: [] };
  const owner = new ReminderRuntimeOwner({
    scheduler: { list: async () => [], cancel: async () => {}, cancelForMember: async () => {}, schedule: async () => {}, requestPermission: async () => 'granted' } as any,
    secureStore: store, deviceRevokeQueue: queue, revokeDeviceBinding: legacyRevoke,
    createApiClient: () => ({ getReminderSnapshot: async () => snapshot, saveReminderPreferences: async (next: any) => ({ ...snapshot, ...next }), registerReminderDeviceToken: async input => ({ registered: true, bindingVersion: 9, ownerGeneration: input.ownerGeneration }), revokeReminderDeviceToken: legacyRevoke }),
    loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: binding.token }), addPushTokenListener: () => ({ remove() {} }) }), generateInstallationId: () => binding.installationId,
  });
  setAuthSession({ memberId: binding.memberId, sessionToken });
  if (!active) markAuthExpired();
  owner.start();
  return { owner, values, store, seed, events, revoke, queue, legacyRevoke };
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };
afterEach(() => clearAuthSession());

describe('persistent reminder revoke integration', () => {
  it('persists an offline logout before local clear and replays exactly that owner after a cold restart', async () => {
    const f = fixture(); await settle(); f.events.length = 0;
    clearAuthSession(); await settle();
    expect(f.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBeDefined();
    expect(f.events.indexOf('persist-pending')).toBeLessThan(f.events.indexOf('clear-owner'));
    expect(f.events.indexOf('clear-owner')).toBeLessThan(f.events.indexOf('send'));
    expect(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeUndefined();
    expect(f.legacyRevoke).not.toHaveBeenCalled(); f.owner.dispose();
    const newer = { ...binding, memberId: 'member:b', token: 'device-b', bindingVersion: 10, ownerGeneration: 18 };
    f.seed(newer);
    const replay = vi.fn(async () => 'REVOKED' as const);
    const restarted = createReminderDeviceRevokeQueue({ secureStore: { ...f.store }, revoke: replay });
    await restarted.flush(); await restarted.flush();
    expect(replay).toHaveBeenCalledExactlyOnceWith(binding);
    expect(JSON.parse(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)!)).toEqual(newer);
    expect(String(f.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY) ?? '')).not.toContain(binding.token);
  });

  it('uses the same durable path when meeting reminders are explicitly disabled', async () => {
    const f = fixture(true); await settle(); f.events.length = 0;
    await f.owner.savePreferences({ readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 }); await settle();
    expect(f.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBeDefined();
    expect(f.events.indexOf('persist-pending')).toBeLessThan(f.events.indexOf('clear-owner'));
    expect(f.owner.getSnapshot().meetingEnabled).toBe(false);
    expect(f.revoke).toHaveBeenCalledOnce(); expect(f.legacyRevoke).not.toHaveBeenCalled(); f.owner.dispose();
  });

  it('treats a server-revoked persistent session as termination, denying presentation before queued cleanup finishes', async () => {
    const credential = `qmd_00000000-0000-4000-8000-000000000000.${'a'.repeat(43)}`;
    const f = fixture(true, credential); await settle();
    markAuthExpired({ memberId: binding.memberId, sessionToken: credential });
    expect(getAuthSnapshot()).toMatchObject({ status: 'expired', session: null });
    expect(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeDefined();
    const controller = createReminderNotificationController({ getAuth: getAuthSnapshot, canNavigate: () => true, defaultActionIdentifier: 'default', validateLatest: vi.fn(), openReadingDate: vi.fn(), openMeeting: vi.fn() });
    expect(await controller.handleForeground({ request: { content: { data: { kind: 'READING', memberId: binding.memberId, reminderId: `reading:${binding.memberId}:2026-09-14`, targetId: 'church-2026-09', taskDate: '2026-09-14' } } } })).toMatchObject({ shouldShowBanner: false });
    await settle();
    expect(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeUndefined();
    expect(f.values.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBeDefined();
    expect(f.revoke).toHaveBeenCalledOnce(); f.owner.dispose();
  });
});
