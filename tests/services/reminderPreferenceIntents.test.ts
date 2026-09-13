import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };
const owners: ReminderRuntimeOwner[] = [];
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); clearAuthSession(); });
async function fixture() {
  const values = new Map<string, string>();
  const stored = new Map<string, any>([
    ['member:a', { memberId: 'member:a', readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 5, preferenceGeneration: 8, remoteDeliveryStatus: 'REMOTE_READY', meetings: [] }],
    ['member:b', { memberId: 'member:b', readingEnabled: false, meetingEnabled: false, readingTime: '09:00', meetingAdvanceMinutes: 60, preferenceGeneration: 3, remoteDeliveryStatus: 'LOCAL_ONLY', meetings: [] }],
  ]);
  const calls: Array<{ memberId: string; input: any; resolve(): void; reject(): void }> = [];
  setAuthSession({ memberId: 'member:a', sessionToken: 'session-a' });
  const owner = new ReminderRuntimeOwner({
    scheduler: { requestPermission: async () => 'granted', list: async () => [], schedule: async () => {}, cancel: async () => {}, cancelForMember: async () => {} } as any,
    secureStore: { getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); }, deleteItemAsync: async key => { values.delete(key); } },
    createApiClient: session => ({
      getReminderSnapshot: async () => ({ ...stored.get(session.memberId) }),
      saveReminderPreferences: input => new Promise((resolve, reject) => { calls.push({ memberId: session.memberId, input, resolve: () => { const previous = stored.get(session.memberId); if ((input.preferenceGeneration ?? 0) >= previous.preferenceGeneration) stored.set(session.memberId, { ...previous, ...input }); resolve({ ...stored.get(session.memberId) }); }, reject: () => reject(new Error('offline fixture')) }); }),
      registerReminderDeviceToken: async input => ({ registered: true, bindingVersion: 1, ownerGeneration: input.ownerGeneration }), revokeReminderDeviceToken: async () => true,
    }),
    loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'fixture-token' }), addPushTokenListener: () => ({ remove() {} }) }), generateInstallationId: () => 'fixture-installation',
  });
  owners.push(owner); owner.start(); await settle();
  return { owner, calls, stored };
}

describe('reminder preference field intents', () => {
  it('merges rapid different-field edits and saves their complete last intent', async () => {
    const f = await fixture();
    const writes = [f.owner.savePreferences({ readingEnabled: false }), f.owner.savePreferences({ meetingEnabled: false }), f.owner.savePreferences({ meetingAdvanceMinutes: 30 })];
    await settle();
    const latest = [...f.calls].sort((a, b) => b.input.preferenceGeneration - a.input.preferenceGeneration)[0];
    try { expect(latest?.input).toMatchObject({ readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 }); }
    finally { f.calls.forEach(call => call.resolve()); await Promise.all(writes); }
    expect(f.stored.get('member:a')).toMatchObject({ readingEnabled: false, meetingEnabled: false, meetingAdvanceMinutes: 30 });
  });

  it('keeps the newest same-field value visible while an older response arrives', async () => {
    const f = await fixture();
    const first = f.owner.savePreferences({ readingEnabled: false }); await settle();
    const second = f.owner.savePreferences({ readingEnabled: true }); await settle();
    expect(f.owner.getSnapshot().readingEnabled).toBe(true);
    f.calls[0].resolve(); await first;
    expect(f.owner.getSnapshot().readingEnabled).toBe(true);
    await settle();
    f.calls.at(-1)!.resolve(); await second;
    expect(f.stored.get('member:a').readingEnabled).toBe(true);
  });

  it('retains all pending fields after failure and retries their latest combined intent', async () => {
    const f = await fixture();
    const first = f.owner.savePreferences({ readingEnabled: false }); await settle();
    f.calls.at(-1)!.reject(); await first;
    const second = f.owner.savePreferences({ meetingAdvanceMinutes: 30 }); await settle();
    f.calls.at(-1)!.reject(); await second;
    expect(f.owner.getSnapshot()).toMatchObject({ readingEnabled: false, meetingAdvanceMinutes: 30, error: 'save' });
    const retry = f.owner.retrySave(); await settle();
    const latest = f.calls.at(-1)!;
    try { expect(latest.input).toMatchObject({ readingEnabled: false, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30 }); }
    finally { latest.resolve(); await retry; }
    expect(f.owner.getSnapshot().error).toBeNull();
  });

  it('does not carry an old owner’s pending fields or late response into a new owner', async () => {
    const f = await fixture();
    const old = f.owner.savePreferences({ readingTime: '12:15' }); await settle();
    const oldCall = f.calls.at(-1)!;
    setAuthSession({ memberId: 'member:b', sessionToken: 'session-b' }); await settle();
    const next = f.owner.savePreferences({ meetingAdvanceMinutes: 30 }); await settle();
    const nextCall = f.calls.at(-1)!;
    try { expect(nextCall.input).toMatchObject({ readingEnabled: false, meetingEnabled: false, readingTime: '09:00', meetingAdvanceMinutes: 30 }); }
    finally { oldCall.resolve(); nextCall.resolve(); await Promise.all([old, next]); }
    expect(f.owner.getSnapshot()).toMatchObject({ readingTime: '09:00', meetingAdvanceMinutes: 30 });
  });
});
