import { describe, expect, it, vi } from 'vitest';

import { registerReminderDevice, revokeReminderDevice } from '../../src/services/reminderDevice';

function store() {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  };
}

describe('native device delivery registration', () => {
  it('registers the native FCM token with an installation binding and revokes it on sign-out', async () => {
    const secureStore = store();
    const calls: string[] = [];
    const api = { registerReminderDeviceToken: async ({ installationId, token }: { installationId: string; token: string }) => { calls.push(`register:${installationId}:${token}`); return true; }, revokeReminderDeviceToken: async (installationId: string) => { calls.push(`revoke:${installationId}`); return true; } };
    await expect(registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: 'native-token' }) }, api, generateInstallationId: () => 'install-1' })).resolves.toMatchObject({ registered: true, installationId: 'install-1' });
    await expect(revokeReminderDevice({ secureStore, api })).resolves.toBe(true);
    expect(calls).toEqual(['register:install-1:native-token', 'revoke:install-1']);
  });

  it('does not register an APNs token on the Android direct-FCM route', async () => {
    const secureStore = store();
    await expect(registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'apns', data: 'ios-token' }) }, api: { registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }, generateInstallationId: () => 'install-2' })).resolves.toMatchObject({ registered: false, installationId: null });
  });

  it('drops a deferred native token before registration when auth authority is invalidated', async () => {
    let resolveToken!: (value: { type: string; data: string }) => void;
    let authorized = true;
    const secureStore = store();
    const register = vi.fn(async () => true);
    const result = registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: () => new Promise((resolve) => { resolveToken = resolve; }) }, api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: vi.fn(async () => true) }, generateInstallationId: () => 'install-deferred', authority: { isCurrent: () => authorized } } as any);
    authorized = false;
    resolveToken({ type: 'android', data: 'old-token' });
    await expect(result).resolves.toMatchObject({ registered: false, installationId: null });
    expect(register).not.toHaveBeenCalled();
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBeUndefined();
  });

  it('revokes and removes a binding if auth invalidates after the API registration commits', async () => {
    let resolveRegister!: (value: boolean) => void;
    let authorized = true;
    const secureStore = store();
    const revoke = vi.fn(async () => true);
    const result = registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: 'old-token' }) }, api: { registerReminderDeviceToken: async () => new Promise((resolve) => { resolveRegister = resolve; }), revokeReminderDeviceToken: revoke }, generateInstallationId: () => 'install-committed', authority: { isCurrent: () => authorized } } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    authorized = false;
    resolveRegister(true);
    await expect(result).resolves.toMatchObject({ registered: false, installationId: 'install-committed' });
    expect((revoke.mock.calls as unknown[][])[0]?.[0]).toBe('install-committed');
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBeUndefined();
  });
});
