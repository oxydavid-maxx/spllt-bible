import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));
import { createGamificationApiClient, GamificationApiError } from '../../src/services/gamificationApiClient';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function redeemed(redemptionId: string, memberId = 'member:1', rewardId = 'reward-1'): Response {
  return response({ redemptionId, memberId, rewardId, rewardName: '飲料', costPoints: 2, status: 'COMPLETED', redeemableBalance: 2 });
}
function reversed(redemptionId: string): Response {
  return response({ redemptionId, memberId: 'member:1', status: 'REVERSED', redeemableBalance: 4 });
}

describe('gamification api client', () => {
  it('accepts an optional chart query and preserves the returned chart extension', async () => {
    const memberId = 'member-chart';
    const chart = {
      range: 'week', anchor: '2026-09-07', periodStart: '2026-09-07', periodEnd: '2026-09-13', earnedPoints: 1, openingEarnedPoints: 2,
      previousAnchor: '2026-08-31', nextAnchor: '2026-09-14',
      buckets: [{ key: '2026-09-07', startDate: '2026-09-07', endDate: '2026-09-07', earnedPoints: 1, cumulativeEarnedPoints: 3 }],
    };
    const fetchImpl = vi.fn(async () => response({
      memberId, displayName: '小明', earnedTotal: 1, band: null,
      months: [{ month: '2026-09', earnedPoints: 1 }], chart,
      permissions: { canEditTarget: false, canRedeem: false },
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId, fetchImpl });
    await expect(client.getProfile(memberId, 'me', '2026-09', { range: 'week', anchor: '2026-09-07' })).resolves.toMatchObject({ chart });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://example.test/api/points/profiles/member-chart?scope=me&anchorMonth=2026-09&chartRange=week&chartAnchor=2026-09-07');
  });

  it('continues to accept a legacy chart with no cumulative fields', async () => {
    const legacyChart = {
      range: 'week', anchor: '2026-09-07', periodStart: '2026-09-07', periodEnd: '2026-09-13', earnedPoints: 1,
      previousAnchor: '2026-08-31', nextAnchor: '2026-09-14',
      buckets: [{ key: '2026-09-07', startDate: '2026-09-07', endDate: '2026-09-07', earnedPoints: 1 }],
    };
    const fetchImpl = vi.fn(async () => response({
      memberId: 'member-chart', displayName: '小明', earnedTotal: 1, band: null,
      months: [{ month: '2026-09', earnedPoints: 1 }], chart: legacyChart,
      permissions: { canEditTarget: false, canRedeem: false },
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member-chart', fetchImpl });
    const profile = await client.getProfile('member-chart', 'me', '2026-09');
    expect(profile.chart).toMatchObject({ range: 'week', buckets: [{ earnedPoints: 1 }] });
    expect(profile.chart).not.toHaveProperty('openingEarnedPoints');
    expect(profile.chart?.buckets[0]).not.toHaveProperty('cumulativeEarnedPoints');
  });

  it('rejects a malformed cumulative value instead of exposing it to the chart', async () => {
    const fetchImpl = vi.fn(async () => response({
      memberId: 'member-chart', displayName: '小明', earnedTotal: 1, band: null,
      months: [{ month: '2026-09', earnedPoints: 1 }],
      chart: {
        range: 'week', anchor: '2026-09-07', periodStart: '2026-09-07', periodEnd: '2026-09-13', earnedPoints: 1,
        openingEarnedPoints: 2, previousAnchor: '2026-08-31', nextAnchor: '2026-09-14',
        buckets: [{ key: '2026-09-07', startDate: '2026-09-07', endDate: '2026-09-07', earnedPoints: 1, cumulativeEarnedPoints: 2.5 }],
      },
      permissions: { canEditTarget: false, canRedeem: false },
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member-chart', fetchImpl });
    await expect(client.getProfile('member-chart', 'me', '2026-09')).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('sends bearer auth and explicit profile scope without a client actor', async () => {
    const memberId = 'legacy:member:1';
    const fetchImpl = vi.fn(async () => response({
      memberId, displayName: '小明', earnedTotal: 3, band: 2,
      months: [{ month: '2026-09', earnedPoints: 3 }],
      private: { redeemableBalance: 3, targetReward: null },
      permissions: { canEditTarget: true, canRedeem: false },
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 'qmd_token', memberId, fetchImpl });
    await client.getProfile(memberId, 'me', '2026-09');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/api/points/profiles/legacy%3Amember%3A1?scope=me&anchorMonth=2026-09');
    expect(init.headers).toEqual({ authorization: 'Bearer qmd_token' });
    expect(init.headers).not.toHaveProperty('x-qingmu-member-id');
  });

  it('rejects malformed numeric and date fields before exposing them to UI', async () => {
    const fetchImpl = vi.fn(async () => response({
      memberId: 'member-1', displayName: '小明', earnedTotal: -1, band: null,
      months: [{ month: '2026-13', earnedPoints: 2 }],
      permissions: { canEditTarget: false, canRedeem: false },
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member-1', fetchImpl });
    await expect(client.getProfile('member-1', 'friends', '2026-09')).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('maps server errors to short Chinese messages without exposing error codes', async () => {
    const fetchImpl = vi.fn(async () => response({ error: { code: 'FRIEND_QR_EXPIRED', retryable: false } }, 409));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member-1', fetchImpl });
    try { await client.claimFriendQr('expired', '11111111-1111-4111-8111-111111111111'); } catch (error) {
      expect(error).toBeInstanceOf(GamificationApiError);
      expect((error as GamificationApiError).userMessage).toBe('好友碼已過期，請對方重新開啟 QR。');
      expect((error as GamificationApiError).userMessage).not.toContain('FRIEND_QR_EXPIRED');
    }
  });

  it('reuses the same operation ID when a friend claim is retried after timeout', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(response({ memberId: 'owner' }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member-1', fetchImpl });
    await expect(client.claimFriendQr('opaque-token')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await client.claimFriendQr('opaque-token');
    const first = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.operationId).toBe(second.operationId);
  });

  it('loads self and admin redemption records through their scoped endpoints', async () => {
    const row = { redemptionId: 'r1', memberId: 'member:1', rewardId: 'reward-1', rewardName: '飲料', costPoints: 2, status: 'COMPLETED', confirmedAt: 10 };
    const fetchImpl = vi.fn(async (url: string) => response({ redemptions: [row] }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getMyRedemptions()).resolves.toEqual([row]);
    await expect(client.getAdminRedemptions('member:1')).resolves.toEqual([row]);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['https://example.test/api/me/redemptions', 'https://example.test/api/admin/redemptions?memberId=member%3A1']);
  });

  it('persists a pending redemption before dispatch and restores its ID/payload across client instances', async () => {
    const values = new Map<string, import('../../src/services/gamificationPendingStore').PendingGamificationOperations>();
    const store = { read: vi.fn(async (memberId: string) => values.get(memberId) ?? null), write: vi.fn(async (memberId: string, value: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { values.set(memberId, structuredClone(value)); }), clear: vi.fn(async (memberId: string) => { values.delete(memberId); }) };
    const input = { memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 4 };
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(redeemed('r1'));
    const first = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: fetchImpl as unknown as typeof fetch, pendingStore: store });
    await expect(first.redeem(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    const second = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: fetchImpl as unknown as typeof fetch, pendingStore: store });
    await second.redeem(input);
    const firstBody = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const retryBody = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(retryBody).toEqual(firstBody);
    expect(store.write).toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalled();
    const otherFetch = vi.fn(async () => redeemed('r2'));
    const otherAccount = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:B', fetchImpl: otherFetch as unknown as typeof fetch, pendingStore: store });
    await otherAccount.redeem(input);
    const otherBody = JSON.parse(String((otherFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(otherBody.operationId).not.toBe(firstBody.operationId);
  });

  it('fails closed before dispatch when pending storage cannot be read or written', async () => {
    const fetchImpl = vi.fn(async () => response({ redemptionId: 'never' }));
    const readFailure = { read: vi.fn(async () => { throw new Error('read failed'); }), write: vi.fn(), clear: vi.fn() };
    const readClient = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl, pendingStore: readFailure });
    await expect(readClient.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 })).rejects.toMatchObject({ code: 'PENDING_STORAGE_ERROR', retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();

    const writeFailure = { read: vi.fn(async () => null), write: vi.fn(async () => { throw new Error('write failed'); }), clear: vi.fn() };
    const writeClient = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl, pendingStore: writeFailure });
    await expect(writeClient.reverseRedemption('r1', '原始理由')).rejects.toMatchObject({ code: 'PENDING_STORAGE_ERROR', retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves the original pending request when a successful HTTP response is ambiguous', async () => {
    let state: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = null;
    const store = { read: vi.fn(async () => state), write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { state = structuredClone(next); }), clear: vi.fn(async () => { state = null; }) };
    const fetchImpl = vi.fn(async () => response({ unexpected: true }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: fetchImpl as unknown as typeof fetch, pendingStore: store });

    await expect(client.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 3 })).rejects.toMatchObject({ code: 'AMBIGUOUS_MUTATION_RESPONSE', retryable: true });

    const saved = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(saved?.redemptions[0]).toMatchObject({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves pending state for an unclassified server failure', async () => {
    let state: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = null;
    const store = { read: vi.fn(async () => state), write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { state = structuredClone(next); }), clear: vi.fn(async () => { state = null; }) };
    const fetchImpl = vi.fn(async () => response({ error: { code: 'SERVER_FAILURE' } }, 500));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl, pendingStore: store });

    await expect(client.reverseRedemption('r1', '原始理由')).rejects.toMatchObject({ code: 'SERVER_FAILURE', retryable: true });

    const saved = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(saved?.reversals[0]).toMatchObject({ redemptionId: 'r1', reason: '原始理由' });
  });

  it('keeps an earlier uncertain operation when a later retry loses admin authorization', async () => {
    let state: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = {
      ownerMemberId: 'admin:A',
      redemptions: [{ operationId: '11111111-1111-4111-8111-111111111111', memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 }],
      reversals: [],
    };
    const store = { read: vi.fn(async () => state && structuredClone(state)), write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { state = structuredClone(next); }), clear: vi.fn(async () => { state = null; }) };
    const fetchImpl = vi.fn(async () => response({ error: { code: 'ADMIN_REQUIRED', retryable: false } }, 403));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 'expired', memberId: 'admin:A', fetchImpl, pendingStore: store });

    await expect(client.retryPendingRedemption('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });

    const saved = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(saved?.redemptions).toHaveLength(1);
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('serializes concurrent pending changes without losing either operation', async () => {
    let state: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = null;
    const writes: import('../../src/services/gamificationPendingStore').PendingGamificationOperations[] = [];
    const store = {
      read: vi.fn(async () => state),
      write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { await Promise.resolve(); state = structuredClone(next); writes.push(structuredClone(next)); }),
      clear: vi.fn(async () => { state = null; }),
    };
    const fetchImpl = vi.fn(async () => { throw new Error('timeout'); });
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl, pendingStore: store });

    await Promise.allSettled([
      client.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 }),
      client.reverseRedemption('redemption-2', '原始理由'),
    ]);

    const saved = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(saved?.redemptions).toHaveLength(1);
    expect(saved?.reversals).toHaveLength(1);
    expect(writes.at(-1)).toEqual(saved);
  });

  it('serializes concurrent clients for the same admin without losing pending state', async () => {
    let state: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = null;
    const store = {
      read: vi.fn(async () => state && structuredClone(state)),
      write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { await Promise.resolve(); state = structuredClone(next); }),
      clear: vi.fn(async () => { state = null; }),
    };
    const first = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: vi.fn(async () => { throw new Error('timeout'); }), pendingStore: store });
    const second = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: vi.fn(async () => { throw new Error('timeout'); }), pendingStore: store });

    await Promise.allSettled([
      first.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 }),
      second.reverseRedemption('redemption-2', '原始理由'),
    ]);

    const saved = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(saved?.redemptions).toHaveLength(1);
    expect(saved?.reversals).toHaveLength(1);

    await first.reverseRedemption('redemption-3', '另一理由').catch(() => undefined);
    const refreshed = state as import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null;
    expect(refreshed?.redemptions).toHaveLength(1);
    expect(refreshed?.reversals).toHaveLength(2);
  });

  it('lists only this admin pending operations and replays their immutable payloads', async () => {
    const values = new Map<string, import('../../src/services/gamificationPendingStore').PendingGamificationOperations>([[
      'admin:A',
      {
        ownerMemberId: 'admin:A',
        redemptions: [{ operationId: '11111111-1111-4111-8111-111111111111', memberId: 'member:1', rewardId: 'reward-original', expectedRewardRevision: 2 }],
        reversals: [{ operationId: '22222222-2222-4222-8222-222222222222', redemptionId: 'redemption-1', reason: '原始理由' }],
      },
    ]]);
    const store = { read: vi.fn(async (memberId: string) => values.get(memberId) ?? null), write: vi.fn(async (memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { values.set(memberId, structuredClone(next)); }), clear: vi.fn(async (memberId: string) => { values.delete(memberId); }) };
    const fetchImpl = vi.fn(async (url: string) => url.endsWith('/reverse') ? reversed('redemption-1') : redeemed('ok', 'member:1', 'reward-original'));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: fetchImpl as unknown as typeof fetch, pendingStore: store });

    await expect(client.getPendingOperations()).resolves.toEqual(values.get('admin:A'));
    await client.retryPendingRedemption('11111111-1111-4111-8111-111111111111');
    await client.retryPendingReversal('22222222-2222-4222-8222-222222222222');

    const redemptionBody = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const reversalBody = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(redemptionBody).toEqual({ memberId: 'member:1', rewardId: 'reward-original', expectedRewardRevision: 2, operationId: '11111111-1111-4111-8111-111111111111' });
    expect(reversalBody).toEqual({ operationId: '22222222-2222-4222-8222-222222222222', reason: '原始理由' });
    await expect(client.getPendingOperations()).resolves.toEqual({ ownerMemberId: 'admin:A', redemptions: [], reversals: [] });

    const otherFetch = vi.fn(async () => response({ redemptionId: 'wrong' }));
    const other = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:B', fetchImpl: otherFetch, pendingStore: store });
    await expect(other.getPendingOperations()).resolves.toEqual({ ownerMemberId: 'admin:B', redemptions: [], reversals: [] });
    expect(otherFetch).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent redemption dispatch and binds reversal retries to the original reason', async () => {
    let release!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: fetchImpl as unknown as typeof fetch });
    const first = client.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 });
    const second = client.redeem({ memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(redeemed('r1'));
    await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    let reverseState: import('../../src/services/gamificationPendingStore').PendingGamificationOperations | null = null;
    const reverseStore = { read: vi.fn(async () => reverseState && structuredClone(reverseState)), write: vi.fn(async (_memberId: string, next: import('../../src/services/gamificationPendingStore').PendingGamificationOperations) => { reverseState = structuredClone(next); }), clear: vi.fn(async () => { reverseState = null; }) };
    const reverseFetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(reversed('r1'));
    const reverseClient = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'admin:A', fetchImpl: reverseFetch as unknown as typeof fetch, pendingStore: reverseStore });
    await expect(reverseClient.reverseRedemption('r1', '原始理由')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(reverseClient.reverseRedemption('r1', '改寫理由')).rejects.toMatchObject({ code: 'OPERATION_ID_REUSED' });
    await reverseClient.reverseRedemption('r1', '原始理由');
    const firstBody = JSON.parse(String((reverseFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const retryBody = JSON.parse(String((reverseFetch.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(retryBody).toEqual(firstBody);
  });
});

describe('the nomination board never carries a handle to a person', () => {
  it('refuses a payload that includes a member id, instead of rendering it', async () => {
    const fetchImpl = vi.fn(async () => response({
      nominations: [{ nominationId: 'n1', name: '電影票', displayName: '小明', status: 'OPEN', voteCount: 1, voted: false, mine: false, revision: 1, createdBy: 'member-self' }],
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://api.test', token: 'token', memberId: 'member-self', fetchImpl: fetchImpl as never });
    await expect(client.getNominations()).rejects.toThrow();
  });

  it('accepts the shape the server actually sends', async () => {
    const fetchImpl = vi.fn(async () => response({
      round: { roundId: 'r1', title: '十月獎品', closesAt: 1790000000000, phase: 'VOTING' },
      nominations: [{ nominationId: 'n1', name: '電影票', displayName: '小明', status: 'OPEN', voteCount: 1, voted: true, mine: true, revision: 1, estimatedPoints: 75, noteSuggestion: '跟朋友一起去看一場電影。' }],
    }));
    const client = createGamificationApiClient({ baseUrl: 'https://api.test', token: 'token', memberId: 'member-self', fetchImpl: fetchImpl as never });
    await expect(client.getNominations()).resolves.toEqual({
      round: { roundId: 'r1', title: '十月獎品', closesAt: 1790000000000, phase: 'VOTING' },
      nominations: [{ nominationId: 'n1', name: '電影票', displayName: '小明', status: 'OPEN', voteCount: 1, voted: true, mine: true, revision: 1, estimatedPoints: 75, noteSuggestion: '跟朋友一起去看一場電影。' }],
      // This reply predates the vote limit and does not carry the counts. A member facing an older
      // server keeps their three rather than being told they have none, which would read as a board
      // nobody may vote on at all.
      votesLeft: 3,
      votesPerMember: 3,
    });
  });

  // No round running is an ordinary answer, not a malformed one: the board simply is not on.
  it('reads no round as no round, rather than as a broken reply', async () => {
    const fetchImpl = vi.fn(async () => response({ round: null, nominations: [] }));
    const client = createGamificationApiClient({ baseUrl: 'https://api.test', token: 'token', memberId: 'member-self', fetchImpl: fetchImpl as never });
    await expect(client.getNominations()).resolves.toEqual({ round: null, nominations: [], votesLeft: 3, votesPerMember: 3 });
  });
});
