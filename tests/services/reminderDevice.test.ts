import { describe, expect, it, vi } from 'vitest';

import { clearReminderDeviceBinding, readReminderDeviceBinding, registerReminderDevice, revokeReminderDevice, REMINDER_DEVICE_OWNER_RECEIPT_KEY, REMINDER_DEVICE_OWNER_SEQUENCE_KEY, type ReminderDeviceBinding } from '../../src/services/reminderDevice';

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

const bindingA: ReminderDeviceBinding = { memberId: 'member:a', installationId: 'install-shared', token: 'token-shared', bindingVersion: 2, ownerGeneration: 3 };

async function registerBinding(secureStore: ReturnType<typeof store>, binding = bindingA, authority = () => true) {
  return registerReminderDevice({ secureStore, memberId: binding.memberId, ownerGeneration: binding.ownerGeneration,
    tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: binding.token }) }, generateInstallationId: () => binding.installationId,
    api: { registerReminderDeviceToken: async () => ({ registered: true, bindingVersion: binding.bindingVersion, ownerGeneration: binding.ownerGeneration }), revokeReminderDeviceToken: async () => true }, authority: { isCurrent: authority } });
}

describe('persistent device binding ownership', () => {
  it('does not dispatch a registration with an explicitly malformed owner', async () => {
    const secureStore = store();
    const register = vi.fn(async () => ({ registered: true, bindingVersion: 2, ownerGeneration: 3 }));
    await expect(registerReminderDevice({ secureStore, memberId: ' ', ownerGeneration: 3, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) },
      api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true }, generateInstallationId: () => bindingA.installationId })).resolves.toMatchObject({ registered: false });
    expect(register).not.toHaveBeenCalled();
  });

  it('requires strict current authority before dispatch even when an accepted operation could later commit', async () => {
    const secureStore = store();
    const register = vi.fn(async () => ({ registered: true, bindingVersion: 2, ownerGeneration: 3 }));
    const result = await registerReminderDevice({ secureStore, memberId: bindingA.memberId, ownerGeneration: 3, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) },
      api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true }, generateInstallationId: () => bindingA.installationId, authority: { isCurrent: () => false, canCommit: () => true } });
    expect(result.registered).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('commits an already accepted same-owner registration when only the interactive session expires', async () => {
    const secureStore = store();
    let current = true;
    const revoke = vi.fn(async () => true);
    const result = await registerReminderDevice({ secureStore, memberId: bindingA.memberId, ownerGeneration: 3, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) },
      api: { registerReminderDeviceToken: async () => { current = false; return { registered: true, bindingVersion: 2, ownerGeneration: 3 }; }, revokeReminderDeviceToken: revoke }, generateInstallationId: () => bindingA.installationId,
      authority: { isCurrent: () => current, canCommit: () => true } });
    expect(result.registered).toBe(true);
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toEqual(bindingA);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('compensates an accepted registration after logout using its captured binding and local-first cleanup', async () => {
    const secureStore = store();
    let current = true;
    const legacyRevoke = vi.fn(async () => true);
    const deviceRevoke = vi.fn(async (binding: ReminderDeviceBinding) => { expect(await readReminderDeviceBinding(secureStore, binding.memberId)).toBeNull(); return true; });
    const result = await registerReminderDevice({ secureStore, memberId: bindingA.memberId, ownerGeneration: 3, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) },
      api: { registerReminderDeviceToken: async () => { current = false; return { registered: true, bindingVersion: 2, ownerGeneration: 3 }; }, revokeReminderDeviceToken: legacyRevoke }, generateInstallationId: () => bindingA.installationId,
      authority: { isCurrent: () => current, canCommit: () => current }, revokeDeviceBinding: deviceRevoke });
    expect(result.registered).toBe(false);
    expect(deviceRevoke).toHaveBeenCalledExactlyOnceWith(bindingA);
    expect(legacyRevoke).not.toHaveBeenCalled();
  });

  it('publishes one complete owner receipt after current-owner registration', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    expect(REMINDER_DEVICE_OWNER_RECEIPT_KEY).toBeTypeOf('string');
    expect(JSON.parse(secureStore.values.get(REMINDER_DEVICE_OWNER_RECEIPT_KEY)!)).toEqual(bindingA);
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toEqual(bindingA);
    expect(Object.isFrozen(await readReminderDeviceBinding(secureStore, bindingA.memberId))).toBe(true);
    expect(await readReminderDeviceBinding(secureStore, 'member:b')).toBeNull();
  });

  it('keeps the next owner sequence separate from the committed active generation', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    expect(REMINDER_DEVICE_OWNER_SEQUENCE_KEY).toBeTypeOf('string');
    expect(REMINDER_DEVICE_OWNER_SEQUENCE_KEY).not.toBe('qingmu.reminder.ownerGeneration');
    await secureStore.setItemAsync(REMINDER_DEVICE_OWNER_SEQUENCE_KEY, '100');
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toEqual(bindingA);
  });

  it.each(['missing', 'invalid-json', 'no-owner', 'fraction-version', 'negative-generation', 'key-drift'])('fails closed for an invalid owner receipt: %s', async (mode) => {
    const secureStore = store();
    await registerBinding(secureStore);
    expect(readReminderDeviceBinding).toBeTypeOf('function');
    if (mode === 'missing') secureStore.values.delete(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
    if (mode === 'invalid-json') secureStore.values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, 'bad-json');
    if (mode === 'no-owner') secureStore.values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify({ ...bindingA, memberId: undefined }));
    if (mode === 'fraction-version') secureStore.values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify({ ...bindingA, bindingVersion: 0.5 }));
    if (mode === 'negative-generation') secureStore.values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify({ ...bindingA, ownerGeneration: -1 }));
    if (mode === 'key-drift') secureStore.values.set('qingmu.reminder.ownerGeneration', '4');
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toBeNull();
  });

  it('clears only the exact captured receipt and leaves the installation identity and owner sequence intact', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    expect(clearReminderDeviceBinding).toBeTypeOf('function');
    secureStore.values.set(REMINDER_DEVICE_OWNER_SEQUENCE_KEY, '9');
    expect(await clearReminderDeviceBinding(secureStore, { ...bindingA, ownerGeneration: 2 })).toBe(false);
    expect(await clearReminderDeviceBinding(secureStore, bindingA)).toBe(true);
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toBeNull();
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBeUndefined();
    expect(secureStore.values.get('qingmu.reminder.bindingVersion')).toBeUndefined();
    expect(secureStore.values.get('qingmu.reminder.ownerGeneration')).toBeUndefined();
    expect(secureStore.values.get('qingmu.reminder.installationId')).toBe(bindingA.installationId);
    expect(secureStore.values.get(REMINDER_DEVICE_OWNER_SEQUENCE_KEY)).toBe('9');
  });

  it('does not let an old owner clear a newly committed owner using the same device token', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    const bindingB = { ...bindingA, memberId: 'member:b', bindingVersion: 3, ownerGeneration: 4 };
    await registerBinding(secureStore, bindingB);
    expect(clearReminderDeviceBinding).toBeTypeOf('function');
    expect(await clearReminderDeviceBinding(secureStore, bindingA)).toBe(false);
    expect(await readReminderDeviceBinding(secureStore, bindingB.memberId)).toEqual(bindingB);
  });

  it('serializes matching clear with a newer registration instead of deleting the newer keys after an await', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    expect(clearReminderDeviceBinding).toBeTypeOf('function');
    let releaseDelete!: () => void;
    let deletionStarted!: () => void;
    const started = new Promise<void>((resolve) => { deletionStarted = resolve; });
    const deleteItem = secureStore.deleteItemAsync;
    secureStore.deleteItemAsync = async (key) => {
      if (key === 'qingmu.reminder.deviceToken') { deletionStarted(); await new Promise<void>((resolve) => { releaseDelete = resolve; }); }
      await deleteItem(key);
    };
    const clear = clearReminderDeviceBinding(secureStore, bindingA);
    await started;
    const bindingB = { ...bindingA, memberId: 'member:b', bindingVersion: 3, ownerGeneration: 4 };
    let newerCommitted = false;
    const newer = registerBinding({ ...secureStore }, bindingB).then(() => { newerCommitted = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(newerCommitted).toBe(false);
    } finally { releaseDelete(); }
    expect(await clear).toBe(true);
    await newer;
    expect(await readReminderDeviceBinding(secureStore, bindingB.memberId)).toEqual(bindingB);
  });

  it('does not leave an old owner receipt valid after a legacy registration without owner metadata', async () => {
    const secureStore = store();
    await registerBinding(secureStore);
    await registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) }, generateInstallationId: () => bindingA.installationId,
      api: { registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true } });
    expect(readReminderDeviceBinding).toBeTypeOf('function');
    expect(await readReminderDeviceBinding(secureStore, bindingA.memberId)).toBeNull();
  });

  it('does not delete the newer owner when an old accepted registration returns after logout', async () => {
    const secureStore = store();
    let resolveRegistration!: (value: { registered: boolean; bindingVersion: number; ownerGeneration: number }) => void;
    let startedRegistration!: () => void;
    const started = new Promise<void>((resolve) => { startedRegistration = resolve; });
    let current = true;
    const bindingB = { ...bindingA, memberId: 'member:b', bindingVersion: 3, ownerGeneration: 4 };
    const compensate = vi.fn(async (captured: ReminderDeviceBinding) => { expect(captured).toEqual(bindingA); expect(await readReminderDeviceBinding(secureStore, bindingB.memberId)).toEqual(bindingB); return false; });
    const old = registerReminderDevice({ secureStore, memberId: bindingA.memberId, ownerGeneration: bindingA.ownerGeneration, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'android', data: bindingA.token }) },
      api: { registerReminderDeviceToken: () => { startedRegistration(); return new Promise((resolve) => { resolveRegistration = resolve; }); }, revokeReminderDeviceToken: async () => true }, generateInstallationId: () => bindingA.installationId,
      authority: { isCurrent: () => current, canCommit: () => current }, revokeDeviceBinding: compensate });
    await started;
    current = false;
    await registerBinding(secureStore, bindingB);
    resolveRegistration({ registered: true, bindingVersion: bindingA.bindingVersion, ownerGeneration: bindingA.ownerGeneration });
    await expect(old).resolves.toMatchObject({ registered: false });
    expect(compensate).toHaveBeenCalledOnce();
    expect(await readReminderDeviceBinding(secureStore, bindingB.memberId)).toEqual(bindingB);
  });
});
