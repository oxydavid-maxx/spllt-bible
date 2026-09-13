import { useSyncExternalStore } from 'react';
import { getAuthSession, isCurrentAuthSession, registerAuthLifecycleListener, type AuthSession } from './authSession';
import { buildUpcomingReadingReminderSpecs, createReminderScheduler, type ReminderScheduler } from './reminderScheduler';
import { createReminderReconciler, type ReminderReconciler } from './reminderReconciler';
import { registerReminderDevice, revokeReminderDevice, REMINDER_DEVICE_OWNER_GENERATION_KEY, type ReminderDeviceApi, type ReminderDeviceSecureStore, type ReminderDeviceTokenSource } from './reminderDevice';
import type { ReminderSnapshot } from './apiClient';

export interface ReminderRuntimeState {
  ready: boolean;
  error?: 'load' | 'save' | null;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  readingTime: string;
  meetingAdvanceMinutes: number;
  remoteDeliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
  permission: 'granted' | 'denied' | 'undetermined';
  meeting: ReminderSnapshot['meetings'][number] | null;
}

export interface ReminderRuntimeNotificationSource extends ReminderDeviceTokenSource {
  addPushTokenListener: (listener: () => void) => { remove: () => void };
}

export interface ReminderRuntimeApi extends ReminderDeviceApi {
  getReminderSnapshot: () => Promise<ReminderSnapshot | null>;
  saveReminderPreferences: (preferences: { readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number; preferenceGeneration?: number }) => Promise<ReminderSnapshot | null>;
}

export interface ReminderRuntimeOptions {
  requestTimeoutMs?: number;
  scheduler?: ReminderScheduler;
  secureStore: ReminderDeviceSecureStore;
  createApiClient: (session: AuthSession) => ReminderRuntimeApi;
  loadNotificationSource: () => Promise<ReminderRuntimeNotificationSource>;
  generateInstallationId: () => string;
  getCompletionStatus?: (memberId: string, taskDate: string) => 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED' | null;
}

const emptyState: ReminderRuntimeState = { ready: false, error: null, readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING', permission: 'undetermined', meeting: null };
type Preferences = { readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number };
let configuredOwner: ReminderRuntimeOwner | null = null;

export class ReminderRuntimeOwner {
  private readonly scheduler: ReminderScheduler;
  private readonly reconciler: ReminderReconciler;
  private readonly options: ReminderRuntimeOptions;
  private readonly listeners = new Set<() => void>();
  private state: ReminderRuntimeState = emptyState;
  private session: AuthSession | null = null;
  private generation = 0;
  private started = false;
  private unregisterAuth: (() => void) | null = null;
  private tokenSubscription: { remove: () => void } | null = null;
  private ownerGeneration = 0;
  private preferenceRevision = 0;
  private activationReady: Promise<void> | null = null;
  private activationBaselineReady = false;
  private pendingPreferences: Preferences | null = null;

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
  getSnapshot(): ReminderRuntimeState { return this.state; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private notify(): void { this.listeners.forEach((listener) => listener()); }
  private setState(next: ReminderRuntimeState): void { this.state = next; this.notify(); }
  private isCurrent(session: AuthSession, generation: number): boolean { return generation === this.generation && isCurrentAuthSession(session); }
  private async nextOwnerGeneration(): Promise<number> {
    const raw = await this.options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
    const previous = raw && Number.isInteger(Number(raw)) ? Number(raw) : 0;
    const next = previous + 1;
    await this.options.secureStore.setItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY, String(next));
    return next;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unregisterAuth = registerAuthLifecycleListener((change) => {
      if (change.invalidated) {
        const invalidated = change.invalidated;
        const cleanupGeneration = ++this.generation;
        this.session = null;
        this.activationBaselineReady = false;
        this.activationReady = null;
        this.pendingPreferences = null;
        this.tokenSubscription?.remove();
        this.tokenSubscription = null;
        this.setState(emptyState);
        void this.cleanupInvalidated(invalidated, cleanupGeneration, this.ownerGeneration);
      }
      if (change.current && isCurrentAuthSession(change.current)) void this.activate(change.current);
    });
    const current = getAuthSession();
    if (current && isCurrentAuthSession(current)) void this.activate(current);
  }

  private async cleanupInvalidated(session: AuthSession, generation: number, expectedOwnerGeneration?: number): Promise<void> {
    const expectedToken = await this.options.secureStore.getItemAsync('qingmu.reminder.deviceToken');
    await this.scheduler.cancelForMember(session.memberId).catch(() => undefined);
    if (generation !== this.generation && this.session?.memberId === session.memberId) return;
    await revokeReminderDevice({ secureStore: this.options.secureStore, api: this.options.createApiClient(session), expectedToken, expectedOwnerGeneration }).catch(() => false);
  }

  private async ensureTokenRegistration(session: AuthSession, generation: number, client: ReminderRuntimeApi): Promise<boolean> {
    const notifications = await this.options.loadNotificationSource();
    if (!this.isCurrent(session, generation)) return false;
    const authority = { isCurrent: () => this.isCurrent(session, generation) };
    const register = () => registerReminderDevice({ secureStore: this.options.secureStore, tokenSource: notifications, api: client, generateInstallationId: this.options.generateInstallationId, ownerGeneration: this.ownerGeneration, authority });
    const registered = await register();
    if (!registered.registered) return false;
    if (!this.isCurrent(session, generation)) return false;
    this.tokenSubscription?.remove();
    this.tokenSubscription = notifications.addPushTokenListener(() => { void register(); });
    return true;
  }

  private async activate(session: AuthSession): Promise<void> {
    const generation = ++this.generation;
    this.session = session;
    this.activationBaselineReady = false;
    this.setState(emptyState);
    const activation = (async () => {
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
      await this.reconcile(session, generation, nextState);
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

  private async reconcile(session: AuthSession, generation: number, state: ReminderRuntimeState): Promise<void> {
    if (!this.isCurrent(session, generation)) return;
    const readings = state.readingEnabled ? buildUpcomingReadingReminderSpecs(session.memberId, state.readingTime).filter((spec) => this.options.getCompletionStatus?.(session.memberId, spec.taskDate ?? '') !== 'COMPLETED') : [];
    await this.reconciler.reconcile({ memberId: session.memberId, readingEnabled: state.readingEnabled, remoteDeliveryStatus: state.remoteDeliveryStatus, meetingEnabled: state.meetingEnabled, reading: readings[0] ?? null, readings, meeting: state.meeting ? { meetingId: state.meeting.meetingId, scheduleRevision: state.meeting.scheduleRevision, status: state.meeting.status } : null }, () => this.isCurrent(session, generation));
  }

  async savePreferences(next: Preferences): Promise<void> {
    const session = this.session;
    const generation = this.generation;
    if (!session || !this.isCurrent(session, generation)) return;
    const intent = { ...next };
    this.pendingPreferences = intent;
    try {
      await this.persistPreferences(intent, session, generation);
    } catch {
      if (this.isCurrent(session, generation) && this.pendingPreferences === intent) {
        this.setState({ ...this.state, error: this.activationBaselineReady ? 'save' : 'load' });
      }
    }
  }

  private async persistPreferences(next: Preferences, session: AuthSession, generation: number): Promise<void> {
    const activation = this.activationReady;
    if (activation) await activation.catch(() => undefined);
    if (!this.activationBaselineReady || !this.isCurrent(session, generation)) return;
    this.setState({ ...this.state, error: null });
    const client = this.options.createApiClient(session);
    const preferenceRevision = ++this.preferenceRevision;
    const wasMeetingEnabled = this.state.meetingEnabled;
    if (next.readingEnabled || next.meetingEnabled) {
      const permission = await this.scheduler.requestPermission().catch(() => 'denied' as const);
      if (!this.isCurrent(session, generation)) return;
      if (permission === 'denied') { this.setState({ ...this.state, permission }); return; }
      this.setState({ ...this.state, permission });
      if (next.meetingEnabled) {
        if (!await this.ensureTokenRegistration(session, generation, client)) throw new Error('REMINDER_DEVICE_UNAVAILABLE');
      }
    }
    if (!next.meetingEnabled && wasMeetingEnabled) {
      this.tokenSubscription?.remove();
      this.tokenSubscription = null;
      await revokeReminderDevice({ secureStore: this.options.secureStore, api: client }).catch(() => false);
    }
    if (!this.isCurrent(session, generation)) return;
    const saved = await this.bounded(client.saveReminderPreferences({ ...next, preferenceGeneration: preferenceRevision }));
    if (!this.isCurrent(session, generation) || preferenceRevision !== this.preferenceRevision) return;
    if (!saved || saved.memberId !== session.memberId) throw new Error('REMINDER_SAVE_UNCONFIRMED');
    this.preferenceRevision = Math.max(this.preferenceRevision, saved.preferenceGeneration ?? preferenceRevision);
    const nextState: ReminderRuntimeState = { ready: true, error: null, readingEnabled: saved.readingEnabled, meetingEnabled: saved.meetingEnabled, readingTime: saved.readingTime, meetingAdvanceMinutes: saved.meetingAdvanceMinutes, remoteDeliveryStatus: saved.remoteDeliveryStatus, permission: this.state.permission, meeting: saved.meetings[0] ?? null };
    this.setState(nextState);
    await Promise.all([this.options.secureStore.setItemAsync('qingmu.reminder.readingEnabled', String(saved.readingEnabled)), this.options.secureStore.setItemAsync('qingmu.reminder.readingTime', saved.readingTime)]);
    await this.reconcile(session, generation, nextState);
    if (this.isCurrent(session, generation) && this.pendingPreferences === next) this.pendingPreferences = null;
  }

  async syncCompletion(memberId: string, taskDate: string): Promise<void> {
    const session = this.session;
    if (!session || session.memberId !== memberId || !isCurrentAuthSession(session)) return;
    await this.reconcile(session, this.generation, this.state);
  }

  dispose(): void { this.unregisterAuth?.(); this.unregisterAuth = null; this.tokenSubscription?.remove(); this.tokenSubscription = null; this.started = false; }
}

export function configureReminderRuntime(owner: ReminderRuntimeOwner): () => void { configuredOwner = owner; owner.start(); return () => { if (configuredOwner === owner) configuredOwner = null; owner.dispose(); }; }
export function getReminderRuntimeOwner(): ReminderRuntimeOwner | null { return configuredOwner; }
export function useReminderRuntimeSnapshot(): ReminderRuntimeState {
  const owner = configuredOwner;
  return useSyncExternalStore(owner?.subscribe ?? (() => () => undefined), owner?.getSnapshot.bind(owner) ?? (() => emptyState), owner?.getSnapshot.bind(owner) ?? (() => emptyState));
}
