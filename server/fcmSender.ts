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
        signal: AbortSignal.timeout(10_000),
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
