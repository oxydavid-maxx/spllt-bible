import { Notification, Provider } from '@parse/node-apn';

/**
 * iOS alert push through Apple's provider API (token auth, HTTP/2), via the maintained @parse/node-apn rather
 * than a hand-written HTTP/2 client. Android keeps its data-only FCM route (fcmSender.ts); an iPhone gets a
 * visible alert because iOS throttles background pushes and drops them for an app the user swiped away.
 */
export interface ApnsAlert { title: string; body: string; data: Record<string, string>; collapseId?: string }
export type ApnsAlertSender = (token: string, alert: ApnsAlert) => Promise<void>;
export interface ApnsProviderLike {
  send: (note: Notification, token: string) => Promise<{ sent: unknown[]; failed: Array<{ status?: number | string; response?: { reason?: string } }> }>;
  shutdown: () => void;
}

export function createApnsSender(config: { keyFile: string; keyId: string; teamId: string; topic: string; production: boolean; provider?: ApnsProviderLike }): { send: ApnsAlertSender; shutdown: () => void } {
  const provider: ApnsProviderLike = config.provider
    ?? new Provider({ token: { key: config.keyFile, keyId: config.keyId, teamId: config.teamId }, production: config.production }) as unknown as ApnsProviderLike;
  return {
    async send(token, alert) {
      const note = new Notification();
      note.topic = config.topic;
      note.pushType = 'alert';
      note.priority = 10;
      note.expiry = Math.floor(Date.now() / 1000) + 3600;
      note.alert = { title: alert.title, body: alert.body };
      note.sound = 'default';
      // expo-notifications hands JS only userInfo.body as a remote notification's data (NotificationRecords.swift).
      note.payload = { body: alert.data };
      if (alert.collapseId) note.collapseId = alert.collapseId;
      const result = await provider.send(note, token);
      const failure = result.failed[0];
      if (!failure) return;
      const reason = failure.response?.reason;
      if (Number(failure.status) === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken') throw new Error('APNS_UNREGISTERED');
      throw new Error(`APNS_SEND_FAILED_${failure.status ?? 'TRANSPORT'}`);
    },
    shutdown: () => provider.shutdown(),
  };
}
