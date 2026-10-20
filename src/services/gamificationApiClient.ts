import { notifyAuthExpired } from './authState';
import { isScoreChartRange, type MonthPoints, type PersonListItem, type ScoreChart, type ScoreChartBucket, type ScoreChartQuery, type ScoreChartRange, type ScoreProfile, type ScoreScope, type ViewerCapabilities } from '../domain/gamificationV1';

export type { MonthPoints, PersonListItem, ScoreChart, ScoreChartBucket, ScoreChartQuery, ScoreChartRange, ScoreProfile, ScoreScope, ViewerCapabilities };

export interface Reward {
  rewardId: string;
  name: string;
  costPoints: number;
  active: boolean;
  revision: number;
}

export interface FriendQr { payload: string; token: string; expiresAt: number; }
export interface Redemption { redemptionId: string; memberId: string; rewardId: string; rewardName: string; costPoints: number; status: 'COMPLETED' | 'REVERSED'; confirmedAt: number | null; }

export interface GamificationApiClientOptions { baseUrl: string; token: string; memberId: string; fetchImpl?: typeof fetch; }

export class GamificationApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly status: number;
  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = 'GamificationApiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.userMessage = errorMessage(code);
  }
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: '請先登入。', AUTH_INVALID: '登入已失效，請重新登入。', ADMIN_REQUIRED: '此功能僅限管理者。',
  MEMBER_NOT_ACCESSIBLE: '目前無法查看這位會員。', FRIEND_QR_EXPIRED: '好友碼已過期，請對方重新開啟 QR。',
  SELF_FRIEND_NOT_ALLOWED: '這是自己的好友碼。', INSUFFICIENT_POINTS: '可兌換積分不足。', REWARD_CHANGED: '獎品資料已更新，請重新確認。',
  OPERATION_ID_REUSED: '這次操作無法重複送出。', OUTSIDE_COMPLETION_WINDOW: '已超過補登期限。',
  REDEMPTION_ALREADY_REVERSED: '這筆兌換已撤銷。', INVALID_API_RESPONSE: '資料格式錯誤，請稍後再試。',
  PENDING_STORAGE_ERROR: '無法安全保存這次操作，請稍後再試。', PENDING_DATA_INVALID: '已保存的待確認操作無法讀取，請稍後再試。',
  AMBIGUOUS_MUTATION_RESPONSE: '尚未確認操作結果，請使用已保存的操作重試。',
};
function errorMessage(code: string): string { return messages[code] ?? '目前無法完成操作，請稍後再試。'; }

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function nonNegativeInt(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function positiveInt(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0; }
function validMonth(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validEpoch(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function validUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function parseMonths(value: unknown): MonthPoints[] | null {
  if (!Array.isArray(value)) return null;
  const months = value.map((entry) => { const item = object(entry); return item && validMonth(item.month) && nonNegativeInt(item.earnedPoints) ? { month: item.month, earnedPoints: item.earnedPoints } : null; });
  return months.every(Boolean) ? months as MonthPoints[] : null;
}
function parseChartBucket(value: unknown, range: ScoreChart['range']): ScoreChartBucket | null {
  const item = object(value);
  const validKey = range === 'week' || range === 'month' ? typeof item?.key === 'string' && validDate(item.key) : range === 'year' ? typeof item?.key === 'string' && validMonth(item.key) : typeof item?.key === 'string' && /^\d{4}$/.test(item.key);
  return item && validKey && validDate(item.startDate) && validDate(item.endDate) && item.startDate <= item.endDate && nonNegativeInt(item.earnedPoints)
    && (item.cumulativeEarnedPoints === undefined || nonNegativeInt(item.cumulativeEarnedPoints))
    ? { key: item.key as string, startDate: item.startDate, endDate: item.endDate, earnedPoints: item.earnedPoints, ...(item.cumulativeEarnedPoints !== undefined ? { cumulativeEarnedPoints: item.cumulativeEarnedPoints as number } : {}) } : null;
}
function parseChart(value: unknown): ScoreChart | null {
  const item = object(value);
  const range = item?.range;
  if (!item || !isScoreChartRange(range) || !(item.anchor === null || string(item.anchor)) || !(item.periodStart === null || validDate(item.periodStart)) || !(item.periodEnd === null || validDate(item.periodEnd)) || !nonNegativeInt(item.earnedPoints) || !(item.openingEarnedPoints === undefined || nonNegativeInt(item.openingEarnedPoints)) || !(item.previousAnchor === null || string(item.previousAnchor)) || !(item.nextAnchor === null || string(item.nextAnchor)) || !Array.isArray(item.buckets)) return null;
  const buckets = item.buckets.map((entry) => parseChartBucket(entry, range));
  if (buckets.some((bucket) => bucket === null)) return null;
  return { range, anchor: item.anchor as string | null, periodStart: item.periodStart as string | null, periodEnd: item.periodEnd as string | null, earnedPoints: item.earnedPoints, ...(item.openingEarnedPoints !== undefined ? { openingEarnedPoints: item.openingEarnedPoints as number } : {}), buckets: buckets as ScoreChartBucket[], previousAnchor: item.previousAnchor as string | null, nextAnchor: item.nextAnchor as string | null };
}
function parseReward(value: unknown): Reward | null {
  const item = object(value);
  return item && string(item.rewardId) && string(item.name) && positiveInt(item.costPoints) && typeof item.active === 'boolean' && positiveInt(item.revision)
    ? { rewardId: item.rewardId, name: item.name, costPoints: item.costPoints, active: item.active, revision: item.revision } : null;
}
export interface CommunityChapterView { chapter: number; readers: number | null }
export interface CommunityBookGoal {
  book: string;
  chapters: CommunityChapterView[];
  complete: boolean;
}
export interface CommunityProgressView {
  books: string[];
  personDays: number | null;
  currentBook: CommunityBookGoal | null;
}

/**
 * The shared book goal, or nothing at all.
 *
 * Nothing at all is a real answer and not a failure: a server that predates this feature simply has
 * no such field, and a phone that has not been updated yet should keep showing what the rest of the
 * page says rather than refuse to draw it. Anything malformed lands in the same place, because the
 * only thing this display can honestly do without it is not appear.
 */
function parseBookGoal(value: unknown): CommunityBookGoal | null {
  const item = object(value);
  if (!item || !string(item.book) || !Array.isArray(item.chapters) || typeof item.complete !== 'boolean') return null;
  const chapters: CommunityChapterView[] = [];
  for (const entry of item.chapters) {
    const chapter = object(entry);
    if (!chapter || !positiveInt(chapter.chapter)) return null;
    // Nobody yet is null here too. A zero would be a different claim, and one this never makes.
    if (chapter.readers !== null && !positiveInt(chapter.readers)) return null;
    chapters.push({ chapter: chapter.chapter, readers: chapter.readers as number | null });
  }
  return { book: item.book, chapters, complete: item.complete };
}

function parseRedemption(value: unknown): Redemption | null {
  const item = object(value);
  return item && string(item.redemptionId) && string(item.memberId) && string(item.rewardId) && string(item.rewardName)
    && positiveInt(item.costPoints) && (item.status === 'COMPLETED' || item.status === 'REVERSED')
    && (item.confirmedAt === null || validEpoch(item.confirmedAt))
    ? { redemptionId: item.redemptionId, memberId: item.memberId, rewardId: item.rewardId, rewardName: item.rewardName, costPoints: item.costPoints, status: item.status, confirmedAt: item.confirmedAt as number | null } : null;
}
function parseRedemptions(value: unknown): Redemption[] | null {
  const item = object(value); if (!item || !Array.isArray(item.redemptions)) return null;
  const rows = item.redemptions.map(parseRedemption); return rows.every(Boolean) ? rows as Redemption[] : null;
}
function parseProfile(value: unknown): ScoreProfile | null {
  const item = object(value), permissions = item && object(item.permissions), privateData = item?.private === undefined ? undefined : object(item.private);
  if (!item || !string(item.memberId) || !string(item.displayName) || !nonNegativeInt(item.earnedTotal) || !(item.band === null || (positiveInt(item.band) && item.band <= 5)) || !permissions || typeof permissions.canEditTarget !== 'boolean' || typeof permissions.canRedeem !== 'boolean') return null;
  const months = parseMonths(item.months);
  const chart = item.chart === undefined ? undefined : parseChart(item.chart);
  if (!months || (item.chart !== undefined && !chart) || (item.private !== undefined && (!privateData || !nonNegativeInt(privateData.redeemableBalance) || !(privateData.targetReward === null || parseReward(privateData.targetReward)))) ) return null;
  let targetReward: Reward | null = null;
  if (privateData && privateData.targetReward !== null) targetReward = parseReward(privateData.targetReward);
  return { memberId: item.memberId, displayName: item.displayName, earnedTotal: item.earnedTotal, band: item.band, months, ...(chart ? { chart } : {}), ...(privateData ? { private: { redeemableBalance: privateData.redeemableBalance as number, targetReward } } : {}), permissions: { canEditTarget: permissions.canEditTarget, canRedeem: permissions.canRedeem } };
}
function parsePeople(value: unknown): PersonListItem[] | null {
  const item = object(value); if (!item || !Array.isArray(item.people)) return null;
  const people = item.people.map((entry) => { const person = object(entry); return person && string(person.memberId) && string(person.displayName) && nonNegativeInt(person.earnedTotal) && (person.rank === undefined || person.rank === null || positiveInt(person.rank)) ? { memberId: person.memberId, displayName: person.displayName, earnedTotal: person.earnedTotal, ...(person.rank !== undefined ? { rank: person.rank as number | null } : {}), ...(person.congregation === 'youth' || person.congregation === 'main' ? { congregation: person.congregation } : {}) } : null; });
  return people.every(Boolean) ? people as PersonListItem[] : null;
}
function operationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const part = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${part(8)}-${part(4)}-4${part(3)}-8${part(3)}-${part(12)}`;
}

export function createGamificationApiClient(options: GamificationApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const reads = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  const pendingClaimOperations = new Map<string, string>();
  async function performRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await fetchImpl(`${options.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${options.token}`, ...(init.headers ?? {}) } }); }
    catch { throw new GamificationApiError('NETWORK_ERROR', true, 0); }
    if (init.signal?.aborted) throw new GamificationApiError('REQUEST_CANCELLED', true, 0);
    if (response.status === 401) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token });
    const body = await response.json().catch(() => null);
    if (init.signal?.aborted) throw new GamificationApiError('REQUEST_CANCELLED', true, 0);
    if (!response.ok) { const error = object(body)?.error; const detail = object(error); const code = string(detail?.code) ? detail.code : string(error) ? error : 'API_ERROR'; throw new GamificationApiError(code, detail?.retryable === true || response.status >= 500, response.status); }
    return body;
  }
  function request(path: string, init: RequestInit = {}): Promise<unknown> {
    // Mutation identity/recovery stays with its existing operation store. Only reads are shared.
    if (init.method && init.method !== 'GET') return performRequest(path, init);
    const prior = reads.get(path);
    if (prior) return prior.promise;
    const controller = new AbortController();
    let timedOut = false;
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new GamificationApiError(timedOut ? 'READ_TIMEOUT' : 'REQUEST_CANCELLED', true, 0)), { once: true });
    });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const promise = Promise.race([performRequest(path, { ...init, signal: controller.signal }), cancelled]).catch((reason: unknown) => {
      // CI-only evidence for the actual rejected read. Never log a URL, member,
      // credential, response body or free-form provider message; production is silent.
      if (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true') {
        const rawCode = reason instanceof GamificationApiError ? reason.code : '';
        const knownCodes = ['NETWORK_ERROR', 'READ_TIMEOUT', 'REQUEST_CANCELLED', 'AUTH_REQUIRED', 'AUTH_INVALID', 'ACCOUNT_DISABLED', 'INVALID_API_RESPONSE', 'API_ERROR'];
        console.error('CI_GAMIFICATION_READ_ERROR', {
          operation: path.startsWith('/api/points/profiles/') ? 'SCORE_PROFILE' : path === '/api/me/profile' ? 'CAPABILITIES' : 'OTHER_READ',
          code: knownCodes.includes(rawCode) ? rawCode : 'OTHER_API_ERROR',
          status: reason instanceof GamificationApiError && Number.isInteger(reason.status) ? reason.status : 0,
        });
      }
      throw reason;
    }).finally(() => {
      clearTimeout(timer);
      if (reads.get(path)?.controller === controller) reads.delete(path);
    });
    reads.set(path, { controller, promise });
    return promise;
  }
  return {
    cancelReads(path?: string): void { for (const [key, read] of reads) { if (path === undefined || key === path) { read.controller.abort(); reads.delete(key); } } },
    async getCapabilities(): Promise<ViewerCapabilities> {
      const item = object(await request('/api/me/profile')); const capabilities = item && object(item.capabilities);
      if (!capabilities || typeof capabilities.canViewAllScores !== 'boolean' || typeof capabilities.canManageRewards !== 'boolean' || typeof capabilities.canRedeemRewards !== 'boolean') throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      return { canViewAllScores: capabilities.canViewAllScores, canManageRewards: capabilities.canManageRewards, canRedeemRewards: capabilities.canRedeemRewards };
    },
    async getPeople(scope: Exclude<ScoreScope, 'me'>): Promise<PersonListItem[]> { const parsed = parsePeople(await request(`/api/points/people?scope=${scope}`)); if (!parsed) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return parsed; },
    async getProfile(memberId: string, scope: ScoreScope, anchorMonth: string, chartQuery?: ScoreChartQuery): Promise<ScoreProfile> {
      if (!validMonth(anchorMonth)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400);
      if (chartQuery && (!isScoreChartRange(chartQuery.range) || (chartQuery.anchor !== undefined && !string(chartQuery.anchor)))) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400);
      const chartParams = chartQuery ? `&chartRange=${chartQuery.range}${chartQuery.anchor !== undefined ? `&chartAnchor=${encodeURIComponent(chartQuery.anchor)}` : ''}` : '';
      const parsed = parseProfile(await request(`/api/points/profiles/${encodeURIComponent(memberId)}?scope=${scope}&anchorMonth=${anchorMonth}${chartParams}`));
      if (!parsed || parsed.memberId !== memberId) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      if (scope === 'friends' && parsed.private !== undefined) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      return parsed;
    },
    // Without a side, the member's own list. With one (維護者 2026-10-20: the other side is seen, never chosen), only
    // an answer that names that side is believed: an older server ignores the question and sends the member's own.
    async getRewards(side?: 'youth' | 'main'): Promise<Reward[]> { const body = object(await request(side ? `/api/rewards?congregation=${side}` : '/api/rewards')); const values = body?.rewards; if (!Array.isArray(values) || (side && body?.congregation !== side)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); const rewards = values.map(parseReward); if (rewards.some((value) => value === null)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return rewards as Reward[]; },
    async getMyRedemptions(): Promise<Redemption[]> { const parsed = parseRedemptions(await request('/api/me/redemptions')); if (!parsed) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return parsed; },
    async setRewardTarget(rewardId: string | null): Promise<void> { await request('/api/me/reward-target', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rewardId }) }); },
    async createFriendQr(): Promise<FriendQr> { const body = object(await request('/api/friends/qr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })); if (!body || !string(body.payload) || !string(body.token) || !validEpoch(body.expiresAt)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return { payload: body.payload, token: body.token, expiresAt: body.expiresAt }; },
    async claimFriendQr(token: string, operationIdValue?: string): Promise<{ memberId: string }> { const resolvedOperationId = operationIdValue ?? pendingClaimOperations.get(token) ?? operationId(); pendingClaimOperations.set(token, resolvedOperationId); if (!validUuid(resolvedOperationId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400); try { const body = object(await request('/api/friends/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: resolvedOperationId, token }) })); if (!body || !string(body.memberId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); pendingClaimOperations.delete(token); return { memberId: body.memberId }; } catch (error) { throw error; } },
    async removeFriend(memberId: string): Promise<void> { await request(`/api/friends/${encodeURIComponent(memberId)}`, { method: 'DELETE' }); },
    async getCommunityProgress(): Promise<CommunityProgressView> {
      const body = object(await request('/api/points/community'));
      if (!body || !Array.isArray(body.books) || !body.books.every((value) => string(value))) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      const personDays = body.personDays;
      if (personDays !== null && !nonNegativeInt(personDays)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      return { books: body.books as string[], personDays: personDays as number | null, currentBook: parseBookGoal(body.currentBook) };
    },
  };
}
