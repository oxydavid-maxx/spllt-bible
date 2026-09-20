import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { insertReward, readMutationReceipt, transaction, writeMutationReceipt, type GamificationError } from './gamification';
import { ensureAssistSchema, pointsFromTwd } from './nominationAssist';

/**
 * Students suggest what the prizes should be, vote on each other's ideas, and a 輔導 turns the ones
 * the group wanted into real rewards.
 *
 * The value is ownership: wanting a prize more because you chose it. That is why the nominator's
 * display name is shown, and it is a deliberate widening of an app where you otherwise only see the
 * names of people you have added as friends. It is bounded to this one board — the payload carries
 * a name and nothing else about the person, no member id and no list of who voted.
 *
 * It runs as rounds rather than as a standing suggestion box. A 輔導 opens one and sets the date it
 * closes; until then everyone may put forward one idea and vote on the rest; after it, voting stops
 * on its own and the 輔導 reads the votes and decides. A deadline is what turns a wish list into an
 * election, and one idea each is what makes a vote worth casting.
 *
 * Closing is derived from the date, not from a job that has to run. A round whose date has passed is
 * in its deciding phase the next time anybody looks, including after the server was off all week.
 *
 * Deliberately not an inventory: no stock, no quantity, no fulfilment. A nomination goes from OPEN
 * to exactly one of approved, declined, removed or withdrawn, and stops.
 */

/** One idea each. Three made it a wish list; one makes you choose what you actually want. */
const MAX_OPEN_PER_MEMBER = 1;
const MAX_NAME_LENGTH = 40;
const MAX_NOTE_LENGTH = 200;
const MAX_TITLE_LENGTH = 40;

/** What the group is shown of a finished round. The rest stays with the people it belongs to. */
const HISTORY_PLACES = 3;

type NominationStatus = 'OPEN' | 'APPROVED' | 'DECLINED' | 'REMOVED';

/** Voting is open, or it has closed and a 輔導 has not finished deciding. */
export type RoundPhase = 'VOTING' | 'DECIDING';

export interface RoundView {
  roundId: string;
  title: string | null;
  closesAt: number;
  phase: RoundPhase;
}

interface RoundRow { round_id: string; title: string | null; closes_at: number; state: 'OPEN' | 'CLOSED'; opened_at: number }

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
  estimated_twd: number | null;
  note_suggestion: string | null;
  withdrawn: number;
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
    CREATE TABLE IF NOT EXISTS reward_nomination_rounds (
      round_id TEXT PRIMARY KEY,
      title TEXT,
      opened_by TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      closes_at INTEGER NOT NULL,
      closed_at INTEGER,
      state TEXT NOT NULL CHECK(state IN ('OPEN','CLOSED'))
    );
  `);

  // Added the same guarded way as every other column that arrived after its table did.
  const columns = new Set((db.prepare('PRAGMA table_info(reward_nominations)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has('round_id')) db.exec('ALTER TABLE reward_nominations ADD COLUMN round_id TEXT');
  // Taking your own idea back and having it taken off the board are the same status and very
  // different events, so which one happened is recorded rather than inferred.
  if (!columns.has('withdrawn')) db.exec('ALTER TABLE reward_nominations ADD COLUMN withdrawn INTEGER NOT NULL DEFAULT 0');
  ensureAssistSchema(db);
}

/**
 * One row as a member sees it.
 *
 * `noteSuggestion` is behind `mine` and that single boolean is the whole privacy story for it. A
 * 輔導 reading "the model rewrote 小明's explanation" turns a private nudge into a public
 * correction, and a teenager who knows that can happen stops writing explanations.
 */
function project(row: NominationRow, viewerId: string, toPoints: (twd: number) => number | null): Record<string, unknown> {
  const mine = row.created_by === viewerId;
  const estimatedPoints = row.estimated_twd === null ? null : toPoints(Number(row.estimated_twd));
  return {
    nominationId: row.nomination_id,
    name: row.name,
    ...(row.note ? { note: row.note } : {}),
    displayName: row.display_name,
    status: row.status,
    voteCount: Number(row.vote_count),
    voted: Number(row.voted) > 0,
    mine,
    revision: row.revision,
    createdAt: row.created_at,
    ...(estimatedPoints !== null ? { estimatedPoints } : {}),
    ...(mine && row.note_suggestion ? { noteSuggestion: row.note_suggestion } : {}),
  };
}

const SELECT = `SELECT n.nomination_id, n.name, n.note, n.created_by, m.display_name, n.status, n.revision, n.created_at, n.withdrawn,
    a.estimated_twd, a.note_suggestion,
    (SELECT COUNT(*) FROM reward_nomination_votes v WHERE v.nomination_id = n.nomination_id) AS vote_count,
    (SELECT COUNT(*) FROM reward_nomination_votes v WHERE v.nomination_id = n.nomination_id AND v.member_id = ?) AS voted
  FROM reward_nominations n
  JOIN members m ON m.id = n.created_by
  LEFT JOIN reward_nomination_assists a ON a.nomination_id = n.nomination_id`;

function currentRoundRow(db: DatabaseSync): RoundRow | null {
  return (db.prepare("SELECT round_id, title, closes_at, state, opened_at FROM reward_nomination_rounds WHERE state = 'OPEN' ORDER BY opened_at DESC LIMIT 1")
    .get() as RoundRow | undefined) ?? null;
}

function viewRound(row: RoundRow | null, nowMs: number): RoundView | null {
  if (!row) return null;
  return {
    roundId: row.round_id,
    title: row.title,
    closesAt: Number(row.closes_at),
    phase: nowMs < Number(row.closes_at) ? 'VOTING' : 'DECIDING',
  };
}

export function getCurrentRound(db: DatabaseSync, nowMs: number): RoundView | null {
  ensureNominationSchema(db);
  return viewRound(currentRoundRow(db), nowMs);
}

/**
 * The running round and the ideas in it.
 *
 * Open and approved ideas are everyone's business; a decline is only the author's. Telling the whole
 * group that someone's suggestion was turned down is a small public embarrassment for no gain, so a
 * declined row goes back to its author alone. A removed one goes to nobody, including its author:
 * removal is what a 輔導 reaches for when something should not be on the board at all, and an idea
 * its author took back is not on the board either — it is in the history, where they put it.
 */
export function listNominations(db: DatabaseSync, viewerId: string, nowMs: number): Record<string, unknown> {
  ensureNominationSchema(db);
  const round = currentRoundRow(db);
  if (!round) return { round: null, nominations: [] };
  const rows = db.prepare(`${SELECT} WHERE n.round_id = ? AND (n.status IN ('OPEN','APPROVED')
      OR (n.status = 'DECLINED' AND n.created_by = ?))
    ORDER BY vote_count DESC, n.created_at`).all(viewerId, round.round_id, viewerId) as unknown as NominationRow[];
  const toPoints = (twd: number) => pointsFromTwd(db, twd);
  return {
    round: viewRound(round, nowMs),
    nominations: rows.map((row) => project(row, viewerId, toPoints)),
  };
}

export function listNominationsForAdmin(db: DatabaseSync, viewerId: string, nowMs: number): Record<string, unknown> {
  ensureNominationSchema(db);
  const round = currentRoundRow(db);
  const rows = db.prepare(`${SELECT} ORDER BY n.created_at DESC`).all(viewerId) as unknown as NominationRow[];
  const toPoints = (twd: number) => pointsFromTwd(db, twd);
  return {
    round: viewRound(round, nowMs),
    // A 輔導 sees every idea, and still not the private rewrite: project keeps that behind `mine`.
    nominations: rows.map((row) => ({ ...project(row, viewerId, toPoints), createdBy: row.created_by })),
  };
}

/**
 * Finished rounds: the result, and the places.
 *
 * Only the top few and only what happened to them. A full ranking of a closed election is a list of
 * whose idea nobody wanted, published to the people who did not want it.
 */
export function listNominationHistory(db: DatabaseSync): Record<string, unknown> {
  ensureNominationSchema(db);
  const rounds = db.prepare("SELECT round_id, title, closes_at, closed_at, opened_at FROM reward_nomination_rounds WHERE state = 'CLOSED' ORDER BY opened_at DESC")
    .all() as Array<{ round_id: string; title: string | null; closes_at: number; closed_at: number | null; opened_at: number }>;
  return {
    rounds: rounds.map((round) => {
      const places = db.prepare(`SELECT n.name, m.display_name, n.status,
          (SELECT COUNT(*) FROM reward_nomination_votes v WHERE v.nomination_id = n.nomination_id) AS vote_count
        FROM reward_nominations n JOIN members m ON m.id = n.created_by
        WHERE n.round_id = ? AND n.status IN ('OPEN','APPROVED')
        ORDER BY vote_count DESC, n.created_at LIMIT ?`).all(round.round_id, HISTORY_PLACES) as Array<{ name: string; display_name: string; status: NominationStatus; vote_count: number }>;
      return {
        roundId: round.round_id,
        title: round.title,
        closedAt: round.closed_at === null ? Number(round.closes_at) : Number(round.closed_at),
        places: places.map((place) => ({
          name: place.name,
          displayName: place.display_name,
          voteCount: Number(place.vote_count),
          approved: place.status === 'APPROVED',
        })),
      };
    }),
  };
}

export function openRound(
  db: DatabaseSync, actorMemberId: string, operationId: string,
  input: { title?: string; closesAt: number }, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const payload = { title: input.title ?? null, closesAt: input.closesAt };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  const title = input.title?.trim() ?? '';
  if (title.length > MAX_TITLE_LENGTH) return { status: 400, code: 'INVALID_ROUND' };
  // A round that closes in the past would be born unable to take a single nomination.
  if (!Number.isSafeInteger(input.closesAt) || input.closesAt <= nowMs) return { status: 400, code: 'INVALID_ROUND' };
  if (currentRoundRow(db)) return { status: 409, code: 'ROUND_ALREADY_OPEN' };

  return transaction(db, () => {
    const roundId = randomUUID();
    db.prepare("INSERT INTO reward_nomination_rounds(round_id, title, opened_by, opened_at, closes_at, state) VALUES(?,?,?,?,?, 'OPEN')")
      .run(roundId, title || null, actorMemberId, nowMs, input.closesAt);
    const result = { roundId, title: title || null, closesAt: input.closesAt, phase: 'VOTING' as RoundPhase };
    writeMutationReceipt(db, actorMemberId, operationId, 'NOMINATION_ROUND_OPEN', payload, 'nomination-round', roundId, result, nowMs);
    return result;
  });
}

export function closeRound(
  db: DatabaseSync, actorMemberId: string, operationId: string, roundId: string, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const payload = { roundId };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;

  return transaction(db, () => {
    const round = db.prepare('SELECT state FROM reward_nomination_rounds WHERE round_id = ?').get(roundId) as { state: string } | undefined;
    if (!round) return { status: 404, code: 'ROUND_NOT_FOUND' } satisfies GamificationError;
    if (round.state === 'CLOSED') return { status: 409, code: 'ROUND_CLOSED' } satisfies GamificationError;
    db.prepare("UPDATE reward_nomination_rounds SET state = 'CLOSED', closed_at = ? WHERE round_id = ?").run(nowMs, roundId);
    const result = { roundId, state: 'CLOSED' };
    writeMutationReceipt(db, actorMemberId, operationId, 'NOMINATION_ROUND_CLOSE', payload, 'nomination-round', roundId, result, nowMs);
    return result;
  });
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
  const round = currentRoundRow(db);
  if (!round) return { status: 409, code: 'NO_OPEN_ROUND' };
  if (nowMs >= Number(round.closes_at)) return { status: 409, code: 'ROUND_CLOSED' };

  // One each, counted within this round: taking yours back frees the place again.
  const open = db.prepare("SELECT COUNT(*) AS count FROM reward_nominations WHERE created_by = ? AND status = 'OPEN' AND round_id = ?")
    .get(memberId, round.round_id) as { count: number };
  if (Number(open.count) >= MAX_OPEN_PER_MEMBER) return { status: 409, code: 'NOMINATION_LIMIT_REACHED' };

  return transaction(db, () => {
    const nominationId = randomUUID();
    db.prepare(`INSERT INTO reward_nominations(nomination_id, name, note, created_by, status, revision, created_at, updated_at, round_id)
      VALUES(?,?,?,?, 'OPEN', 1, ?, ?, ?)`).run(nominationId, trimmed, trimmedNote || null, memberId, nowMs, nowMs, round.round_id);
    const row = db.prepare(`${SELECT} WHERE n.nomination_id = ?`).get(memberId, nominationId) as unknown as NominationRow;
    const result = project(row, memberId, (twd) => pointsFromTwd(db, twd));
    writeMutationReceipt(db, memberId, operationId, 'NOMINATION_CREATE', payload, 'nomination', nominationId, result, nowMs);
    return result;
  });
}

/** Taking your own idea back. Only yours, only while it is still open. */
export function withdrawNomination(
  db: DatabaseSync, memberId: string, nominationId: string, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const current = db.prepare('SELECT created_by, status, revision FROM reward_nominations WHERE nomination_id = ?')
    .get(nominationId) as { created_by: string; status: NominationStatus; revision: number } | undefined;
  // Someone else's idea is not found rather than forbidden: whether it exists is not the caller's.
  if (!current || current.created_by !== memberId) return { status: 404, code: 'NOMINATION_NOT_FOUND' };
  if (current.status !== 'OPEN') return { status: 409, code: 'NOMINATION_CLOSED' };

  const revision = current.revision + 1;
  db.prepare("UPDATE reward_nominations SET status = 'REMOVED', withdrawn = 1, revision = ?, updated_at = ? WHERE nomination_id = ?")
    .run(revision, nowMs, nominationId);
  return { nominationId, status: 'REMOVED', withdrawn: true, revision };
}

/**
 * The author decides what to do with the rewrite they were offered.
 *
 * Accepting replaces their note with it; ignoring simply clears the offer. There is no third
 * outcome, because the model has no say: whichever they pick, the idea goes forward.
 */
export function resolveSuggestion(
  db: DatabaseSync, memberId: string, nominationId: string, accept: boolean, nowMs: number,
): Record<string, unknown> | GamificationError {
  ensureNominationSchema(db);
  const row = db.prepare(`SELECT n.created_by, n.status, n.revision, a.note_suggestion
    FROM reward_nominations n LEFT JOIN reward_nomination_assists a ON a.nomination_id = n.nomination_id
    WHERE n.nomination_id = ?`).get(nominationId) as { created_by: string; status: NominationStatus; revision: number; note_suggestion: string | null } | undefined;
  if (!row || row.created_by !== memberId) return { status: 404, code: 'NOMINATION_NOT_FOUND' };
  if (row.status !== 'OPEN') return { status: 409, code: 'NOMINATION_CLOSED' };

  return transaction(db, () => {
    let revision = row.revision;
    if (accept && row.note_suggestion) {
      revision += 1;
      db.prepare('UPDATE reward_nominations SET note = ?, revision = ?, updated_at = ? WHERE nomination_id = ?')
        .run(row.note_suggestion, revision, nowMs, nominationId);
    }
    db.prepare('UPDATE reward_nomination_assists SET note_suggestion = NULL WHERE nomination_id = ?').run(nominationId);
    return { nominationId, accepted: accept && Boolean(row.note_suggestion), revision };
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
  const nomination = db.prepare('SELECT status, round_id FROM reward_nominations WHERE nomination_id = ?')
    .get(nominationId) as { status: NominationStatus; round_id: string | null } | undefined;
  if (!nomination || nomination.status === 'REMOVED') return { status: 404, code: 'NOMINATION_NOT_FOUND' };
  if (nomination.status !== 'OPEN') return { status: 409, code: 'NOMINATION_CLOSED' };

  // The deadline stops the voting by itself. Nothing has to run at midnight for this to be true.
  const round = nomination.round_id
    ? db.prepare('SELECT closes_at, state FROM reward_nomination_rounds WHERE round_id = ?').get(nomination.round_id) as { closes_at: number; state: string } | undefined
    : undefined;
  if (round && (round.state === 'CLOSED' || nowMs >= Number(round.closes_at))) return { status: 409, code: 'VOTING_CLOSED' };

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
 * A 輔導 decides, reading the votes rather than being bound by them.
 *
 * Approval creates the reward and links it back to the idea in one transaction, so a prize can never
 * exist without the suggestion it came from, or the other way round. There is no automatic top
 * three: the count is information for a person who knows the group, not a rule that spends its
 * budget for them.
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
