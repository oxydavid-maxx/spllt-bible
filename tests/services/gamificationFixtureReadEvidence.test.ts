import { afterEach, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined }));
import { createGamificationApiClient } from '../../src/services/gamificationApiClient';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['true', 'false'])('emits only a bounded error classification in fixture=%s', async (fixture) => {
  vi.stubEnv('EXPO_PUBLIC_QINGMU_FIXTURE', fixture);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', memberId: 'private-member', token: 'private-token', fetchImpl: vi.fn(async () => { throw Error('private-provider-detail'); }) });
  await expect(client.getRewards()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(error.mock.calls).toEqual(fixture === 'true' ? [['CI_GAMIFICATION_READ_ERROR', { operation: 'OTHER_READ', code: 'NETWORK_ERROR', status: 0 }]] : []);
});

it('records the actual score read deadline without extending it or logging the member ID', async () => {
  vi.useFakeTimers(); vi.stubEnv('EXPO_PUBLIC_QINGMU_FIXTURE', 'true');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', memberId: 'private-member', token: 'private-token', fetchImpl: vi.fn(() => new Promise<Response>(() => {})) });
  const result = client.getProfile('private-member', 'me', '2026-10').catch(reason => reason);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ code: 'READ_TIMEOUT' });
  expect(error.mock.calls).toEqual([['CI_GAMIFICATION_READ_ERROR', { operation: 'SCORE_PROFILE', code: 'READ_TIMEOUT', status: 0 }]]);
});

it('does not treat an arbitrary uppercase provider string as a safe error code', async () => {
  vi.stubEnv('EXPO_PUBLIC_QINGMU_FIXTURE', 'true');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', memberId: 'private-member', token: 'private-token', fetchImpl: vi.fn(async () => new Response('{"error":"PRIVATE-MEMBER-IDENTIFIER"}', { status: 500 })) });
  await expect(client.getRewards()).rejects.toMatchObject({ status: 500 });
  expect(error.mock.calls).toEqual([['CI_GAMIFICATION_READ_ERROR', { operation: 'OTHER_READ', code: 'OTHER_API_ERROR', status: 500 }]]);
});
