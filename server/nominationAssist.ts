import type { DatabaseSync } from 'node:sqlite';

/**
 * The help a nomination gets while it waits: roughly what it would cost, and — for its author only —
 * a clearer way to say what it is.
 *
 * Two decisions shape the whole file.
 *
 * The estimate is stored in 新台幣, never in points. A model can reason about what a board game
 * costs in Taiwan; it cannot reason about a unit invented by this app last week. Points are derived
 * at read time from the prize the group already agreed on, so repricing 電影票 moves every estimate
 * with it and nothing is ever re-estimated.
 *
 * The work is pulled off a table by a timer rather than started when a nomination is written. The
 * writing path is untouched, and each tick begins by adopting any open nomination that has no row
 * yet — so "created but never queued" is not a state this can be in, and rows that existed before
 * any of this was built are picked up on the next tick.
 *
 * Nothing here can start a program: the module that spawns one is claudeCli, and this file does not
 * import it or the Node module underneath it. Everything that handles a student's words lives here;
 * everything that can run something lives there. A test asserts the absence rather than trusting it.
 */

/** Longer than this is not a price, whatever else it may be. */
const MAX_ANSWER_LENGTH = 20;
const MIN_TWD = 30;
const MAX_TWD = 5000;

/**
 * The exchange rate, expressed as one prize.
 *
 * 電影票 is what the group set at 75 points, and a ticket is about 300 元. Everything else is priced
 * against that, so the rate is whatever 輔導 currently says a ticket is worth.
 */
const ANCHOR_NAME = '電影票';
const ANCHOR_TWD = 300;
const ANCHOR_FALLBACK_POINTS = 75;

/** 約 73 分 claims an arithmetic that nobody did. 約 75 分 reads as the guess it is. */
const ROUND_POINTS_TO = 5;

/** Past this, the number stops being information and starts being a verdict. Show nothing instead. */
const MAX_MULTIPLE_OF_DEAREST = 10;

const MAX_SUGGESTION_LENGTH = 120;
/** A timeout is worth one more try; a poor answer to the same question is not. */
const MAX_ATTEMPTS = 2;

export type AssistState = 'PENDING' | 'DONE' | 'FAILED';

export interface NominationAssist {
  nominationId: string;
  estimatedTwd: number | null;
  noteSuggestion: string | null;
  state: AssistState;
}

export function ensureAssistSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_nomination_assists (
      nomination_id TEXT PRIMARY KEY,
      estimated_twd INTEGER,
      note_suggestion TEXT,
      state TEXT NOT NULL CHECK(state IN ('PENDING','DONE','FAILED')),
      failure TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);
}

export function readAssist(db: DatabaseSync, nominationId: string): NominationAssist | null {
  ensureAssistSchema(db);
  const row = db.prepare('SELECT nomination_id, estimated_twd, note_suggestion, state FROM reward_nomination_assists WHERE nomination_id = ?')
    .get(nominationId) as { nomination_id: string; estimated_twd: number | null; note_suggestion: string | null; state: AssistState } | undefined;
  if (!row) return null;
  return {
    nominationId: row.nomination_id,
    estimatedTwd: row.estimated_twd === null ? null : Number(row.estimated_twd),
    noteSuggestion: row.note_suggestion,
    state: row.state,
  };
}

const HALF_WIDTH = (value: string) => value.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));

/**
 * A price, or nothing.
 *
 * Nothing is the common case for a bad answer and it is deliberately not an error state anybody
 * sees: a nomination without an estimate is exactly the nomination this product already had.
 */
export function parseEstimate(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_ANSWER_LENGTH) return null;
  const bare = HALF_WIDTH(trimmed)
    .replace(/^(NT\$|NT|\$)/i, '')
    .replace(/[,，\s]/g, '')
    .replace(/^(約|大約)/, '')
    .replace(/(元|塊|台幣|新台幣)$/, '');
  if (!/^\d{1,5}$/.test(bare)) return null;
  const value = Number(bare);
  return value >= MIN_TWD && value <= MAX_TWD ? value : null;
}

/** What 電影票 is worth today, or what it was worth when this was written. */
function anchorPoints(db: DatabaseSync): number {
  const row = db.prepare('SELECT cost_points FROM rewards WHERE name = ? AND active = 1 ORDER BY cost_points LIMIT 1')
    .get(ANCHOR_NAME) as { cost_points: number } | undefined;
  const value = row ? Number(row.cost_points) : 0;
  return value > 0 ? value : ANCHOR_FALLBACK_POINTS;
}

export function pointsFromTwd(db: DatabaseSync, twd: number): number | null {
  if (!Number.isFinite(twd) || twd <= 0) return null;
  const points = Math.round((twd * anchorPoints(db)) / ANCHOR_TWD / ROUND_POINTS_TO) * ROUND_POINTS_TO;
  if (points < ROUND_POINTS_TO) return ROUND_POINTS_TO;

  const dearest = db.prepare('SELECT MAX(cost_points) AS top FROM rewards WHERE active = 1').get() as { top: number | null };
  const ceiling = Math.max(Number(dearest?.top ?? 0), anchorPoints(db)) * MAX_MULTIPLE_OF_DEAREST;
  return points > ceiling ? null : points;
}

export function buildEstimatePrompt(name: string, note: string | null): string {
  return [
    '你在幫教會青少年團契估一個獎品的價格。',
    '請估計下面這個獎品在台灣買大約要多少新台幣。',
    '只輸出一個阿拉伯數字,不要單位、不要範圍、不要任何說明文字。',
    '',
    `獎品名稱:${name}`,
    ...(note ? [`補充說明:${note}`] : []),
  ].join('\n');
}

export function buildSuggestionPrompt(note: string): string {
  return [
    '下面是一個青少年為獎品提案寫的說明。',
    '如果它已經清楚、具體、沒有明顯錯字,只輸出 OK 兩個字。',
    '否則輸出改寫後的說明:保留他原本的意思,20 到 60 字,用他這個年紀看得懂的中文。',
    '只輸出說明本身,不要加任何評論。',
    '',
    `說明:${note}`,
  ].join('\n');
}

/**
 * The rewrite, or nothing.
 *
 * Null and "the model never ran" are the same value here, and that is the design rather than a gap.
 * The model has no veto: either way the author sends what they wrote, so the two cases have the
 * same consequence and are given the same representation.
 */
export function parseSuggestion(raw: string, original: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || /^ok\b/i.test(trimmed)) return null;
  if (trimmed.length > MAX_SUGGESTION_LENGTH) return null;
  return trimmed === String(original ?? '').trim() ? null : trimmed;
}

export interface AssistCli {
  invoke(prompt: string): Promise<string>;
  busy(): boolean;
}

interface PendingRow { nomination_id: string; name: string; note: string | null; attempts: number }

export interface NominationAssistWorker {
  tick(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export function createNominationAssistWorker(options: {
  db: DatabaseSync;
  cli: AssistCli;
  now?: () => Date;
  intervalMs?: number;
}): NominationAssistWorker {
  const { db, cli } = options;
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? 20_000;
  let handle: ReturnType<typeof setInterval> | null = null;
  let pendingTick: Promise<void> | null = null;
  let stopped = false;

  const adopt = (at: number) => {
    ensureAssistSchema(db);
    db.prepare(`INSERT INTO reward_nomination_assists(nomination_id, state, attempts, requested_at)
      SELECT n.nomination_id, 'PENDING', 0, ?
      FROM reward_nominations n
      LEFT JOIN reward_nomination_assists a ON a.nomination_id = n.nomination_id
      WHERE a.nomination_id IS NULL AND n.status = 'OPEN'`).run(at);
  };

  const runTick = async () => {
    const at = now().getTime();
    adopt(at);
    // Nothing is started while the last one is still running: this machine is also the app.
    if (cli.busy()) return;

    const pending = db.prepare(`SELECT n.nomination_id, n.name, n.note, a.attempts
      FROM reward_nomination_assists a JOIN reward_nominations n ON n.nomination_id = a.nomination_id
      WHERE a.state = 'PENDING' AND n.status = 'OPEN'
      ORDER BY a.requested_at LIMIT 1`).get() as PendingRow | undefined;
    if (!pending) return;

    const attempts = Number(pending.attempts) + 1;
    let estimate: number | null = null;
    let suggestion: string | null = null;
    try {
      estimate = parseEstimate(await cli.invoke(buildEstimatePrompt(pending.name, pending.note)));
      if (pending.note) suggestion = parseSuggestion(await cli.invoke(buildSuggestionPrompt(pending.note)), pending.note);
    } catch (error) {
      // Only the classification is kept. The prompt carried a student's words and the message may
      // quote them back, so nothing from either is written down.
      const reason = String((error as { reason?: string }).reason ?? 'SPAWN_FAILED');
      const exhausted = attempts >= MAX_ATTEMPTS;
      db.prepare(`UPDATE reward_nomination_assists SET state = ?, failure = ?, attempts = ?, completed_at = ?
        WHERE nomination_id = ?`)
        .run(exhausted ? 'FAILED' : 'PENDING', reason, attempts, exhausted ? at : null, pending.nomination_id);
      return;
    }

    // A poor answer is final. The same prompt produces the same kind of answer, so asking again
    // only spends the machine; the nomination simply carries no estimate, as they all used to.
    const usable = estimate !== null;
    db.prepare(`UPDATE reward_nomination_assists SET estimated_twd = ?, note_suggestion = ?, state = ?, failure = ?, attempts = ?, completed_at = ?
      WHERE nomination_id = ?`)
      .run(estimate, suggestion, usable ? 'DONE' : 'FAILED', usable ? null : 'UNUSABLE_ANSWER', attempts, at, pending.nomination_id);
  };

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (!pendingTick) pendingTick = runTick().finally(() => { pendingTick = null; });
    return pendingTick;
  };

  return {
    tick,
    start() {
      if (handle) return;
      stopped = false;
      // A transient database failure must not become an unhandled process rejection. The next
      // interval retries discovery; never log an exception which might include a student's note.
      handle = setInterval(() => { void tick().catch(() => undefined); }, intervalMs);
      if (typeof handle === 'object' && handle && 'unref' in handle) (handle as { unref: () => void }).unref();
    },
    async stop() {
      stopped = true;
      if (handle) clearInterval(handle);
      handle = null;
      await pendingTick?.catch(() => undefined);
    },
  };
}
