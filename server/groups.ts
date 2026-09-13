import type { DatabaseSync } from 'node:sqlite';
import { maskForViewer } from '../src/domain/masking';

export type MeetingStatus = 'SCHEDULED' | 'CANCELLED';

export interface MemberGroupProfileSeed {
  memberId: string;
  groupId: string;
  groupName: string;
  rpgId: string;
  rpgName: string;
  openChatUrl?: string | null;
  callUrl?: string | null;
  callProvider?: 'meet' | 'zoom' | null;
  callScope?: 'TEST_ONLY' | 'APPROVED' | null;
  linkStatus: 'READY' | 'PENDING_UI_VERIFICATION';
  linkRevision?: number;
  updatedAt?: string;
  meetingId?: string | null;
  meetingTitle?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timeZone?: string | null;
  organizerLabel?: string | null;
  scheduleRevision?: number | null;
  scheduleStatus?: MeetingStatus | null;
  standingRoom?: boolean;
  lastUpdatedAt?: string | null;
}

export function seedMemberGroupProfile(db: DatabaseSync, seed: MemberGroupProfileSeed): void {
  db.prepare(
    `INSERT OR REPLACE INTO member_group_profiles
      (member_id, group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, updated_at, meeting_id, meeting_title, starts_at, ends_at, time_zone, organizer_label, schedule_revision, schedule_status, standing_room, last_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.memberId,
    seed.groupId,
    seed.groupName,
    seed.rpgId,
    seed.rpgName,
    seed.openChatUrl ?? null,
    seed.callUrl ?? null,
    seed.callProvider ?? null,
    seed.callScope ?? null,
    seed.linkStatus,
    seed.linkRevision ?? 1,
    seed.updatedAt ?? new Date().toISOString(),
    seed.meetingId ?? null,
    seed.meetingTitle ?? null,
    seed.startsAt ?? null,
    seed.endsAt ?? null,
    seed.timeZone ?? null,
    seed.organizerLabel ?? null,
    seed.scheduleRevision ?? null,
    seed.scheduleStatus ?? null,
    seed.standingRoom ? 1 : 0,
    seed.lastUpdatedAt ?? seed.updatedAt ?? new Date().toISOString(),
  );
}

export function getMemberGroupProfile(db: DatabaseSync, memberId: string): Record<string, unknown> | null {
  const rows = db.prepare(
    `SELECT group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, meeting_id, meeting_title, starts_at, ends_at, time_zone, organizer_label, schedule_revision, schedule_status, standing_room, last_updated_at
     FROM member_group_profiles WHERE member_id = ? ORDER BY rpg_id`,
  ).all(memberId) as Array<{
    group_id: string;
    group_name: string;
    rpg_id: string;
    rpg_name: string;
    open_chat_url: string | null;
    call_url: string | null;
    call_provider: string | null;
    call_scope: string | null;
    link_status: string;
    link_revision: number;
    meeting_id: string | null;
    meeting_title: string | null;
    starts_at: string | null;
    ends_at: string | null;
    time_zone: string | null;
    organizer_label: string | null;
    schedule_revision: number | null;
    schedule_status: MeetingStatus | null;
    standing_room: number;
    last_updated_at: string | null;
  }>;
  if (rows.length === 0) return null;
  const first = rows[0];
  const viewer = db.prepare('SELECT id, group_id FROM members WHERE id = ?').get(memberId) as { id: string; group_id: string } | undefined;
  const roster = viewer
    ? (db.prepare('SELECT id, display_name FROM members WHERE group_id = ? ORDER BY id').all(viewer.group_id) as Array<{ id: string; display_name: string }>).map((member) =>
        maskForViewer(memberId, { id: member.id, displayName: member.display_name }),
      )
    : null;
  return {
    groupId: first.group_id,
    groupName: first.group_name,
    rpgs: rows.map((row) => ({
      rpgId: row.rpg_id,
      rpgName: row.rpg_name,
      openChatUrl: row.open_chat_url,
      callUrl: row.call_url,
      callProvider: row.call_provider,
      callScope: row.call_scope,
      linkStatus: row.link_status,
      linkRevision: row.link_revision,
      standingRoom: row.standing_room === 1,
      meeting: row.meeting_id && row.schedule_status
        ? {
            meetingId: row.meeting_id,
            title: row.meeting_title ?? 'RPG 聚會',
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            timeZone: row.time_zone ?? 'Asia/Taipei',
            organizerLabel: row.organizer_label,
            revision: row.schedule_revision ?? row.link_revision,
            status: row.schedule_status,
            lastUpdatedAt: row.last_updated_at,
          }
        : null,
      roster,
      lastUpdatedAt: row.last_updated_at,
    })),
  };
}
