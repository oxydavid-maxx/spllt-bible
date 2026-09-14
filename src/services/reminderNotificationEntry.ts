import type { AuthSnapshot } from './authSession';
import type { HeadlessMeetingPayload, HeadlessValidationResult } from './reminderDelivery';
import type { NotificationBehavior } from 'expo-notifications';
export type ReminderEntryAuth = Pick<AuthSnapshot, 'status' | 'session' | 'epoch'>;
type Options = { getAuth: () => ReminderEntryAuth; canNavigate: () => boolean; defaultActionIdentifier: string; validateLatest: (payload: HeadlessMeetingPayload) => Promise<HeadlessValidationResult>; openReadingDate: (date: string) => void; openMeeting: (meetingId: string) => void };
type Disposition = 'handled' | 'ignored' | 'deferred';
const hiddenBehavior: NotificationBehavior = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
const visibleBehavior: NotificationBehavior = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
type Entry = { kind: 'READING'; memberId: string; taskDate: string } | { kind: 'MEETING'; memberId: string; payload: HeadlessMeetingPayload };
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function dataOf(notification: unknown) { return record(record(record(notification)?.request)?.content)?.data; }
function entryOf(notification: unknown): Entry | null {
  const data = record(dataOf(notification));
  if (!data || typeof data.memberId !== 'string' || !data.memberId.trim()) return null;
  if (data.kind === 'READING') {
    if (typeof data.taskDate !== 'string' || !validDateOnly(data.taskDate) || typeof data.targetId !== 'string' || !data.targetId.trim() || data.reminderId !== `reading:${data.memberId}:${data.taskDate}`) return null;
    return { kind: 'READING', memberId: data.memberId, taskDate: data.taskDate };
  }
  const revision = typeof data.scheduleRevision === 'string' && data.scheduleRevision.trim() ? Number(data.scheduleRevision) : data.scheduleRevision;
  if (data.event !== 'MEETING_REMINDER' || typeof data.reminderId !== 'string' || !data.reminderId.trim() || typeof data.meetingId !== 'string' || !data.meetingId.trim() || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  return { kind: 'MEETING', memberId: data.memberId, payload: { event: 'MEETING_REMINDER', reminderId: data.reminderId, meetingId: data.meetingId, scheduleRevision: revision } };
}
function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function responseKey(response: unknown): string | null {
  const value = record(response); const notification = record(value?.notification); const request = record(notification?.request);
  return typeof request?.identifier === 'string' && typeof value?.actionIdentifier === 'string' ? JSON.stringify([request.identifier, notification?.date, value.actionIdentifier]) : null;
}
async function withinDeadline<T>(operation: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation.catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export function createReminderNotificationController(options: Options) {
  let disposed = false;
  let latestIntent: string | null = null;
  const handled = new Set<string>();
  const inFlight = new Set<string>();
  const sameOwner = (before: ReminderEntryAuth, allowExpired = false) => {
    const current = options.getAuth();
    return !disposed && (current.status === 'signed-in' || (allowExpired && current.status === 'expired')) && current.epoch === before.epoch && current.session?.memberId === before.session?.memberId && current.session?.sessionToken === before.session?.sessionToken;
  };
  async function authorize(notification: unknown, auth: ReminderEntryAuth, allowExpired = false): Promise<Entry | null> {
    const entry = entryOf(notification);
    if (!entry || (auth.status !== 'signed-in' && !(allowExpired && auth.status === 'expired')) || auth.session?.memberId !== entry.memberId || !sameOwner(auth, allowExpired)) return null;
    if (entry.kind === 'READING') return entry;
    const latest = await withinDeadline(options.validateLatest(entry.payload));
    return sameOwner(auth, allowExpired) && latest?.valid === true && latest.status === 'SCHEDULED' && latest.memberId === entry.memberId && latest.meetingId === entry.payload.meetingId && latest.scheduleRevision === entry.payload.scheduleRevision ? entry : null;
  }
  return {
    async handleForeground(notification: unknown): Promise<NotificationBehavior> {
      const auth = options.getAuth();
      try { return await authorize(notification, auth, true) && sameOwner(auth, true) ? visibleBehavior : hiddenBehavior; }
      catch { return hiddenBehavior; }
    },
    async handleResponse(response: unknown): Promise<Disposition> {
      const value = record(response); const key = responseKey(response);
      if (disposed || !key || value?.actionIdentifier !== options.defaultActionIdentifier || handled.has(key) || inFlight.has(key)) return 'ignored';
      latestIntent = key;
      const auth = options.getAuth();
      if (auth.status === 'hydrating') return 'deferred';
      if (auth.status === 'expired') return entryOf(value.notification)?.memberId === auth.session?.memberId ? 'deferred' : 'ignored';
      if (auth.status !== 'signed-in') return 'ignored';
      if (!options.canNavigate()) return 'deferred';
      inFlight.add(key);
      try {
        const entry = await authorize(value.notification, auth);
        if (!entry || latestIntent !== key || !sameOwner(auth) || !options.canNavigate()) return 'ignored';
        // All navigation is chosen here. Payload route/URL fields are never used.
        if (entry.kind === 'READING') options.openReadingDate(entry.taskDate);
        else options.openMeeting(entry.payload.meetingId);
        handled.add(key);
        if (handled.size > 128) handled.delete(handled.values().next().value!);
        return 'handled';
      } catch { return 'ignored'; }
      finally { inFlight.delete(key); }
    },
    dispose() { disposed = true; latestIntent = null; handled.clear(); },
  };
}
export interface ReminderNotificationEntryAdapter {
  DEFAULT_ACTION_IDENTIFIER: string;
  setNotificationHandler: (handler: { handleNotification: (notification: any) => Promise<any> } | null) => void;
  addNotificationResponseReceivedListener: (listener: (response: any) => void) => { remove(): void };
  getLastNotificationResponse: () => unknown;
  clearLastNotificationResponse: () => void;
}
let activeHandlerOwner: symbol | null = null;
export function bindReminderNotifications(adapter: ReminderNotificationEntryAdapter, controller: ReturnType<typeof createReminderNotificationController>) {
  const owner = Symbol('reminder-notification-entry');
  let active = true;
  let pending: unknown = null;
  activeHandlerOwner = owner;
  adapter.setNotificationHandler({ handleNotification: controller.handleForeground });
  async function respond(response: unknown): Promise<void> {
    if (!active || !response) return;
    pending = response;
    const disposition = await controller.handleResponse(response);
    if (!active || disposition === 'deferred') return;
    if (pending === response) pending = null;
    try {
      const key = responseKey(response);
      if (key && responseKey(adapter.getLastNotificationResponse()) === key) adapter.clearLastNotificationResponse();
    } catch { /* The live listener remains valid when last-response APIs are unavailable. */ }
  }
  const subscription = adapter.addNotificationResponseReceivedListener(response => { void respond(response); });
  try { void respond(adapter.getLastNotificationResponse()); } catch { /* No cold-start response available. */ }
  return {
    resume: async () => { if (pending) await respond(pending); },
    dispose() {
      active = false; pending = null; controller.dispose(); subscription.remove();
      if (activeHandlerOwner === owner) { activeHandlerOwner = null; adapter.setNotificationHandler(null); }
    },
  };
}
