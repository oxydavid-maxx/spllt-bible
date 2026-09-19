import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { insertReward, readMutationReceipt, transaction, writeMutationReceipt, type GamificationError } from './gamification';

/**
 * Students suggest what the prizes should be, vote on each other's ideas, and a 輔導 turns one into
 * a real reward.
 *
 * The value is ownership: wanting a prize more because you chose it. That is why the nominator's
 * display name is shown, and it is a deliberate widening of an app where you otherwise only see the
 * names of people you have added as friends. It is bounded to this one board — the payload carries
 * a name and nothing else about the person, no member id and no list of who voted.
 *
 * Deliberately not an inventory: no stock, no quantity, no fulfilment. A nomination goes from OPEN
 * to exactly one of approved, declined or removed, and stops.
 */

/** Enough for a real idea, few enough that the board stays readable for the 輔導. */
const MAX_OPEN_PER_MEMBER = 3;
const MAX_NAME_LENGTH = 40;
const MAX_NOTE_LENGTH = 200;

type NominationStatus = 'OPEN' | 'APPROVED' | 'DECLINED' | 'REMOVED';

interface NominationRow {
  nomination_id: string;
  name: string;
  note: string | null;
  created_by: string;
  display_name: string;
  status: NominationStatus;
  revision: number;
  created_at: number;
  vote_count: number;
  voted: number;
}

export function ensureNominationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_nominations (
      nomination_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN','APPROVED','DECLINED','REMOVED')),
      reward_id TEXT,
      decided_by TEXT,
      decided_at INTEGER,
      revision INTEGER NOT NULL CHECK(revision > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reward_nominations_status ON reward_nominations(status, created_at);
    CREATE TABLE IF NOT EXISTS reward_nomination_votes (
      nomination_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (nomination_id, member_id)
    );
  `);
}

/** One row as a member sees it: an idea, whose it is, how many want it. */
function project(row: NominationRow, viewerId: string): Record<string, unknown> {
  return {
    nominationId: row.nomination_id,
    name: row.name,
    ...(row.note ? { note: row.note } : {}),
    displayName: row.display_name,
    status: row.status,
    voteCount: Number(row.vote_count),
    voted: Number(row.voted) > 0,
    mine: row.created_by === viewerId,
    revision: row.revision,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT n.nomination_id, n.name, n.note, n.created_by, m.display_name, n.status, n.revision, n.created_at,
    (SELECT COUNT(*) FROM reward_nomination_votes v WHERE v.nomination_id = n.nomination_id) AS vote_count,
    (SELECT COUNT(*) FROM reward_nomination_votes v WHERE v.nomination_id = n.nomination_id AND v.member_id = ?) AS voted
  FROM reward_nominations n JOIN members m ON m.id = n.created_by`;

/**
 * Open and approved ideas are everyone's business; a decline is only the author's.
 *
 * Telling the whole group that someone's suggestion was turned down is a small public
 * embarrassment for no gain, so a declined row goes back to its author alone. A removed one goes
 * to nobody, including its author, because removal is what a 輔導 reaches for when something should
 * not be on the board at all.
 */
export function listNominations(db: DatabaseSync, viewerId: string): { nominations: Array<Record<string, unknown>> } {
  ensureNominationSchema(db);
  const rows = db.prepare(`${SELECT} WHERE n.status IN ('OPEN','APPROVED') OR (n.status = 'DECLINED' AND n.created_by = ?)
    ORDER BY vote_count DESC, n.created_at`).all(viewerId, viewerId) as unknown as NominationRow[];
  return { nominations: rows.map((row) => project(row, viewerId)) };
}

export function listNominationsForAdmin(db: DatabaseSync, viewerId: string): { nominations: Array<Record<string, unknown>> } {
  ensureNominationSchema(db);
  const rows = db.prepare(`${SELECT} ORDER BY n.created_at DESC`).all(viewerId) as unknown as NominationRow[];
  return { nominations: rows.map((row) => ({ ...project(row, viewerId), createdBy: row.created_by })) };
}

export function createNomination(
  db: DatabaseSync, memberId: string, operationId: string, name: string, note: string | undefined, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const payload = { name, note: note ?? null };
  const prior = readMutationReceipt(db, memberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  const trimmed = name.trim();
  const trimmedNote = note?.trim() ?? '';
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH || trimmedNote.length > MAX_NOTE_LENGTH) {
    return { status: 400, code: 'INVALID_NOMINATION' };
  }
  const open = db.prepare("SELECT COUNT(*) AS count FROM reward_nominations WHERE created_by = ? AND status = 'OPEN'").get(memberId) as { count: number };
  if (Number(open.count) >= MAX_OPEN_PER_MEMBER) return { status: 409, code: 'NOMINATION_LIMIT_REACHED' };

  return transaction(db, () => {
    const nominationId = randomUUID();
    db.prepare(`INSERT INTO reward_nominations(nomination_id, name, note, created_by, status, revision, created_at, updated_at)
      VALUES(?,?,?,?, 'OPEN', 1, ?, ?)`).run(nominationId, trimmed, trimmedNote || null, memberId, nowMs, nowMs);
    const row = db.prepare(`${SELECT} WHERE n.nomination_id = ?`).get(memberId, nominationId) as unknown as NominationRow;
    const result = project(row, memberId);
    writeMutationReceipt(db, memberId, operationId, 'NOMINATION_CREATE', payload, 'nomination', nominationId, result, nowMs);
    return result;
  });
}

/**
 * Voting carries no operation id and writes no receipt, and that is not an oversight.
 *
 * The composite primary key makes a second vote a no-op and removal a delete, so both are already
 * idempotent by construction. A receipt would add ceremony to an action that cannot go wrong twice.
 */
export function setVote(db: DatabaseSync, memberId: string, nominationId: string, voting: boolean, nowMs: number): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const nomination = db.prepare('SELECT status FROM reward_nominations WHERE nomination_id = ?').get(nominationId) as { status: NominationStatus } | undefined;
  if (!nomination || nomination.status === 'REMOVED') return { status: 404, code: 'NOMINATION_NOT_FOUND' };
  if (nomination.status !== 'OPEN') return { status: 409, code: 'NOMINATION_CLOSED' };
  if (voting) {
    db.prepare('INSERT INTO reward_nomination_votes(nomination_id, member_id, created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(nominationId, memberId, nowMs);
  } else {
    db.prepare('DELETE FROM reward_nomination_votes WHERE nomination_id = ? AND member_id = ?').run(nominationId, memberId);
  }
  const counted = db.prepare('SELECT COUNT(*) AS count FROM reward_nomination_votes WHERE nomination_id = ?').get(nominationId) as { count: number };
  return { nominationId, voteCount: Number(counted.count), voted: voting };
}

export type NominationDecision = 'approve' | 'decline' | 'remove';

/**
 * A 輔導 decides. Approval creates the reward and links it back to the idea in one transaction, so
 * a prize can never exist without the suggestion it came from, or the other way round.
 *
 * There is no vote threshold. With a single pilot member any "someone else must vote first" rule
 * would deadlock the board on its first day, and a 輔導 approving a suggestion nobody voted on is an
 * ordinary way to add a prize.
 */
export function decideNomination(
  db: DatabaseSync, actorMemberId: string, nominationId: string, decision: NominationDecision,
  input: { operationId: string; expectedRevision: number; costPoints?: number }, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const payload = { nominationId, decision, expectedRevision: input.expectedRevision, costPoints: input.costPoints ?? null };
  const prior = readMutationReceipt(db, actorMemberId, input.operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  if (decision === 'approve' && (!Number.isSafeInteger(input.costPoints) || (input.costPoints ?? 0) <= 0)) {
    return { status: 400, code: 'INVALID_REWARD' };
  }

  return transaction(db, () => {
    const current = db.prepare('SELECT name, status, revision FROM reward_nominations WHERE nomination_id = ?').get(nominationId) as { name: string; status: NominationStatus; revision: number } | undefined;
    if (!current) return { status: 404, code: 'NOMINATION_NOT_FOUND' } satisfies GamificationError;
    if (current.revision !== input.expectedRevision) {
      return { status: 409, code: 'NOMINATION_CHANGED', details: { revision: current.revision } } satisfies GamificationError;
    }
    if (current.status !== 'OPEN') {
      return { status: 409, code: 'NOMINATION_CHANGED', details: { revision: current.revision } } satisfies GamificationError;
    }

    const revision = current.revision + 1;
    const status: NominationStatus = decision === 'approve' ? 'APPROVED' : decision === 'decline' ? 'DECLINED' : 'REMOVED';
    let reward: Record<string, unknown> | null = null;
    if (decision === 'approve') {
      reward = insertReward(db, actorMemberId, current.name, input.costPoints!, nowMs);
    }
    db.prepare('UPDATE reward_nominations SET status = ?, reward_id = ?, decided_by = ?, decided_at = ?, revision = ?, updated_at = ? WHERE nomination_id = ?')
      .run(status, (reward?.rewardId as string) ?? null, actorMemberId, nowMs, revision, nowMs, nominationId);

    const result = { nominationId, status, revision, ...(reward ? { reward } : {}) };
    writeMutationReceipt(db, actorMemberId, input.operationId, `NOMINATION_${decision.toUpperCase()}`, payload, 'nomination', nominationId, result, nowMs);
    return result;
  });
}
