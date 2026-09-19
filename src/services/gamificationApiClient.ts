import { notifyAuthExpired } from './authState';
import { isScoreChartRange, type MonthPoints, type PersonListItem, type ScoreChart, type ScoreChartBucket, type ScoreChartQuery, type ScoreChartRange, type ScoreProfile, type ScoreScope, type ViewerCapabilities } from '../domain/gamificationV1';
import { createDefaultGamificationPendingStore, GamificationPendingStoreError, type GamificationPendingStore, type PendingGamificationOperations, type PendingRedemptionOperation, type PendingReverseOperation } from './gamificationPendingStore';

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

export interface GamificationApiClientOptions { baseUrl: string; token: string; memberId: string; fetchImpl?: typeof fetch; pendingStore?: GamificationPendingStore; }

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
    ? { key: item.key as string, startDate: item.startDate, endDate: item.endDate, earnedPoints: item.earnedPoints } : null;
}
function parseChart(value: unknown): ScoreChart | null {
  const item = object(value);
  const range = item?.range;
  if (!item || !isScoreChartRange(range) || !(item.anchor === null || string(item.anchor)) || !(item.periodStart === null || validDate(item.periodStart)) || !(item.periodEnd === null || validDate(item.periodEnd)) || !nonNegativeInt(item.earnedPoints) || !(item.previousAnchor === null || string(item.previousAnchor)) || !(item.nextAnchor === null || string(item.nextAnchor)) || !Array.isArray(item.buckets)) return null;
  const buckets = item.buckets.map((entry) => parseChartBucket(entry, range));
  if (buckets.some((bucket) => bucket === null)) return null;
  return { range, anchor: item.anchor as string | null, periodStart: item.periodStart as string | null, periodEnd: item.periodEnd as string | null, earnedPoints: item.earnedPoints, buckets: buckets as ScoreChartBucket[], previousAnchor: item.previousAnchor as string | null, nextAnchor: item.nextAnchor as string | null };
}
function parseReward(value: unknown): Reward | null {
  const item = object(value);
  return item && string(item.rewardId) && string(item.name) && positiveInt(item.costPoints) && typeof item.active === 'boolean' && positiveInt(item.revision)
    ? { rewardId: item.rewardId, name: item.name, costPoints: item.costPoints, active: item.active, revision: item.revision } : null;
}
export interface RewardNomination {
  nominationId: string;
  name: string;
  note?: string;
  displayName: string;
  status: 'OPEN' | 'APPROVED' | 'DECLINED';
  voteCount: number;
  voted: boolean;
  mine: boolean;
  revision: number;
}

/**
 * Built from named keys, like every other parser here.
 *
 * It also REJECTS a payload carrying a member id: the board shows who suggested something by name,
 * and a member id arriving would mean the server had started handing out a handle into every other
 * endpoint. Better to fail loudly here than to render it.
 */
function parseNomination(value: unknown): RewardNomination | null {
  const item = object(value);
  if (!item || item.createdBy !== undefined || item.memberId !== undefined) return null;
  if (!string(item.nominationId) || !string(item.name) || !string(item.displayName) || !positiveInt(item.revision)) return null;
  if (item.status !== 'OPEN' && item.status !== 'APPROVED' && item.status !== 'DECLINED') return null;
  if (!nonNegativeInt(item.voteCount) || typeof item.voted !== 'boolean' || typeof item.mine !== 'boolean') return null;
  return {
    nominationId: item.nominationId,
    name: item.name,
    ...(string(item.note) ? { note: item.note } : {}),
    displayName: item.displayName,
    status: item.status,
    voteCount: item.voteCount,
    voted: item.voted,
    mine: item.mine,
    revision: item.revision,
  };
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
  const people = item.people.map((entry) => { const person = object(entry); return person && string(person.memberId) && string(person.displayName) && nonNegativeInt(person.earnedTotal) && (person.rank === undefined || person.rank === null || positiveInt(person.rank)) ? { memberId: person.memberId, displayName: person.displayName, earnedTotal: person.earnedTotal, ...(person.rank !== undefined ? { rank: person.rank as number | null } : {}) } : null; });
  return people.every(Boolean) ? people as PersonListItem[] : null;
}
function operationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const part = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${part(8)}-${part(4)}-4${part(3)}-8${part(3)}-${part(12)}`;
}

const pendingRuntimeQueues = new Map<string, Promise<void>>();
const pendingRuntimeInFlight = new Map<string, Promise<unknown>>();

export function createGamificationApiClient(options: GamificationApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pendingStore = options.pendingStore ?? createDefaultGamificationPendingStore();
  const pendingClaimOperations = new Map<string, string>();
  const pendingRedemptionOperations = new Map<string, PendingRedemptionOperation>();
  const pendingReverseOperations = new Map<string, PendingReverseOperation>();
  let pendingLoaded: Promise<void> | null = null;
  function pendingError(reason: unknown): GamificationApiError { return new GamificationApiError(reason instanceof GamificationPendingStoreError ? reason.code : 'PENDING_STORAGE_ERROR', true, 0); }
  async function ensurePendingLoaded(): Promise<void> {
    if (!pendingLoaded) {
      const load = pendingStore.read(options.memberId).then((state) => {
        if (state && state.ownerMemberId !== options.memberId) throw new GamificationPendingStoreError('PENDING_DATA_INVALID');
        for (const row of state?.redemptions ?? []) pendingRedemptionOperations.set(`${row.memberId}\u0000${row.rewardId}`, { ...row });
        for (const row of state?.reversals ?? []) pendingReverseOperations.set(row.redemptionId, { ...row });
      }).catch((reason) => { throw pendingError(reason); });
      pendingLoaded = load;
      void load.catch(() => { if (pendingLoaded === load) pendingLoaded = null; });
    }
    return pendingLoaded;
  }
  async function reloadPending(): Promise<void> {
    pendingLoaded = null;
    pendingRedemptionOperations.clear();
    pendingReverseOperations.clear();
    await ensurePendingLoaded();
  }
  function pendingSnapshot(): PendingGamificationOperations { return { ownerMemberId: options.memberId, redemptions: [...pendingRedemptionOperations.values()].map((row) => ({ ...row })), reversals: [...pendingReverseOperations.values()].map((row) => ({ ...row })) }; }
  async function persistPending(): Promise<void> { const state = pendingSnapshot(); try { if (state.redemptions.length || state.reversals.length) await pendingStore.write(options.memberId, state); else await pendingStore.clear(options.memberId); } catch (reason) { throw pendingError(reason); } }
  function enqueueOperation<T>(key: string, work: () => Promise<T>): Promise<T> {
    const runtimeKey = `${options.memberId}\u0000${key}`;
    const existing = pendingRuntimeInFlight.get(runtimeKey) as Promise<T> | undefined;
    if (existing) return existing;
    const task = (pendingRuntimeQueues.get(options.memberId) ?? Promise.resolve()).then(work);
    const queueTail = task.then(() => undefined, () => undefined);
    pendingRuntimeQueues.set(options.memberId, queueTail);
    pendingRuntimeInFlight.set(runtimeKey, task);
    void task.finally(() => {
      if (pendingRuntimeInFlight.get(runtimeKey) === task) pendingRuntimeInFlight.delete(runtimeKey);
      if (pendingRuntimeQueues.get(options.memberId) === queueTail) pendingRuntimeQueues.delete(options.memberId);
    }).catch(() => undefined);
    return task;
  }
  function runRedemption(input: { memberId: string; rewardId: string; expectedRewardRevision: number; operationId?: string }): Promise<unknown> {
    const mapKey = `${input.memberId}\u0000${input.rewardId}`;
    return enqueueOperation(`redeem:${mapKey}\u0000${input.expectedRewardRevision}\u0000${input.operationId ?? ''}`, async () => {
      await reloadPending();
      if (input.operationId && !validUuid(input.operationId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400);
      const prior = pendingRedemptionOperations.get(mapKey);
      if (prior && (prior.memberId !== input.memberId || prior.rewardId !== input.rewardId || prior.expectedRewardRevision !== input.expectedRewardRevision || (input.operationId && input.operationId !== prior.operationId))) throw new GamificationApiError('OPERATION_ID_REUSED', false, 409);
      const record = prior ?? { operationId: input.operationId ?? operationId(), memberId: input.memberId, rewardId: input.rewardId, expectedRewardRevision: input.expectedRewardRevision };
      if (!prior) {
        pendingRedemptionOperations.set(mapKey, record);
        try { await persistPending(); } catch (reason) { pendingRedemptionOperations.delete(mapKey); throw reason; }
      }
      try {
        const result = await request('/api/admin/redemptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: record.memberId, rewardId: record.rewardId, expectedRewardRevision: record.expectedRewardRevision, operationId: record.operationId }) });
        const resultItem = object(result);
        if (!resultItem || !string(resultItem.redemptionId) || resultItem.memberId !== record.memberId || resultItem.rewardId !== record.rewardId || (resultItem.status !== 'COMPLETED' && resultItem.status !== 'REVERSED')) throw new GamificationApiError('AMBIGUOUS_MUTATION_RESPONSE', true, 200);
        pendingRedemptionOperations.delete(mapKey);
        try { await persistPending(); } catch (reason) { pendingRedemptionOperations.set(mapKey, record); throw reason; }
        return result;
      } catch (error) {
        const unresolvedAuthorization = Boolean(prior && error instanceof GamificationApiError && (error.status === 401 || error.status === 403));
        if (!unresolvedAuthorization && (!(error instanceof GamificationApiError) || !error.retryable)) {
          pendingRedemptionOperations.delete(mapKey);
          try { await persistPending(); } catch (reason) { pendingRedemptionOperations.set(mapKey, record); throw reason; }
        }
        throw error;
      }
    });
  }
  function runReversal(input: { redemptionId: string; reason: string; operationId?: string }): Promise<void> {
    const mapKey = input.redemptionId;
    return enqueueOperation(`reverse:${mapKey}\u0000${input.reason}\u0000${input.operationId ?? ''}`, async () => {
      await reloadPending();
      if (input.operationId && !validUuid(input.operationId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400);
      const prior = pendingReverseOperations.get(mapKey);
      if (prior && (prior.reason !== input.reason || (input.operationId && prior.operationId !== input.operationId))) throw new GamificationApiError('OPERATION_ID_REUSED', false, 409);
      const record: PendingReverseOperation = prior ?? { operationId: input.operationId ?? operationId(), redemptionId: input.redemptionId, reason: input.reason };
      if (!prior) {
        pendingReverseOperations.set(mapKey, record);
        try { await persistPending(); } catch (reason) { pendingReverseOperations.delete(mapKey); throw reason; }
      }
      try {
        const result = object(await request(`/api/admin/redemptions/${encodeURIComponent(record.redemptionId)}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: record.operationId, reason: record.reason }) }));
        if (!result || result.redemptionId !== record.redemptionId || result.status !== 'REVERSED') throw new GamificationApiError('AMBIGUOUS_MUTATION_RESPONSE', true, 200);
        pendingReverseOperations.delete(mapKey);
        try { await persistPending(); } catch (reason) { pendingReverseOperations.set(mapKey, record); throw reason; }
      } catch (error) {
        const unresolvedAuthorization = Boolean(prior && error instanceof GamificationApiError && (error.status === 401 || error.status === 403));
        if (!unresolvedAuthorization && (!(error instanceof GamificationApiError) || !error.retryable)) {
          pendingReverseOperations.delete(mapKey);
          try { await persistPending(); } catch (reason) { pendingReverseOperations.set(mapKey, record); throw reason; }
        }
        throw error;
      }
    });
  }
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await fetchImpl(`${options.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${options.token}`, ...(init.headers ?? {}) } }); }
    catch { throw new GamificationApiError('NETWORK_ERROR', true, 0); }
    if (response.status === 401) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token });
    const body = await response.json().catch(() => null);
    if (!response.ok) { const error = object(body)?.error; const detail = object(error); const code = string(detail?.code) ? detail.code : string(error) ? error : 'API_ERROR'; throw new GamificationApiError(code, detail?.retryable === true || response.status >= 500, response.status); }
    return body;
  }
  return {
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
    async getRewards(): Promise<Reward[]> { const body = object(await request('/api/rewards')); const values = body?.rewards; if (!Array.isArray(values)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); const rewards = values.map(parseReward); if (rewards.some((value) => value === null)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return rewards as Reward[]; },
    async getMyRedemptions(): Promise<Redemption[]> { const parsed = parseRedemptions(await request('/api/me/redemptions')); if (!parsed) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return parsed; },
    async getAdminRedemptions(memberId?: string): Promise<Redemption[]> { const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : ''; const parsed = parseRedemptions(await request(`/api/admin/redemptions${query}`)); if (!parsed) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return parsed; },
    async setRewardTarget(rewardId: string | null): Promise<void> { await request('/api/me/reward-target', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rewardId }) }); },
    async createFriendQr(): Promise<FriendQr> { const body = object(await request('/api/friends/qr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })); if (!body || !string(body.payload) || !string(body.token) || !validEpoch(body.expiresAt)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return { payload: body.payload, token: body.token, expiresAt: body.expiresAt }; },
    async claimFriendQr(token: string, operationIdValue?: string): Promise<{ memberId: string }> { const resolvedOperationId = operationIdValue ?? pendingClaimOperations.get(token) ?? operationId(); pendingClaimOperations.set(token, resolvedOperationId); if (!validUuid(resolvedOperationId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 400); try { const body = object(await request('/api/friends/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: resolvedOperationId, token }) })); if (!body || !string(body.memberId)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); pendingClaimOperations.delete(token); return { memberId: body.memberId }; } catch (error) { throw error; } },
    async removeFriend(memberId: string): Promise<void> { await request(`/api/friends/${encodeURIComponent(memberId)}`, { method: 'DELETE' }); },
    async createReward(input: { name: string; costPoints: number; operationId?: string }): Promise<Reward> { const body = object(await request('/api/admin/rewards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: input.operationId ?? operationId(), name: input.name, costPoints: input.costPoints }) })); const reward = parseReward(body); if (!reward) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return reward; },
    async updateReward(rewardId: string, patch: { name?: string; costPoints?: number; active?: boolean }, expectedRevision = 1, operationIdValue = operationId()): Promise<Reward> { const body = object(await request(`/api/admin/rewards/${encodeURIComponent(rewardId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...patch, expectedRevision, operationId: operationIdValue }) })); const reward = parseReward(body); if (!reward) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200); return reward; },
    async getNominations(): Promise<RewardNomination[]> {
      const body = object(await request('/api/rewards/nominations'));
      const values = body?.nominations;
      if (!Array.isArray(values)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      const parsed = values.map(parseNomination);
      if (parsed.some((value) => value === null)) throw new GamificationApiError('INVALID_API_RESPONSE', false, 200);
      return parsed as RewardNomination[];
    },
    async nominateReward(input: { name: string; note?: string }): Promise<void> {
      await request('/api/rewards/nominations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: operationId(), name: input.name, ...(input.note ? { note: input.note } : {}) }) });
    },
    async setNominationVote(nominationId: string, voting: boolean): Promise<void> {
      await request(`/api/rewards/nominations/${encodeURIComponent(nominationId)}/vote`, { method: voting ? 'PUT' : 'DELETE' });
    },
    async decideNomination(nominationId: string, decision: 'approve' | 'decline' | 'remove', input: { expectedRevision: number; costPoints?: number }): Promise<void> {
      await request(`/api/admin/rewards/nominations/${encodeURIComponent(nominationId)}/${decision}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: operationId(), expectedRevision: input.expectedRevision, ...(input.costPoints ? { costPoints: input.costPoints } : {}) }) });
    },
    async getPendingOperations(): Promise<PendingGamificationOperations> { await reloadPending(); return pendingSnapshot(); },
    async redeem(input: { memberId: string; rewardId: string; expectedRewardRevision: number; operationId?: string }): Promise<unknown> { return runRedemption(input); },
    async retryPendingRedemption(operationIdValue: string): Promise<unknown> {
      await ensurePendingLoaded();
      const record = [...pendingRedemptionOperations.values()].find((row) => row.operationId === operationIdValue);
      if (!record) throw new GamificationApiError('PENDING_OPERATION_NOT_FOUND', false, 404);
      return runRedemption({ ...record });
    },
    async reverseRedemption(redemptionId: string, reason: string, operationIdValue?: string): Promise<void> { return runReversal({ operationId: operationIdValue, redemptionId, reason }); },
    async retryPendingReversal(operationIdValue: string): Promise<void> {
      await ensurePendingLoaded();
      const record = [...pendingReverseOperations.values()].find((row) => row.operationId === operationIdValue);
      if (!record) throw new GamificationApiError('PENDING_OPERATION_NOT_FOUND', false, 404);
      return runReversal({ ...record });
    },
  };
}
