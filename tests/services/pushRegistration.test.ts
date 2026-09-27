import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY } from '../../src/services/reminderDevice';
import { createReminderDeviceRevokeQueue } from '../../src/services/reminderDeviceRevokeQueue';

/**
 * A friend push can only reach a phone whose token the server has. Before this, only a phone with
 * 聚會提醒 on registered one, and production has meeting reminders switched off, so none did.
 *
 * Registration now follows the signed-in session: every member's device registers, without any
 * permission prompt (an Android FCM token needs none), and the binding lives until sign-out. The
 * meeting preference no longer revokes it — the server already refuses to send a meeting reminder
 * to a member whose preference is off, so the token carries nothing they did not ask for.
 */

function fixture(snapshot: { readingEnabled: boolean; meetingEnabled: boolean }, register?: (input: { ownerGeneration?: number }) => Promise<unknown>) {
  const values = new Map<string, string>();
  const store = { getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
  const requestPermission = vi.fn(async () => 'granted' as const);
  const scheduler = { list: async () => [], cancel: async () => {}, cancelForMember: async () => {}, schedule: async () => {}, requestPermission };
  const registerToken = vi.fn(register ?? (async (input: { ownerGeneration?: number }) => ({ registered: true, bindingVersion: 1, ownerGeneration: input.ownerGeneration })));
  const revoke = vi.fn(async () => 'REVOKED' as const);
  const legacyRevoke = vi.fn(async () => true);
  let listenerActive = false;
  const reminderSnapshot = { memberId: 'member:a', readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [], ...snapshot };
  const owner = new ReminderRuntimeOwner({
    scheduler: scheduler as any,
    secureStore: store,
    deviceRevokeQueue: createReminderDeviceRevokeQueue({ secureStore: store, revoke }),
    revokeDeviceBinding: legacyRevoke,
    createApiClient: () => ({ getReminderSnapshot: async () => reminderSnapshot, saveReminderPreferences: async (next: any) => ({ ...reminderSnapshot, ...next }), registerReminderDeviceToken: registerToken as any, revokeReminderDeviceToken: legacyRevoke }),
    loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'device-a' }), addPushTokenListener: () => { listenerActive = true; return { remove() { listenerActive = false; } }; } }),
    generateInstallationId: () => 'install-a',
  });
  setAuthSession({ memberId: 'member:a', sessionToken: 'session-a' });
  owner.start();
  return { owner, values, requestPermission, registerToken, revoke, legacyRevoke, listening: () => listenerActive };
}
const settle = async () => { for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
afterEach(() => clearAuthSession());

describe('every signed-in member’s device registers for pushes', () => {
  it('registers with both reminders off, and asks for no permission to do it', async () => {
    const f = fixture({ readingEnabled: false, meetingEnabled: false });
    await settle();
    expect(f.registerToken).toHaveBeenCalledOnce();
    expect(f.requestPermission).not.toHaveBeenCalled();
    expect(JSON.parse(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)!)).toMatchObject({ memberId: 'member:a', token: 'device-a' });
    expect(f.listening()).toBe(true);
    expect(f.owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingEnabled: false, meetingEnabled: false, permission: 'undetermined' });
    f.owner.dispose();
  });

  it('keeps the reminder settings usable when push registration fails', async () => {
    const f = fixture({ readingEnabled: true, meetingEnabled: false }, async () => { throw new Error('offline'); });
    await settle();
    expect(f.registerToken).toHaveBeenCalled();
    expect(f.owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingEnabled: true });
    f.owner.dispose();
  });

  it('keeps the device binding when meeting reminders are turned off', async () => {
    const f = fixture({ readingEnabled: false, meetingEnabled: true });
    await settle();
    await f.owner.savePreferences({ meetingEnabled: false });
    await settle();
    expect(f.owner.getSnapshot().meetingEnabled).toBe(false);
    expect(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeDefined();
    expect(f.listening()).toBe(true);
    expect(f.revoke).not.toHaveBeenCalled();
    expect(f.legacyRevoke).not.toHaveBeenCalled();
    f.owner.dispose();
  });

  it('still revokes it on sign-out', async () => {
    const f = fixture({ readingEnabled: false, meetingEnabled: false });
    await settle();
    clearAuthSession();
    await settle();
    expect(f.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)).toBeUndefined();
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ memberId: 'member:a', token: 'device-a' }));
    f.owner.dispose();
  });
});
