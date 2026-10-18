import { describe, expect, it, vi } from 'vitest';
const cache = vi.hoisted(() => ({ saveDays: vi.fn(async () => undefined), saveDevotions: vi.fn(async () => undefined), setDevotion: vi.fn(async () => undefined) }));
vi.mock('../../src/services/readingProgressCache', () => ({ readingProgressCache: cache }));
import { createApiClient } from '../../src/services/apiClient';
import { createDevotionClient } from '../../src/services/devotionClient';

describe('local progress cache at the response producers', () => {
  it('saves only validated reading-day responses under the requesting member', async () => {
    const body = { today: '2026-10-18', timezone: 'Asia/Taipei', days: [{ taskDate: '2026-10-01', planId: 'p', references: ['JAS.1'], sourceRevision: 1, sourceDigest: 'd', status: 'COMPLETED', revision: 1, canComplete: false }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://fixture.invalid', token: 'fixture', memberId: 'fixture:one', fetchImpl });
    await client.getReadingDays('2026-10-01', '2026-10-31');
    expect(cache.saveDays).toHaveBeenCalledWith('fixture:one', '2026-10-01', '2026-10-31', body.days);
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ ...body, days: [{}] })));
    expect(await client.getReadingDays('2026-10-01', '2026-10-31')).toBeNull();
    expect(cache.saveDays).toHaveBeenCalledTimes(1);
  });
  it('caches devotion fetches, completions and undo after success only', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ dates: ['2026-10-01'] }), { status: 200 }));
    const client = createDevotionClient({ baseUrl: 'https://fixture.invalid', token: 'fixture', memberId: 'fixture:one', fetchImpl });
    await client.getDevotionDates('2026-10-01', '2026-10-31');
    expect(cache.saveDevotions).toHaveBeenCalledWith('fixture:one', '2026-10-01', '2026-10-31', ['2026-10-01']);
    await client.setDevotion('2026-10-01', true);
    await client.setDevotion('2026-10-01', false);
    expect(cache.setDevotion.mock.calls).toEqual([['fixture:one', '2026-10-01', true], ['fixture:one', '2026-10-01', false]]);
    fetchImpl.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(client.setDevotion('2026-10-01', true)).rejects.toThrow();
    expect(cache.setDevotion).toHaveBeenCalledTimes(2);
  });
});
