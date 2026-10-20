import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));
import { createGamificationApiClient, GamificationApiError } from '../../src/services/gamificationApiClient';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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

  // Redemptions are recorded in the Google Sheet (維護者 2026-10-17); the app only reads the member's own.
  it('loads the member\'s own redemption records', async () => {
    const row = { redemptionId: 'r1', memberId: 'member:1', rewardId: 'reward-1', rewardName: '飲料', costPoints: 2, status: 'COMPLETED', confirmedAt: 10 };
    const fetchImpl = vi.fn(async (url: string) => response({ redemptions: [row] }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member:1', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getMyRedemptions()).resolves.toEqual([row]);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['https://example.test/api/me/redemptions']);
  });

  // 選目標獎品 (維護者 2026-10-20): the other side's list is asked for by name, and only a server that says it
  // answered that side is believed (an older one ignores the question and sends the member's own list).
  it('asks for one side’s prizes and refuses a list from the wrong side', async () => {
    const reward = { rewardId: 'sheet-youth-1', name: '電影票', costPoints: 75, active: true, revision: 1 };
    const fetchImpl = vi.fn(async (url: string) => response(url.endsWith('congregation=youth') ? { congregation: 'youth', rewards: [reward] } : { rewards: [reward] }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'member:1', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getRewards('youth')).resolves.toEqual([reward]);
    await expect(client.getRewards()).resolves.toEqual([reward]);
    await expect(client.getRewards('main')).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['https://example.test/api/rewards?congregation=youth', 'https://example.test/api/rewards', 'https://example.test/api/rewards?congregation=main']);
  });

  it('keeps the side each person counts in on the 全體 list, and nothing else', async () => {
    const fetchImpl = vi.fn(async () => response({ scope: 'all', people: [{ memberId: 'a', displayName: '甲', earnedTotal: 3, rank: 1, congregation: 'main' }, { memberId: 'b', displayName: '乙', earnedTotal: 1, rank: 2, congregation: 'elsewhere' }, { memberId: 'c', displayName: '丙', earnedTotal: 0, rank: null }] }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 't', memberId: 'a', fetchImpl: fetchImpl as unknown as typeof fetch });
    const people = await client.getPeople('all');
    expect(people.map((person) => person.congregation)).toEqual(['main', undefined, undefined]);
    expect(people[1]).not.toHaveProperty('congregation');
  });
});
