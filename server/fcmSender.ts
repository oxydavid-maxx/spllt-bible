export const MEETING_REMINDER_TASK = 'qingmu-youth-meeting-reminder-v1';

export interface FcmReminderPayload {
  event: 'MEETING_REMINDER';
  reminderId: string;
  meetingId: string;
  scheduleRevision: number;
}

/** Any other data-only message. FCM v1 requires every data value to be a string. */
export interface FcmDataMessage {
  data: Record<string, string>;
  ttlSeconds?: number;
  collapseKey?: string;
  /** HIGH wakes a dozing phone promptly; it is meant for a message the user is waiting to see. */
  priority?: 'NORMAL' | 'HIGH';
}

export interface FcmSender {
  send: (token: string, payload: FcmReminderPayload, options?: { ttlSeconds?: number }) => Promise<{ messageId: string | null }>;
  sendData: (token: string, message: FcmDataMessage) => Promise<{ messageId: string | null }>;
}

export function createFcmSender(config: { projectId: string; getAccessToken: () => Promise<string>; fetchImpl?: typeof fetch; enabled?: boolean }): FcmSender {
  const fetchImpl = config.fetchImpl ?? fetch;
  const post = async (message: Record<string, unknown>): Promise<{ messageId: string | null }> => {
    if (!config.enabled || !config.projectId.trim()) throw new Error('REMOTE_DELIVERY_PENDING');
    const accessToken = await config.getAccessToken();
    if (!accessToken.trim()) throw new Error('FCM_ACCESS_TOKEN_REQUIRED');
    const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) throw new Error(`FCM_SEND_FAILED_${response.status}`);
    const body = await response.json().catch(() => ({})) as { name?: string };
    return { messageId: typeof body.name === 'string' ? body.name : null };
  };
  const ttl = (seconds: number | undefined, fallback: number) => `${Math.max(1, Math.min(3600, Math.floor(seconds ?? fallback)))}s`;
  return {
    send(token, payload, options = {}) {
      return post({
        token,
        data: { event: payload.event, reminderId: payload.reminderId, meetingId: payload.meetingId, scheduleRevision: String(payload.scheduleRevision) },
        android: { ttl: ttl(options.ttlSeconds, 300), collapse_key: `meeting:${payload.meetingId}` },
      });
    },
    sendData(token, message) {
      // Data only, never a notification block: the app decides what to show from the app's state.
      return post({
        token,
        data: message.data,
        android: { ttl: ttl(message.ttlSeconds, 300), ...(message.collapseKey ? { collapse_key: message.collapseKey } : {}), ...(message.priority ? { priority: message.priority } : {}) },
      });
    },
  };
}
