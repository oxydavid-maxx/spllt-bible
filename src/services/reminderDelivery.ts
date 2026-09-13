export const MEETING_REMINDER_TASK = 'qingmu-youth-meeting-reminder-v1';

export interface FcmReminderPayload {
  event: 'MEETING_REMINDER';
  reminderId: string;
  meetingId: string;
  scheduleRevision: number;
}

export interface FcmSender {
  send: (token: string, payload: FcmReminderPayload, options?: { ttlSeconds?: number }) => Promise<{ messageId: string | null }>;
}

export function createFcmSender(config: { projectId: string; getAccessToken: () => Promise<string>; fetchImpl?: typeof fetch; enabled?: boolean }): FcmSender {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async send(token, payload, options = {}) {
      if (!config.enabled || !config.projectId.trim()) throw new Error('REMOTE_DELIVERY_PENDING');
      const accessToken = await config.getAccessToken();
      if (!accessToken.trim()) throw new Error('FCM_ACCESS_TOKEN_REQUIRED');
      const ttlSeconds = Math.max(1, Math.min(3600, Math.floor(options.ttlSeconds ?? 300)));
      const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data: { event: payload.event, reminderId: payload.reminderId, meetingId: payload.meetingId, scheduleRevision: String(payload.scheduleRevision) },
            android: { ttl: `${ttlSeconds}s`, collapse_key: `meeting:${payload.meetingId}` },
          },
        }),
      });
      if (!response.ok) throw new Error(`FCM_SEND_FAILED_${response.status}`);
      const body = await response.json().catch(() => ({})) as { name?: string };
      return { messageId: typeof body.name === 'string' ? body.name : null };
    },
  };
}

export interface HeadlessMeetingPayload {
  event: 'MEETING_REMINDER';
  reminderId: string;
  meetingId: string;
  scheduleRevision: number;
}

export interface HeadlessValidationResult {
  valid: boolean;
  meetingId: string;
  scheduleRevision: number;
  status: 'SCHEDULED' | 'CANCELLED';
}

export interface ReminderHeadlessRuntime {
  validateLatest: (payload: HeadlessMeetingPayload) => Promise<HeadlessValidationResult>;
  present: (payload: HeadlessMeetingPayload) => Promise<void>;
}

export interface ReminderTaskManager {
  defineTask: (name: string, handler: (event: { data?: unknown; error?: unknown }) => Promise<void>) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * The task event NEVER carries our data fields at its top level, and where it does carry them
 * depends on which route woke the task. Both routes are in expo-notifications' Android source:
 *
 *   FirebaseMessagingDelegate.onMessageReceived calls
 *     runTaskManagerTasks(context, RemoteMessageSerializer.toBundle(remoteMessage))
 *   and RemoteMessageSerializer.toBundle puts the FCM data map under the "data" key, beside
 *   collapseKey / from / messageId / notification / sentTime / ttl.
 *
 *   BackgroundRemoteNotificationTaskConsumer.didExecuteJob, the job-queue route, instead wraps
 *   it as { notification: NotificationSerializer.toBundle(...) }, which nests the map under
 *   request.content.data and repeats it under request.trigger.remoteMessage.data.
 *
 * The package's own NotificationTaskPayload type states the first shape outright:
 * { notification: Record<string, unknown> | null; data: { dataString?: string; ... } }.
 *
 * Reading event.data.event therefore found undefined for every real push, and the handler
 * returned synchronously before any validation. Run 10 on 2026-09-10 caught it exactly: one
 * send acknowledged by FCM at 09:42:49.208Z, the app process unfrozen at 09:42:49.064, the
 * named task started and finished at 09:42:49.141, and nothing presented.
 *
 * The last candidate is the event itself, which keeps a directly-injected map working.
 */
function candidateDataMaps(data: unknown): Array<Record<string, unknown>> {
  const root = asRecord(data);
  if (!root) return [];
  const request = asRecord(asRecord(root.notification)?.request);
  return [
    asRecord(root.data),
    asRecord(asRecord(request?.content)?.data),
    asRecord(asRecord(asRecord(request?.trigger)?.remoteMessage)?.data),
    root,
  ].filter((map): map is Record<string, unknown> => map !== null);
}

/**
 * Every value in an FCM data map is a string: createFcmSender serialises the revision with
 * String(...) because the FCM v1 contract requires it, and Android's RemoteMessageSerializer
 * stores each entry with putString. Requiring typeof number here dropped every real push.
 * Accept either and normalise, so the freshness comparison below compares numbers to numbers.
 * Widening where we look must not widen what we accept: anything else is still refused.
 */
function toMeetingPayload(map: Record<string, unknown>): HeadlessMeetingPayload | null {
  const rawRevision: unknown = map.scheduleRevision;
  const scheduleRevision = typeof rawRevision === 'number' ? rawRevision : typeof rawRevision === 'string' && rawRevision.trim() !== '' ? Number(rawRevision) : Number.NaN;
  if (map.event !== 'MEETING_REMINDER' || typeof map.reminderId !== 'string' || typeof map.meetingId !== 'string' || !Number.isFinite(scheduleRevision)) return null;
  return { event: 'MEETING_REMINDER', reminderId: map.reminderId, meetingId: map.meetingId, scheduleRevision };
}

export function registerReminderHeadlessTask(taskManager: ReminderTaskManager, runtime: ReminderHeadlessRuntime): void {
  taskManager.defineTask(MEETING_REMINDER_TASK, async ({ data, error }) => {
    if (error) return;
    let payload: HeadlessMeetingPayload | null = null;
    for (const map of candidateDataMaps(data)) {
      payload = toMeetingPayload(map);
      if (payload) break;
    }
    if (!payload) return;
    const latest = await runtime.validateLatest(payload);
    if (latest.valid && latest.status === 'SCHEDULED' && latest.scheduleRevision === payload.scheduleRevision) await runtime.present(payload);
  });
}

export interface ReminderBackgroundNotificationRegistrar {
  registerTaskAsync: (taskName: string) => Promise<unknown>;
}

export interface ReminderHeadlessLoaders {
  loadTaskManager?: () => Promise<ReminderTaskManager>;
  loadNotifications?: () => Promise<ReminderBackgroundNotificationRegistrar>;
}

/**
 * Defining a task only associates a handler with a NAME. expo-notifications routes an
 * incoming background notification to that handler ONLY after registerTaskAsync, which its
 * own documentation states outright: "You must define the task first, with
 * TaskManager.defineTask and register it with registerTaskAsync."
 *
 * Without that second call the whole remote-delivery path is inert. Run 5 on 2026-09-10
 * demonstrated exactly that: the server sent a data-only message, FCM accepted it, and the
 * device displayed nothing, with no task or messaging activity at all. A data-only message
 * carries no notification block by design, so the task is the only thing that can present it.
 *
 * The loaders are injectable so this binding can be proven without pulling react-native into
 * the test environment. Production callers pass no loaders and get the real modules.
 */
export async function registerDefaultReminderHeadlessTask(runtime: ReminderHeadlessRuntime, loaders: ReminderHeadlessLoaders = {}): Promise<void> {
  const loadTaskManager = loaders.loadTaskManager ?? (() => import('expo-task-manager') as unknown as Promise<ReminderTaskManager>);
  const loadNotifications = loaders.loadNotifications ?? (() => import('expo-notifications') as unknown as Promise<ReminderBackgroundNotificationRegistrar>);
  const taskManager = await loadTaskManager();
  registerReminderHeadlessTask(taskManager, runtime);
  // Order matters: registering a name whose handler is not yet defined is the documented way
  // to end up with a task that never fires.
  const notifications = await loadNotifications();
  await notifications.registerTaskAsync(MEETING_REMINDER_TASK);
}

export async function presentValidatedMeetingReminder(payload: HeadlessMeetingPayload): Promise<void> {
  const notifications = await import('expo-notifications');
  await notifications.scheduleNotificationAsync({
    content: { title: '青牧聚會提醒', body: '聚會資料可能已更新，請開啟 App 查看最新狀態。', data: { ...payload } },
    trigger: null,
  });
}
