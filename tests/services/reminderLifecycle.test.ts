import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));

import { clearAuthSession, markAuthExpired, setAuthSession } from '../../src/services/authSession';
import { configureReminderLifecycle } from '../../src/services/reminderLifecycle';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY } from '../../src/services/reminderDevice';

function store(installationId: string | null) {
  const values = new Map<string, string>();
  if (installationId) values.set('qingmu.reminder.installationId', installationId);
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  };
}

describe('auth-owned reminder lifetime', () => {
  afterEach(() => { clearAuthSession(); });

  it('keeps reminders untouched when the account route simply unmounts', async () => {
    const secureStore = store('install-valid');
    const scheduler = { cancelForMember: vi.fn(async () => undefined) };
    const revoke = vi.fn(async () => true);
    const dispose = configureReminderLifecycle({ scheduler: scheduler as any, secureStore, createApiClient: () => ({ revokeReminderDeviceToken: revoke } as any) });
    await Promise.resolve();
    expect(scheduler.cancelForMember).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    dispose();
  });

  it('cancels and revokes on switch/logout while preserving opt-in on expiry', async () => {
    const secureStore = store('install-old');
    const scheduler = { cancelForMember: vi.fn(async () => undefined) };
    const revoked: string[] = [];
    const seedOwner = (memberId: string, generation: number) => {
      const binding = { memberId, installationId: 'install-old', token: `device-${generation}`, bindingVersion: generation, ownerGeneration: generation };
      secureStore.values.set('qingmu.reminder.deviceToken', binding.token);
      secureStore.values.set('qingmu.reminder.bindingVersion', String(generation));
      secureStore.values.set('qingmu.reminder.ownerGeneration', String(generation));
      secureStore.values.set(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify(binding));
    };
    const dispose = configureReminderLifecycle({ scheduler: scheduler as any, secureStore, createApiClient: () => ({ revokeReminderDeviceToken: async () => { throw new Error('Use captured device authority'); } } as any), revokeDeviceBinding: async binding => { revoked.push(`${binding.memberId}:${binding.installationId}`); return true; } });
    seedOwner('member:old', 1);
    setAuthSession({ memberId: 'member:old', sessionToken: 'old-token' });
    setAuthSession({ memberId: 'member:new', sessionToken: 'new-token' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    seedOwner('member:new', 2);
    const cancellations = scheduler.cancelForMember.mock.calls.length;
    markAuthExpired();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler.cancelForMember).toHaveBeenCalledTimes(cancellations);
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBe('device-2');
    clearAuthSession();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler.cancelForMember).toHaveBeenCalledWith('member:old');
    expect(scheduler.cancelForMember).toHaveBeenCalledWith('member:new');
    expect(revoked).toContain('member:old:install-old');
    expect(revoked).toContain('member:new:install-old');
    dispose();
  });

  it('does not let delayed old cleanup revoke or delete a newer same-member token', async () => {
    const secureStore = store('old-token');
    const cancelDeferred = (() => { let resolve!: () => void; const promise = new Promise<void>((next) => { resolve = next; }); return { promise, resolve }; })();
    const scheduler = { cancelForMember: vi.fn(async () => cancelDeferred.promise) };
    const revoke = vi.fn(async () => true);
    const dispose = configureReminderLifecycle({ scheduler: scheduler as any, secureStore, createApiClient: () => ({ revokeReminderDeviceToken: revoke } as any) });
    setAuthSession({ memberId: 'member:same', sessionToken: 'old-session' });
    clearAuthSession();
    setAuthSession({ memberId: 'member:same', sessionToken: 'new-session' });
    await secureStore.setItemAsync('qingmu.reminder.deviceToken', 'new-token');
    cancelDeferred.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoke).not.toHaveBeenCalled();
    expect(secureStore.values.get('qingmu.reminder.deviceToken')).toBe('new-token');
    dispose();
  });
});
