import type { DatabaseSync } from 'node:sqlite';
import { friendAddedNotificationText } from '../src/domain/friendNotificationText';
import type { ApnsAlertSender } from './apnsSender';

/**
 * Telling the QR owner, by push, that somebody just added them.
 *
 * It rides on the device tokens the reminder flow already registers (device_delivery_tokens), and
 * goes to every active one the owner has — a phone and a tablet are both "your phone" to them.
 *
 * Nothing here is part of the claim. The route fires this and answers without waiting, so a slow,
 * failing or unconfigured push can never change what the scanner is told. Failures are logged as a
 * classification only: a provider error can echo the request, and the request carries a token.
 */

export type PushDataSender = (token: string, data: Record<string, string>) => Promise<unknown>;

/** Enough for any name the app lets a member have; the rest is cut rather than refused. */
const MAX_FRIEND_NAME_LENGTH = 40;

function failureClass(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]*/.exec(message)?.[0];
  return code ?? 'TRANSPORT_ERROR';
}

/** One sender per platform; a platform without one is simply not pushed. */
export interface FriendPushSenders { android?: PushDataSender; ios?: ApnsAlertSender }

export async function notifyFriendAdded(db: DatabaseSync, senders: FriendPushSenders, input: { ownerMemberId: string; friendMemberId: string }): Promise<{ sent: number; failed: number }> {
  const friend = db.prepare('SELECT display_name FROM members WHERE id = ?').get(input.friendMemberId) as { display_name: string } | undefined;
  const tokens = db.prepare('SELECT token, platform FROM device_delivery_tokens WHERE member_id = ? AND revoked_at IS NULL ORDER BY updated_at DESC')
    .all(input.ownerMemberId) as Array<{ token: string; platform: string }>;
  if (!friend || tokens.length === 0) return { sent: 0, failed: 0 };
  const data = { event: 'FRIEND_ADDED', friendMemberId: input.friendMemberId, friendName: friend.display_name.trim().slice(0, MAX_FRIEND_NAME_LENGTH) || '好友' };
  let sent = 0;
  let failed = 0;
  await Promise.all(tokens.map(async ({ token, platform }) => {
    try {
      if (platform === 'IOS') {
        if (!senders.ios) return;
        // The system shows an iOS alert, so the words travel with it; the data is what the app routes a tap
        // with (reminderNotificationEntry: kind + memberId) and what its foreground listener reads (event).
        await senders.ios(token, { ...friendAddedNotificationText(data.friendName), data: { ...data, kind: 'FRIEND_ADDED', memberId: input.ownerMemberId }, collapseId: `friend:${input.friendMemberId}` });
      } else if (platform === 'ANDROID') {
        if (!senders.android) return;
        await senders.android(token, data);
      } else return;
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn('FRIEND_PUSH_FAILED', failureClass(error));
      if (platform === 'IOS' && failureClass(error) === 'APNS_UNREGISTERED') {
        db.prepare("UPDATE device_delivery_tokens SET revoked_at = ? WHERE token = ? AND platform = 'IOS' AND revoked_at IS NULL").run(new Date().toISOString(), token);
      }
    }
  }));
  return { sent, failed };
}
