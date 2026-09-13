import type { DatabaseSync } from 'node:sqlite';
import type { MeetingStatus } from './meetingSchedules';

export interface DueMeetingEvent { reminderId: string; memberId: string; meetingId: string; scheduleRevision: number; triggerAt: string; expiresAt: string }
export interface MeetingPayload { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number }
export type MeetingSender = (token: string, payload: MeetingPayload) => Promise<{ messageId?: string | null } | void>;
type Decision = 'SEND' | 'ALREADY_SENT' | 'UNKNOWN_RECONCILE' | 'NOT_DUE' | 'DROP_EXPIRED' | 'DROP_STALE' | 'DROP_CANCELLED' | 'DROP_DISABLED' | 'DROP_UNKNOWN';
interface CurrentMeeting { member_id: string; schedule_revision: number; schedule_status: MeetingStatus; starts_at: string; meeting_advance_minutes: number; meeting_enabled: number }

function currentMeeting(db: DatabaseSync, memberId: string, meetingId: string): CurrentMeeting | undefined {
  return db.prepare(`SELECT p.member_id,p.schedule_revision,p.schedule_status,p.starts_at,r.meeting_advance_minutes,r.meeting_enabled
    FROM member_group_profiles p JOIN members m ON m.id=p.member_id AND m.disabled_at IS NULL LEFT JOIN reminder_preferences r ON r.member_id=p.member_id
    WHERE p.member_id=? AND p.meeting_id=? AND p.schedule_revision IS NOT NULL AND length(trim(p.schedule_source_ref))>0
    ORDER BY p.schedule_revision DESC,p.last_updated_at DESC LIMIT 1`).get(memberId, meetingId) as CurrentMeeting | undefined;
}

export function authorizeDeviceMeetingSnapshot(db: DatabaseSync, input: { installationId: string; token: string; meetingId: string }) {
  const device = db.prepare("SELECT member_id FROM device_delivery_tokens WHERE installation_id=? AND token=? AND platform='ANDROID' AND revoked_at IS NULL").get(input.installationId, input.token) as { member_id: string } | undefined;
  if (!device) return null;
  const meeting = currentMeeting(db, device.member_id, input.meetingId);
  if (!meeting || meeting.meeting_enabled !== 1 || !['SCHEDULED', 'CANCELLED'].includes(meeting.schedule_status)) return null;
  return { memberId: device.member_id, meetingId: input.meetingId, scheduleRevision: meeting.schedule_revision, status: meeting.schedule_status };
}

export async function sendDueMeetingEvent(db: DatabaseSync, event: DueMeetingEvent, send: MeetingSender, now = new Date(), options: { timeoutMs?: number } = {}) {
  const base = { reminderId: event.reminderId, meetingId: event.meetingId, scheduleRevision: event.scheduleRevision };
  const result = (decision: Decision) => ({ ...base, decision });
  const trigger = Date.parse(event.triggerAt), expires = Date.parse(event.expiresAt);
  if (!Number.isFinite(trigger) || !Number.isFinite(expires) || expires <= now.getTime()) return result('DROP_EXPIRED');
  if (trigger > now.getTime()) return result('NOT_DUE');
  const meeting = currentMeeting(db, event.memberId, event.meetingId);
  if (!meeting || !['SCHEDULED', 'CANCELLED'].includes(meeting.schedule_status)) return result('DROP_UNKNOWN');
  if (meeting.schedule_status === 'CANCELLED') return result('DROP_CANCELLED');
  if (meeting.schedule_revision !== event.scheduleRevision || Date.parse(meeting.starts_at) - meeting.meeting_advance_minutes * 60_000 !== trigger) return result('DROP_STALE');
  if (meeting.meeting_enabled !== 1) return result('DROP_DISABLED');
  if (event.reminderId !== `meeting:${event.meetingId}:${event.scheduleRevision}`) return result('DROP_UNKNOWN');
  const deliveryId = `${event.memberId}:${event.reminderId}`;
  const existing = db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id=?').get(deliveryId) as { status: string } | undefined;
  if (existing) return result(existing.status === 'SENT' ? 'ALREADY_SENT' : 'UNKNOWN_RECONCILE');
  const device = db.prepare("SELECT token FROM device_delivery_tokens WHERE member_id=? AND platform='ANDROID' AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1").get(event.memberId) as { token: string } | undefined;
  if (!device) return result('DROP_UNKNOWN');
  const claim = db.prepare("INSERT OR IGNORE INTO reminder_deliveries (delivery_id,reminder_id,member_id,meeting_id,schedule_revision,trigger_at,expires_at,status,claimed_at) VALUES (?,?,?,?,?,?,?,'CLAIMED',?)").run(deliveryId,event.reminderId,event.memberId,event.meetingId,event.scheduleRevision,event.triggerAt,event.expiresAt,now.toISOString());
  if (Number(claim.changes) === 0) return result('UNKNOWN_RECONCILE');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let recipientDropped = false;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => {
        // The provider invocation is deferred. Re-read the same authority after
        // the claim so an intervening account disable cannot reach transport.
        if (!currentMeeting(db, event.memberId, event.meetingId)) { recipientDropped = true; return; }
        return send(device.token, { event: 'MEETING_REMINDER', reminderId: event.reminderId, meetingId: event.meetingId, scheduleRevision: event.scheduleRevision });
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('DELIVERY_TIMEOUT_UNKNOWN')), Math.max(1, options.timeoutMs ?? 15_000)); }),
    ]);
    if (recipientDropped) {
      db.prepare("UPDATE reminder_deliveries SET status='DROPPED',last_error='RECIPIENT_INACTIVE' WHERE delivery_id=? AND status='CLAIMED'").run(deliveryId);
      return result('DROP_UNKNOWN');
    }
    if (!response || typeof response.messageId !== 'string' || !response.messageId.trim()) throw new Error('PROVIDER_ACK_MISSING');
    db.prepare("UPDATE reminder_deliveries SET status='SENT',sent_at=?,provider_message_id=?,last_error=NULL WHERE delivery_id=? AND status='CLAIMED'").run(new Date().toISOString(),response.messageId,deliveryId);
    return result('SEND');
  } catch (error) {
    // Do not store transport exception text: providers may echo tokens or request data.
    const reason = error instanceof Error && error.message === 'PROVIDER_ACK_MISSING' ? 'PROVIDER_ACK_MISSING' : 'TRANSPORT_OUTCOME_UNKNOWN';
    db.prepare("UPDATE reminder_deliveries SET status='UNKNOWN',last_error=? WHERE delivery_id=? AND status='CLAIMED'").run(reason,deliveryId);
    return result('UNKNOWN_RECONCILE');
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
