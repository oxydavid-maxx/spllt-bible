import { statSync } from 'node:fs';
import { createServiceAccountAccessTokenProvider, resolveFcmCredentialFile } from './fcmAuth';
import { createFcmSender } from './fcmSender';
import type { MeetingSender } from './remoteReminders';
export function createRemoteConfiguration(env: Record<string, string | undefined> = process.env): { status: 'REMOTE_PENDING' | 'REMOTE_READY'; senderConfigured: boolean; dispatcherEnabled: boolean; pendingReasons: string[]; delivery: { enabled: true; send: MeetingSender } | null } {
  const projectId = env.QINGMU_FCM_PROJECT_ID?.trim();
  const credentialFile = resolveFcmCredentialFile(env);
  const reasons: string[] = [];
  if (!projectId) reasons.push('FCM_PROJECT_ID_MISSING');
  if (!credentialFile) reasons.push('FCM_CREDENTIAL_PATH_MISSING');
  else { try { if (!statSync(credentialFile).isFile()) reasons.push('FCM_CREDENTIAL_FILE_UNAVAILABLE'); } catch { reasons.push('FCM_CREDENTIAL_FILE_UNAVAILABLE'); } }
  const dispatcherEnabled = env.QINGMU_REMINDER_WORKER_AUTOSTART === 'true';
  const senderConfigured = reasons.length === 0;
  if (!dispatcherEnabled) reasons.push('DISPATCHER_DISABLED');
  if (!senderConfigured) return { status: 'REMOTE_PENDING', senderConfigured: false, dispatcherEnabled, pendingReasons: reasons, delivery: null };
  const provider = createServiceAccountAccessTokenProvider({ credentialFilePath: credentialFile! });
  const sender = createFcmSender({ projectId: projectId!, enabled: true, getAccessToken: provider.getAccessToken });
  return { status: dispatcherEnabled ? 'REMOTE_READY' : 'REMOTE_PENDING', senderConfigured: true, dispatcherEnabled, pendingReasons: reasons, delivery: { enabled: true, send: (token, payload) => sender.send(token, payload, { ttlSeconds: 300 }) } };
}
