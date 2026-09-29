import { statSync } from 'node:fs';
import { createServiceAccountAccessTokenProvider, resolveFcmCredentialFile } from './fcmAuth';
import { createFcmSender } from './fcmSender';
import type { MeetingSender } from './remoteReminders';
import type { PushDataSender } from './friendPush';
import type { ApnsAlertSender, createApnsSender } from './apnsSender';

/**
 * iPhone pushes: Apple's token-based provider API needs only the .p8 key file (kept on the backend machine,
 * never in git), its key id and the team id. Independent of FCM. The library is loaded and the provider created
 * on the first send, so a server that never pushes an iPhone neither opens an APNs connection nor needs
 * @parse/node-apn in its dependency folder.
 */
function createApnsConfiguration(env: Record<string, string | undefined>): ApnsAlertSender | null {
  const keyFile = env.QINGMU_APNS_KEY_FILE?.trim();
  const keyId = env.QINGMU_APNS_KEY_ID?.trim();
  const teamId = env.QINGMU_APNS_TEAM_ID?.trim();
  if (!keyFile || !keyId || !teamId) return null;
  try { if (!statSync(keyFile).isFile()) return null; } catch { return null; }
  let sender: Promise<ReturnType<typeof createApnsSender>> | null = null;
  return async (token, alert) => {
    sender ??= import('./apnsSender').then(({ createApnsSender: create }) =>
      create({ keyFile, keyId, teamId, topic: 'org.qingmu.youth', production: env.QINGMU_APNS_PRODUCTION !== 'false' }));
    return (await sender).send(token, alert);
  };
}
export function createRemoteConfiguration(env: Record<string, string | undefined> = process.env): { status: 'REMOTE_PENDING' | 'REMOTE_READY'; senderConfigured: boolean; dispatcherEnabled: boolean; pendingReasons: string[]; delivery: { enabled: true; send: MeetingSender } | null; push: PushDataSender | null; pushIos: ApnsAlertSender | null } {
  const pushIos = createApnsConfiguration(env);
  const projectId = env.QINGMU_FCM_PROJECT_ID?.trim();
  const credentialFile = resolveFcmCredentialFile(env);
  const reasons: string[] = [];
  if (!projectId) reasons.push('FCM_PROJECT_ID_MISSING');
  if (!credentialFile) reasons.push('FCM_CREDENTIAL_PATH_MISSING');
  else { try { if (!statSync(credentialFile).isFile()) reasons.push('FCM_CREDENTIAL_FILE_UNAVAILABLE'); } catch { reasons.push('FCM_CREDENTIAL_FILE_UNAVAILABLE'); } }
  const dispatcherEnabled = env.QINGMU_REMINDER_WORKER_AUTOSTART === 'true';
  const senderConfigured = reasons.length === 0;
  if (!dispatcherEnabled) reasons.push('DISPATCHER_DISABLED');
  if (!senderConfigured) return { status: 'REMOTE_PENDING', senderConfigured: false, dispatcherEnabled, pendingReasons: reasons, delivery: null, push: null, pushIos };
  const provider = createServiceAccountAccessTokenProvider({ credentialFilePath: credentialFile! });
  const sender = createFcmSender({ projectId: projectId!, enabled: true, getAccessToken: provider.getAccessToken });
  // App events (a new friend) need only the sender, not the meeting dispatcher: they are sent when
  // they happen, never on a schedule. An hour is long enough for a phone that was briefly offline.
  const push: PushDataSender = (token, data) => sender.sendData(token, { data, ttlSeconds: 3600, priority: 'HIGH', ...(data.friendMemberId ? { collapseKey: `friend:${data.friendMemberId}` } : {}) });
  return { status: dispatcherEnabled ? 'REMOTE_READY' : 'REMOTE_PENDING', senderConfigured: true, dispatcherEnabled, pendingReasons: reasons, delivery: { enabled: true, send: (token, payload) => sender.send(token, payload, { ttlSeconds: 300 }) }, push, pushIos };
}
