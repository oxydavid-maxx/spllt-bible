import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { seedMemberGroupProfile } from './groups';

export interface MemberInviteSeed {
  inviteId: string;
  code: string;
  memberId: string;
  displayName: string;
  groupId: string;
  expiresAt: string;
  createdAt?: string;
}

export type InviteClaimFailure =
  | 'INVITE_INVALID'
  | 'INVITE_EXPIRED'
  | 'INVITE_USED'
  | 'INVITE_MEMBER_CONFLICT'
  | 'IDENTITY_ALREADY_BOUND';

export interface InviteClaimSuccess {
  ok: true;
  memberId: string;
  alreadyBound: boolean;
}

export interface InviteClaimFailureResult {
  ok: false;
  error: InviteClaimFailure;
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function seedMemberInvite(db: DatabaseSync, seed: MemberInviteSeed): void {
  db.prepare(
    `INSERT OR IGNORE INTO member_invites
      (invite_id, code_hash, member_id, display_name, group_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.inviteId,
    hashInviteCode(seed.code),
    seed.memberId,
    seed.displayName,
    seed.groupId,
    seed.expiresAt,
    seed.createdAt ?? new Date().toISOString(),
  );
}

export function claimMemberInvite(
  db: DatabaseSync,
  input: { provider: 'google'; subject: string; code: string },
  now = new Date(),
): InviteClaimSuccess | InviteClaimFailureResult {
  const existingBinding = db
    .prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?')
    .get(input.provider, input.subject) as { member_id: string } | undefined;
  if (existingBinding) return { ok: true, memberId: existingBinding.member_id, alreadyBound: true };

  db.exec('BEGIN IMMEDIATE');
  try {
    const invite = db
      .prepare('SELECT invite_id, member_id, display_name, group_id, expires_at, used_at FROM member_invites WHERE code_hash = ?')
      .get(hashInviteCode(input.code)) as
      | { invite_id: string; member_id: string; display_name: string; group_id: string; expires_at: string; used_at: string | null }
      | undefined;
    if (!invite) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'INVITE_INVALID' };
    }
    if (invite.used_at) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'INVITE_USED' };
    }
    const expiryMs = Date.parse(invite.expires_at);
    if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'INVITE_EXPIRED' };
    }

    const member = db
      .prepare('SELECT display_name, group_id FROM members WHERE id = ?')
      .get(invite.member_id) as { display_name: string; group_id: string } | undefined;
    if (member && (member.display_name !== invite.display_name || member.group_id !== invite.group_id)) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'INVITE_MEMBER_CONFLICT' };
    }
    if (!member) {
      db.prepare('INSERT INTO members (id, display_name, group_id) VALUES (?, ?, ?)').run(invite.member_id, invite.display_name, invite.group_id);
    }
    try {
      db.prepare('INSERT INTO identity_bindings (provider, subject, member_id, created_at) VALUES (?, ?, ?, ?)').run(
        input.provider,
        input.subject,
        invite.member_id,
        now.toISOString(),
      );
    } catch {
      db.exec('ROLLBACK');
      return { ok: false, error: 'IDENTITY_ALREADY_BOUND' };
    }
    db.prepare('UPDATE member_invites SET used_at = ? WHERE invite_id = ? AND used_at IS NULL').run(now.toISOString(), invite.invite_id);
    db.exec('COMMIT');
    return { ok: true, memberId: invite.member_id, alreadyBound: false };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  }
}
