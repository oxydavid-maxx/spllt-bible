import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('react-native', () => ({}));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));

import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { ReminderRuntimeOwner } from '../../src/services/reminderRuntime';

function secureStore() {
  const values = new Map<string, string>();
  return { values, getItemAsync: async (key: string) => values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { values.set(key, value); }, deleteItemAsync: async (key: string) => { values.delete(key); } };
}

function scheduler() {
  const scheduled: any[] = [];
  return {
    scheduled,
    requestPermission: vi.fn(async () => 'granted' as const),
    list: vi.fn(async () => scheduled),
    schedule: vi.fn(async (spec: any) => { scheduled.push(spec); }),
    cancel: vi.fn(async (id: string) => { const index = scheduled.findIndex((item) => item.reminderId === id); if (index >= 0) scheduled.splice(index, 1); }),
    cancelForMember: vi.fn(async (memberId: string) => { for (const item of scheduled.filter((entry) => entry.memberId === memberId)) await schedulerValue.cancel(item.reminderId); }),
  };
}

let schedulerValue = scheduler();

describe('auth-owned reminder runtime', () => {
  afterEach(() => { clearAuthSession(); schedulerValue = scheduler(); });

  it('finishes a missing reminder endpoint as a recoverable error, then loads after retry', async () => {
    const snapshot = { memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [] };
    const getReminderSnapshot = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(snapshot);
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: secureStore(), createApiClient: () => ({ getReminderSnapshot, saveReminderPreferences: async () => null, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => { throw new Error('NOT_NEEDED'); }, generateInstallationId: () => 'install' });
    owner.start(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(owner.getSnapshot()).toMatchObject({ ready: false, error: 'load' });
    await owner.retryLoad();
    expect(owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingTime: '08:00' });
    expect(getReminderSnapshot).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it('contains a rejected load without leaving an endless loading state', async () => {
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: secureStore(), createApiClient: () => ({ getReminderSnapshot: async () => { throw new Error('NETWORK_OFFLINE'); }, saveReminderPreferences: async () => null, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => { throw new Error('NOT_NEEDED'); }, generateInstallationId: () => 'install' });
    owner.start(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(owner.getSnapshot()).toMatchObject({ ready: false, error: 'load' });
    owner.dispose();
  });

  it('times out a hanging read and ignores its late result after retry', async () => {
    let resolveOld!: (value: unknown) => void;
    const old = new Promise(resolve => { resolveOld = resolve; });
    const snapshot = { memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '09:30', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [] };
    const getReminderSnapshot = vi.fn().mockReturnValueOnce(old).mockResolvedValue(snapshot);
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ requestTimeoutMs: 5, scheduler: schedulerValue as any, secureStore: secureStore(), createApiClient: () => ({ getReminderSnapshot, saveReminderPreferences: async () => null, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => { throw new Error('NOT_NEEDED'); }, generateInstallationId: () => 'install' });
    owner.start(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(owner.getSnapshot()).toMatchObject({ ready: false, error: 'load' });
    await owner.retryLoad();
    resolveOld({ ...snapshot, readingTime: '06:00' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingTime: '09:30' });
    owner.dispose();
  });

  it('applies the user intent after a failed initial read is retried, using the recovered server generation', async () => {
    const snapshot = { memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 14, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [] };
    const getReminderSnapshot = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(snapshot);
    const save = vi.fn(async input => ({ ...snapshot, ...input }));
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: secureStore(), createApiClient: () => ({ getReminderSnapshot, saveReminderPreferences: save, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => { throw new Error('NOT_NEEDED'); }, generateInstallationId: () => 'install' });
    owner.start(); await new Promise(resolve => setTimeout(resolve, 0));
    await owner.savePreferences({ ...snapshot, readingTime: '10:30' });
    await owner.retryLoad();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ readingTime: '10:30', preferenceGeneration: 15 }));
    expect(owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingTime: '10:30' });
    owner.dispose();
  });

  it('reports an unconfirmed save and retries the intended setting without changing the account', async () => {
    const snapshot = { memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [] };
    const save = vi.fn().mockResolvedValueOnce(null).mockImplementation(async input => ({ ...snapshot, ...input }));
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: secureStore(), createApiClient: () => ({ getReminderSnapshot: async () => snapshot, saveReminderPreferences: save, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => { throw new Error('NOT_NEEDED'); }, generateInstallationId: () => 'install' });
    owner.start(); await new Promise(resolve => setTimeout(resolve, 0));
    await owner.savePreferences({ ...snapshot, readingTime: '09:15' });
    expect(owner.getSnapshot()).toMatchObject({ ready: true, error: 'save', saving: false, readingTime: '09:15' });
    await owner.retrySave();
    expect(owner.getSnapshot()).toMatchObject({ ready: true, error: null, readingTime: '09:15' });
    expect(save).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it('starts registration and keeps token rotation alive without AccountSurface mounted', async () => {
    const store = secureStore();
    const register = vi.fn(async (input: { ownerGeneration?: number }) => ({ registered: true, bindingVersion: 1, ownerGeneration: input.ownerGeneration }));
    let tokenListener: ((token?: { type: string; data: string }) => void) | undefined;
    let listenerActive = false;
    const api = { getReminderSnapshot: async () => ({ memberId: 'member:one', readingEnabled: false, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [] }), saveReminderPreferences: async () => null, registerReminderDeviceToken: register, revokeReminderDeviceToken: vi.fn(async () => true) };
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: () => api, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token-one' }), addPushTokenListener: (listener) => { tokenListener = listener; listenerActive = true; return { remove: () => { listenerActive = false; } }; } }), generateInstallationId: () => 'install-one' });
    owner.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(register).toHaveBeenCalledTimes(1);
    const listener = tokenListener as ((token?: { type: string; data: string }) => void) | undefined;
    if (listener) listener({ type: 'android', data: 'token-rotated' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(register).toHaveBeenCalledTimes(2);
    await owner.savePreferences({ readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    expect(listenerActive).toBe(false);
    owner.dispose();
  });

  it('leaves reading off and publishes denied permission when the scheduler denies', async () => {
    const store = secureStore();
    const denyingScheduler = { ...scheduler(), requestPermission: vi.fn(async () => 'denied' as const) };
    const saveCalls: any[] = [];
    const api = {
      getReminderSnapshot: async () => ({ memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] }),
      saveReminderPreferences: async (input: any) => { saveCalls.push(input); return { memberId: 'member:one', ...input, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] }; },
      registerReminderDeviceToken: async () => true,
      revokeReminderDeviceToken: async () => true,
    };
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: denyingScheduler as any, secureStore: store, createApiClient: () => api, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install-one' });
    owner.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await owner.savePreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    expect(owner.getSnapshot().readingEnabled).toBe(false);
    expect(owner.getSnapshot().permission).toBe('denied');
    expect(saveCalls).toHaveLength(0);
    owner.dispose();
  });

  it('does not rebuild a completed canonical date during the same preference reconcile', async () => {
    const store = secureStore();
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: () => ({ getReminderSnapshot: async () => ({ memberId: 'member:one', readingEnabled: true, meetingEnabled: false, readingTime: '07:45', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] }), saveReminderPreferences: async () => null, registerReminderDeviceToken: async () => true, revokeReminderDeviceToken: async () => true }), loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install-one', getCompletionStatus: (_memberId, taskDate) => taskDate === '2026-09-10' ? 'COMPLETED' : 'UNREPORTED' });
    owner.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(schedulerValue.scheduled.some((item) => item.taskDate === '2026-09-10')).toBe(false);
    owner.dispose();
  });

  it('drops an older preference response after a newer off intent wins', async () => {
    const store = secureStore();
    const oldResponse = (() => { let resolve!: (value: any) => void; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; })();
    let saveCount = 0;
    const api = {
      getReminderSnapshot: async () => ({ memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] }),
      saveReminderPreferences: async (input: any) => { saveCount += 1; if (saveCount === 1) return oldResponse.promise; return { memberId: 'member:one', ...input, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] }; },
      registerReminderDeviceToken: async () => true,
      revokeReminderDeviceToken: async () => true,
    };
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: () => api, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install-one' });
    owner.start(); await new Promise((resolve) => setTimeout(resolve, 0));
    const oldSave = owner.savePreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const newSave = owner.savePreferences({ readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    expect(owner.getSnapshot()).toMatchObject({ readingEnabled: false, saving: true });
    oldResponse.resolve({ memberId: 'member:one', readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'LOCAL_ONLY', meetings: [] });
    await Promise.all([oldSave, newSave]);
    expect(owner.getSnapshot().readingEnabled).toBe(false);
    owner.dispose();
  });

  it('clears the old runtime snapshot before a switched member snapshot resolves', async () => {
    const store = secureStore();
    let resolveB!: (value: any) => void;
    const api = (session: { memberId: string }) => ({
      getReminderSnapshot: async () => session.memberId === 'member:b' ? new Promise((resolve) => { resolveB = resolve; }) : ({ memberId: session.memberId, readingEnabled: false, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING' as const, meetings: [{ meetingId: 'meeting-a', title: 'A', startsAt: '2030-09-12T00:00:00Z', timeZone: 'Asia/Taipei', scheduleRevision: 1, status: 'SCHEDULED' as const }] }),
      saveReminderPreferences: async () => null,
      registerReminderDeviceToken: async () => true,
      revokeReminderDeviceToken: async () => true,
    });
    setAuthSession({ memberId: 'member:a', sessionToken: 'session-a' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: api as any, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install' });
    owner.start(); await new Promise((resolve) => setTimeout(resolve, 0));
    setAuthSession({ memberId: 'member:b', sessionToken: 'session-b' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(owner.getSnapshot().meeting).toBeNull();
    resolveB({ memberId: 'member:b', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'LOCAL_ONLY', meetings: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    owner.dispose();
  });

  it('queues an accepted startup preference until the authoritative read resolves', async () => {
    const store = secureStore();
    let resolveSnapshot!: (value: any) => void;
    const snapshotPromise = new Promise<any>((resolve) => { resolveSnapshot = resolve; });
    const saveCalls: any[] = [];
    const api = {
      getReminderSnapshot: async () => snapshotPromise,
      saveReminderPreferences: async (input: any) => {
        saveCalls.push(input);
        return { memberId: 'member:one', ...input, preferenceGeneration: input.preferenceGeneration, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] };
      },
      registerReminderDeviceToken: async () => true,
      revokeReminderDeviceToken: async () => true,
    };
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: () => api, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install-one' });
    owner.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const save = owner.savePreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveCalls).toHaveLength(0);
    resolveSnapshot({ memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 0, remoteDeliveryStatus: 'LOCAL_ONLY', meetings: [] });
    await save;
    expect(saveCalls[0]).toMatchObject({ readingEnabled: true, preferenceGeneration: 1 });
    expect(owner.getSnapshot()).toMatchObject({ ready: true, readingEnabled: true });
    owner.dispose();
  });

  it('uses the server preference generation after startup before saving the latest intent', async () => {
    const store = secureStore();
    let resolveSnapshot!: (value: any) => void;
    const snapshotPromise = new Promise<any>((resolve) => { resolveSnapshot = resolve; });
    let serverGeneration = 17;
    let serverReading = false;
    const saveCalls: any[] = [];
    const api = {
      getReminderSnapshot: async () => snapshotPromise,
      saveReminderPreferences: async (input: any) => {
        saveCalls.push(input);
        if (input.preferenceGeneration > serverGeneration) {
          serverGeneration = input.preferenceGeneration;
          serverReading = input.readingEnabled;
        }
        return { memberId: 'member:one', readingEnabled: serverReading, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: serverGeneration, remoteDeliveryStatus: 'LOCAL_ONLY' as const, meetings: [] };
      },
      registerReminderDeviceToken: async () => true,
      revokeReminderDeviceToken: async () => true,
    };
    setAuthSession({ memberId: 'member:one', sessionToken: 'session-one' });
    const owner = new ReminderRuntimeOwner({ scheduler: schedulerValue as any, secureStore: store, createApiClient: () => api, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'token' }), addPushTokenListener: () => ({ remove: vi.fn() }) }), generateInstallationId: () => 'install-one' });
    owner.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const save = owner.savePreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveCalls).toHaveLength(0);
    resolveSnapshot({ memberId: 'member:one', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 17, remoteDeliveryStatus: 'LOCAL_ONLY', meetings: [] });
    await save;
    expect(saveCalls[0]).toMatchObject({ readingEnabled: true, preferenceGeneration: 18 });
    expect(serverReading).toBe(true);
    expect(owner.getSnapshot()).toMatchObject({ ready: true, readingEnabled: true });
    owner.dispose();
  });

  it('keeps generated auth-owned reminder sequences aligned with actual runtime state', async () => {
    const actions = fc.array(fc.constantFrom('readingOn', 'readingOff', 'meetingOn', 'meetingOff', 'rotate' as const), { minLength: 1, maxLength: 8 });
    await fc.assert(fc.asyncProperty(actions, async (sequence) => {
      const store = secureStore();
      const scheduled: any[] = [];
      const tokenListeners = new Set<(token?: { type: string; data: string }) => void>();
      const apiState: any = { memberId: 'member:property', readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, preferenceGeneration: 0, remoteDeliveryStatus: 'REMOTE_PENDING', meetings: [] };
      let registrations = 0;
      let revocations = 0;
      const scheduler = {
        requestPermission: vi.fn(async () => 'granted' as const),
        list: vi.fn(async () => scheduled),
        schedule: vi.fn(async (spec: any) => { scheduled.push(spec); }),
        cancel: vi.fn(async (id: string) => { const index = scheduled.findIndex((item) => item.reminderId === id); if (index >= 0) scheduled.splice(index, 1); }),
        cancelForMember: vi.fn(async (memberId: string) => { for (let index = scheduled.length - 1; index >= 0; index -= 1) if (scheduled[index].memberId === memberId) scheduled.splice(index, 1); }),
      };
      const snapshot = () => ({ ...apiState, meetings: [] });
      const api = {
        getReminderSnapshot: async () => snapshot(),
        saveReminderPreferences: async (input: any) => { Object.assign(apiState, input); return snapshot(); },
        registerReminderDeviceToken: async (input: { ownerGeneration: number }) => { registrations += 1; return { registered: true, bindingVersion: registrations, ownerGeneration: input.ownerGeneration }; },
        revokeReminderDeviceToken: async () => { revocations += 1; return true; },
      };
      setAuthSession({ memberId: 'member:property', sessionToken: 'session-property' });
      const owner = new ReminderRuntimeOwner({ scheduler: scheduler as any, secureStore: store, createApiClient: () => api as any, loadNotificationSource: async () => ({ getDevicePushTokenAsync: async () => ({ type: 'android', data: 'property-token' }), addPushTokenListener: (listener) => { tokenListeners.add(listener); return { remove: () => tokenListeners.delete(listener) }; } }), generateInstallationId: () => 'property-installation' });
      try {
        owner.start();
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const action of sequence) {
          if (action === 'rotate') { for (const listener of [...tokenListeners]) listener({ type: 'android', data: `property-token-${registrations}` }); await new Promise((resolve) => setTimeout(resolve, 0)); continue; }
          const current = owner.getSnapshot();
          await owner.savePreferences({ readingEnabled: action === 'readingOn' ? true : action === 'readingOff' ? false : current.readingEnabled, meetingEnabled: action === 'meetingOn' ? true : action === 'meetingOff' ? false : current.meetingEnabled, readingTime: current.readingTime, meetingAdvanceMinutes: current.meetingAdvanceMinutes });
        }
        const state = owner.getSnapshot();
        expect(state.readingEnabled).toBe(apiState.readingEnabled);
        expect(state.meetingEnabled).toBe(apiState.meetingEnabled);
        expect(scheduled.every((job) => job.memberId === 'member:property')).toBe(true);
        expect(tokenListeners.size).toBe(state.meetingEnabled ? 1 : 0);
        expect(registrations).toBeGreaterThanOrEqual(revocations);
      } finally {
        owner.dispose();
        clearAuthSession();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }), { numRuns: 20, seed: 260909 });
  });
});
