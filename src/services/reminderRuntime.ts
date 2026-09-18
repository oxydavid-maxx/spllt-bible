import { useSyncExternalStore } from 'react';
import { getAuthSession, getAuthSnapshot, isCurrentAuthSession, registerAuthLifecycleListener, type AuthSession } from './authSession';
import { buildUpcomingReadingReminderSpecs, createReminderScheduler, type ReadingScheduleEntry, type ReminderScheduler } from './reminderScheduler';
import { createReminderReconciler, type ReminderReconciler } from './reminderReconciler';
import { registerReminderDevice, readReminderDeviceBinding, clearReminderDeviceBinding, REMINDER_DEVICE_OWNER_GENERATION_KEY, REMINDER_DEVICE_OWNER_SEQUENCE_KEY, type PendingReminderDeviceRevocations, type ReminderDeviceBinding, type ReminderDeviceApi, type ReminderDeviceSecureStore, type ReminderDeviceTokenSource } from './reminderDevice';
import { isReminderTokenExpiry } from './reminderLifecycle';
import type { ReminderSnapshot } from './apiClient';
import { taipeiDate } from '../domain/gamificationV1';

export interface ReminderRuntimeState {
  ready: boolean;
  error?: 'load' | 'save' | null;
  saving?: boolean;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  readingTime: string;
  meetingAdvanceMinutes: number;
  remoteDeliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
  permission: 'granted' | 'denied' | 'undetermined';
  meeting: ReminderSnapshot['meetings'][number] | null;
}

export interface ReminderRuntimeNotificationSource extends ReminderDeviceTokenSource {
  addPushTokenListener: (listener: (token?: { type: string; data: string }) => void) => { remove: () => void };
}

export interface ReminderRuntimeApi extends ReminderDeviceApi {
  getReminderSnapshot: () => Promise<ReminderSnapshot | null>;
  saveReminderPreferences: (preferences: { readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number; preferenceGeneration?: number }) => Promise<ReminderSnapshot | null>;
  getReadingDays?: (from: string, to: string) => Promise<{ today: string; timezone: string; days: Array<{ taskDate: string; planId: string; sourceRevision: number }> } | null>;
}

export interface ReminderRuntimeOptions {
  requestTimeoutMs?: number;
  scheduler?: ReminderScheduler;
  secureStore: ReminderDeviceSecureStore;
  createApiClient: (session: AuthSession) => ReminderRuntimeApi;
  revokeDeviceBinding?: (binding: ReminderDeviceBinding) => Promise<boolean>;
  deviceRevokeQueue?: PendingReminderDeviceRevocations;
  loadNotificationSource: () => Promise<ReminderRuntimeNotificationSource>;
  generateInstallationId: () => string;
  getCompletionStatus?: (memberId: string, taskDate: string, planId?: string) => 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED' | null;
}

const emptyState: ReminderRuntimeState = { ready: false, error: null, readingEnabled: false, meetingEnabled: false, readingTime: '06:30', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING', permission: 'undetermined', meeting: null };
type Preferences = { readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number };
function preferencePatch(value: Partial<Preferences>): Partial<Preferences> {
  return {
    ...(value.readingEnabled !== undefined ? { readingEnabled: value.readingEnabled } : {}),
    ...(value.meetingEnabled !== undefined ? { meetingEnabled: value.meetingEnabled } : {}),
    ...(value.readingTime !== undefined ? { readingTime: value.readingTime } : {}),
    ...(value.meetingAdvanceMinutes !== undefined ? { meetingAdvanceMinutes: value.meetingAdvanceMinutes } : {}),
  };
}
let configuredOwner: ReminderRuntimeOwner | null = null;

export class ReminderRuntimeOwner {
  private readonly scheduler: ReminderScheduler;
  private readonly reconciler: ReminderReconciler;
  private readonly options: ReminderRuntimeOptions;
  private readonly listeners = new Set<() => void>();
  private state: ReminderRuntimeState = emptyState;
  private visibleState: ReminderRuntimeState = emptyState;
  private session: AuthSession | null = null;
  private generation = 0;
  private started = false;
  private unregisterAuth: (() => void) | null = null;
  private tokenSubscription: { remove: () => void } | null = null;
  private ownerGeneration = 0;
  private preferenceRevision = 0;
  private activationReady: Promise<void> | null = null;
  private activationBaselineReady = false;
  private pendingPreferences: Partial<Preferences> | null = null;
  private preferenceWork: Promise<void> = Promise.resolve();
  private localCleanup: Promise<void> = Promise.resolve();
  private suspendedRegistration: { session: AuthSession; generation: number } | null = null;

  private async bounded<T>(request: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([request, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('REMINDER_REQUEST_TIMEOUT')), this.options.requestTimeoutMs ?? 15000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  constructor(options: ReminderRuntimeOptions) {
    this.options = options;
    this.scheduler = options.scheduler ?? createReminderScheduler();
    this.reconciler = createReminderReconciler(this.scheduler);
  }

  getScheduler(): ReminderScheduler { return this.scheduler; }
  getSnapshot(): ReminderRuntimeState { return this.visibleState; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private notify(): void { this.listeners.forEach((listener) => listener()); }
  private updateVisibleState(): void {
    this.visibleState = { ...this.state, ...this.pendingPreferences, saving: Boolean(this.pendingPreferences && this.activationBaselineReady && !this.state.error) };
    this.notify();
  }
  private setState(next: ReminderRuntimeState): void { this.state = next; this.updateVisibleState(); }
  private isCurrent(session: AuthSession, generation: number): boolean { return generation === this.generation && isCurrentAuthSession(session); }
  private async nextOwnerGeneration(): Promise<number> {
    const values = await Promise.all([this.options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_SEQUENCE_KEY), this.options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY)]);
    const previous = Math.max(0, ...values.map(raw => raw && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0));
    const next = previous + 1;
    await this.options.secureStore.setItemAsync(REMINDER_DEVICE_OWNER_SEQUENCE_KEY, String(next));
    return next;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unregisterAuth = registerAuthLifecycleListener((change) => {
      if (change.invalidated) {
        const invalidated = change.invalidated;
        const expiryOnly = isReminderTokenExpiry(change);
        const interactiveRevokeAllowed = this.suspendedRegistration === null && !expiryOnly;
        if (!expiryOnly) this.suspendedRegistration = null;
        else if (!this.suspendedRegistration || this.suspendedRegistration.session.memberId !== invalidated.memberId || this.suspendedRegistration.session.sessionToken !== invalidated.sessionToken) {
          this.suspendedRegistration = { session: invalidated, generation: this.generation };
        }
        this.generation += 1;
        this.session = null;
        this.activationBaselineReady = false;
        this.activationReady = null;
        this.pendingPreferences = null;
        this.preferenceWork = Promise.resolve();
        this.tokenSubscription?.remove();
        this.tokenSubscription = null;
        this.setState(expiryOnly ? { ...this.state, ready: false, error: null } : emptyState);
        if (!expiryOnly) {
          this.localCleanup = this.localCleanup.then(() => this.cleanupInvalidated(invalidated, interactiveRevokeAllowed)).catch(() => undefined);
        }
      }
      if (change.current && isCurrentAuthSession(change.current)) void this.activate(change.current);
    });
    const current = getAuthSession();
    if (current && isCurrentAuthSession(current)) void this.activate(current);
    else if (current && getAuthSnapshot().status === 'expired') this.suspendedRegistration = { session: current, generation: this.generation };
  }

  private async cleanupInvalidated(session: AuthSession, interactiveRevokeAllowed: boolean): Promise<void> {
    const binding = await readReminderDeviceBinding(this.options.secureStore, session.memberId);
    await this.scheduler.cancelForMember(session.memberId).catch(() => undefined);
    if (!binding) return;
    await this.releaseCapturedBinding(binding, session, interactiveRevokeAllowed);
  }

  private async releaseCapturedBinding(binding: ReminderDeviceBinding, session: AuthSession, interactiveRevokeAllowed: boolean): Promise<void> {
    const queue = this.options.deviceRevokeQueue;
    // Never discard the only retry credential before SecureStore acknowledges it.
    if (queue) await queue.enqueue(binding);
    const cleared = await clearReminderDeviceBinding(this.options.secureStore, binding);
    if (queue) { void queue.flush().catch(() => undefined); return; }
    if (!cleared) return;
    // Local revocation finishes before the next owner starts. A slow remote reply
    // may only revoke this captured owner/version, never whatever is stored later.
    void this.revokeCapturedBinding(binding, session, interactiveRevokeAllowed).catch(() => false);
  }

  private revokeCapturedBinding(binding: ReminderDeviceBinding, session: AuthSession, interactiveRevokeAllowed: boolean): Promise<boolean> {
    if (this.options.revokeDeviceBinding) return this.options.revokeDeviceBinding(binding);
    if (interactiveRevokeAllowed) return this.options.createApiClient(session).revokeReminderDeviceToken(binding.installationId, binding.bindingVersion, binding.ownerGeneration);
    return Promise.resolve(false);
  }

  private async ensureTokenRegistration(session: AuthSession, generation: number, client: ReminderRuntimeApi): Promise<boolean> {
    if (this.tokenSubscription) {
      const existing = await readReminderDeviceBinding(this.options.secureStore, session.memberId);
      if (!this.isCurrent(session, generation)) return false;
      if (existing?.ownerGeneration === this.ownerGeneration) return true;
    }
    const notifications = await this.options.loadNotificationSource();
    if (!this.isCurrent(session, generation)) return false;
    const authority = {
      isCurrent: () => this.isCurrent(session, generation),
      canCommit: () => {
        const current = getAuthSnapshot();
        const suspended = this.suspendedRegistration;
        return this.isCurrent(session, generation) || Boolean(suspended && suspended.generation === generation && current.status === 'expired' && current.session?.memberId === session.memberId && current.session.sessionToken === session.sessionToken && suspended.session.memberId === session.memberId && suspended.session.sessionToken === session.sessionToken);
      },
    };
    const register = (eventToken?: { type: string; data: string }) => registerReminderDevice({ secureStore: this.options.secureStore, tokenSource: eventToken ? { getDevicePushTokenAsync: async () => eventToken } : notifications, api: client, memberId: session.memberId, generateInstallationId: this.options.generateInstallationId, ownerGeneration: this.ownerGeneration, authority, revokeDeviceBinding: this.options.revokeDeviceBinding, deviceRevokeQueue: this.options.deviceRevokeQueue });
    const registered = await register();
    if (!registered.registered) return false;
    if (!this.isCurrent(session, generation)) return false;
    this.tokenSubscription?.remove();
    this.tokenSubscription = notifications.addPushTokenListener(token => {
      // Expo explicitly warns that calling its getter here emits this listener
      // again. Use the event payload; the producer deduplicates identical tokens.
      if (!token || typeof token.data !== 'string' || !this.isCurrent(session, generation)) return;
      void register(token).then(result => {
        if (!result.registered && this.isCurrent(session, generation)) this.setState({ ...this.state, error: 'load' });
      }).catch(() => { if (this.isCurrent(session, generation)) this.setState({ ...this.state, error: 'load' }); });
    });
    return true;
  }

  private async activate(session: AuthSession): Promise<void> {
    const generation = ++this.generation;
    this.session = session;
    this.suspendedRegistration = null;
    this.activationBaselineReady = false;
    this.preferenceWork = Promise.resolve();
    this.setState(emptyState);
    const activation = (async () => {
      await this.localCleanup;
      if (!this.isCurrent(session, generation)) return;
      this.ownerGeneration = await this.nextOwnerGeneration();
      if (!this.isCurrent(session, generation)) return;
      this.tokenSubscription?.remove();
      this.tokenSubscription = null;
      const client = this.options.createApiClient(session);
      const next = await this.bounded(client.getReminderSnapshot());
      if (!this.isCurrent(session, generation)) return;
      if (!next || next.memberId !== session.memberId) throw new Error('REMINDER_SNAPSHOT_UNAVAILABLE');
      this.preferenceRevision = next.preferenceGeneration ?? 0;
      let permission: ReminderRuntimeState['permission'] = 'undetermined';
      if (next.readingEnabled || next.meetingEnabled) {
        permission = await this.scheduler.requestPermission().catch(() => 'denied' as const);
        if (!this.isCurrent(session, generation)) return;
        if (permission === 'granted' && next.meetingEnabled) {
          if (!await this.ensureTokenRegistration(session, generation, client)) throw new Error('REMINDER_DEVICE_UNAVAILABLE');
        }
      }
      if (!this.isCurrent(session, generation)) return;
      const nextState: ReminderRuntimeState = { ready: false, error: null, readingEnabled: next.readingEnabled, meetingEnabled: next.meetingEnabled, readingTime: next.readingTime, meetingAdvanceMinutes: next.meetingAdvanceMinutes, remoteDeliveryStatus: next.remoteDeliveryStatus, permission, meeting: next.meetings[0] ?? null };
      this.setState(nextState);
      await Promise.all([this.options.secureStore.setItemAsync('qingmu.reminder.readingEnabled', String(next.readingEnabled)), this.options.secureStore.setItemAsync('qingmu.reminder.readingTime', next.readingTime)]);
      await this.reconcile(session, generation, nextState, client);
      if (!this.isCurrent(session, generation)) return;
      this.activationBaselineReady = true;
      this.setState({ ...nextState, ready: true });
    })();
    this.activationReady = activation;
    try {
      await activation;
    } catch {
      if (this.isCurrent(session, generation)) this.setState({ ...this.state, ready: false, error: 'load' });
    } finally {
      if (this.activationReady === activation) this.activationReady = null;
    }
  }

  async retryLoad(): Promise<void> {
    if (this.activationReady) { await this.activationReady.catch(() => undefined); return; }
    const session = this.session;
    if (!session || !isCurrentAuthSession(session)) return;
    await this.activate(session);
    if (this.session === session && isCurrentAuthSession(session) && this.activationBaselineReady && this.pendingPreferences) {
      await this.savePreferences(this.pendingPreferences);
    }
  }

  async retrySave(): Promise<void> {
    if (this.pendingPreferences) await this.savePreferences(this.pendingPreferences);
  }

  private async loadReadingSchedule(session: AuthSession, generation: number, client: ReminderRuntimeApi): Promise<ReadingScheduleEntry[] | null> {
    if (!client.getReadingDays) return [];
    const from = taipeiDate(new Date());
    const to = shiftDate(from, 61);
    try {
      const response = await this.bounded(client.getReadingDays(from, to));
      if (!this.isCurrent(session, generation) || !response || response.timezone !== 'Asia/Taipei') return null;
      return response.days
        .filter((day) => typeof day.taskDate === 'string' && typeof day.planId === 'string' && day.planId.trim().length > 0 && Number.isSafeInteger(day.sourceRevision) && day.sourceRevision >= 0)
        .map((day) => ({ taskDate: day.taskDate, planId: day.planId, scheduleRevision: day.sourceRevision }));
    } catch {
      return null;
    }
  }

  private async reconcile(session: AuthSession, generation: number, state: ReminderRuntimeState, client?: ReminderRuntimeApi): Promise<void> {
    if (!this.isCurrent(session, generation)) return;
    const readingSchedule = state.readingEnabled ? await this.loadReadingSchedule(session, generation, client ?? this.options.createApiClient(session)) : [];
    if (state.readingEnabled && readingSchedule === null) return;
    const readings = state.readingEnabled ? buildUpcomingReadingReminderSpecs(session.memberId, state.readingTime, new Date(), readingSchedule ?? []).filter((spec) => this.options.getCompletionStatus?.(session.memberId, spec.taskDate ?? '', spec.targetId) !== 'COMPLETED') : [];
    await this.reconciler.reconcile({ memberId: session.memberId, readingEnabled: state.readingEnabled, remoteDeliveryStatus: state.remoteDeliveryStatus, meetingEnabled: state.meetingEnabled, reading: readings[0] ?? null, readings, meeting: state.meeting ? { meetingId: state.meeting.meetingId, scheduleRevision: state.meeting.scheduleRevision, status: state.meeting.status } : null }, () => this.isCurrent(session, generation));
  }

  async savePreferences(next: Partial<Preferences>): Promise<void> {
    const session = this.session;
    const generation = this.generation;
    if (!session || !this.isCurrent(session, generation)) return;
    const intent = { ...this.pendingPreferences, ...preferencePatch(next) };
    this.pendingPreferences = intent;
    this.setState({ ...this.state, error: null });
    // Serialize side effects as well as writes. Unstarted obsolete jobs coalesce
    // into the newest field intent; an in-flight old save cannot overtake it.
    const work = this.preferenceWork.then(() => this.persistPreferences(intent, session, generation));
    this.preferenceWork = work.catch(() => undefined);
    try {
      await work;
    } catch {
      if (this.isCurrent(session, generation) && this.pendingPreferences === intent) {
        this.setState({ ...this.state, error: this.activationBaselineReady ? 'save' : 'load' });
      }
    }
  }

  private async persistPreferences(intent: Partial<Preferences>, session: AuthSession, generation: number): Promise<void> {
    const activation = this.activationReady;
    if (activation) await activation.catch(() => undefined);
    if (!this.activationBaselineReady || !this.isCurrent(session, generation) || this.pendingPreferences !== intent) return;
    const next: Preferences = { readingEnabled: this.state.readingEnabled, meetingEnabled: this.state.meetingEnabled, readingTime: this.state.readingTime, meetingAdvanceMinutes: this.state.meetingAdvanceMinutes, ...intent };
    this.setState({ ...this.state, error: null });
    const client = this.options.createApiClient(session);
    const preferenceRevision = ++this.preferenceRevision;
    const wasMeetingEnabled = this.state.meetingEnabled;
    if (next.readingEnabled || next.meetingEnabled) {
      const permission = await this.scheduler.requestPermission().catch(() => 'denied' as const);
      if (!this.isCurrent(session, generation) || this.pendingPreferences !== intent) return;
      if (permission === 'denied') { this.pendingPreferences = null; this.setState({ ...this.state, permission }); return; }
      this.setState({ ...this.state, permission });
      if (next.meetingEnabled) {
        if (!await this.ensureTokenRegistration(session, generation, client)) throw new Error('REMINDER_DEVICE_UNAVAILABLE');
      }
    }
    if (!next.meetingEnabled && wasMeetingEnabled) {
      this.tokenSubscription?.remove();
      this.tokenSubscription = null;
      const binding = await readReminderDeviceBinding(this.options.secureStore, session.memberId);
      if (!this.isCurrent(session, generation) || this.pendingPreferences !== intent) return;
      if (binding) await this.releaseCapturedBinding(binding, session, true);
    }
    if (!this.isCurrent(session, generation) || this.pendingPreferences !== intent) return;
    const saved = await this.bounded(client.saveReminderPreferences({ ...next, preferenceGeneration: preferenceRevision }));
    if (!this.isCurrent(session, generation) || preferenceRevision !== this.preferenceRevision || this.pendingPreferences !== intent) return;
    if (!saved || saved.memberId !== session.memberId) throw new Error('REMINDER_SAVE_UNCONFIRMED');
    this.preferenceRevision = Math.max(this.preferenceRevision, saved.preferenceGeneration ?? preferenceRevision);
    const nextState: ReminderRuntimeState = { ready: true, error: null, readingEnabled: saved.readingEnabled, meetingEnabled: saved.meetingEnabled, readingTime: saved.readingTime, meetingAdvanceMinutes: saved.meetingAdvanceMinutes, remoteDeliveryStatus: saved.remoteDeliveryStatus, permission: this.state.permission, meeting: saved.meetings[0] ?? null };
    this.setState(nextState);
    await Promise.all([this.options.secureStore.setItemAsync('qingmu.reminder.readingEnabled', String(saved.readingEnabled)), this.options.secureStore.setItemAsync('qingmu.reminder.readingTime', saved.readingTime)]);
    await this.reconcile(session, generation, nextState, client);
    if (this.isCurrent(session, generation) && this.pendingPreferences === intent) { this.pendingPreferences = null; this.updateVisibleState(); }
  }

  async syncCompletion(memberId: string, taskDate: string): Promise<void> {
    const session = this.session;
    if (!session || session.memberId !== memberId || !isCurrentAuthSession(session)) return;
    await this.reconcile(session, this.generation, this.state);
  }

  dispose(): void { this.unregisterAuth?.(); this.unregisterAuth = null; this.tokenSubscription?.remove(); this.tokenSubscription = null; this.started = false; }
}

function shiftDate(date: string, offsetDays: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function configureReminderRuntime(owner: ReminderRuntimeOwner): () => void { configuredOwner = owner; owner.start(); return () => { if (configuredOwner === owner) configuredOwner = null; owner.dispose(); }; }
export function getReminderRuntimeOwner(): ReminderRuntimeOwner | null { return configuredOwner; }
export function useReminderRuntimeSnapshot(): ReminderRuntimeState {
  const owner = configuredOwner;
  return useSyncExternalStore(owner?.subscribe ?? (() => () => undefined), owner?.getSnapshot.bind(owner) ?? (() => emptyState), owner?.getSnapshot.bind(owner) ?? (() => emptyState));
}
