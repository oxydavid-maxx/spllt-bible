import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/services/apiClient';
const expired = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/authState', () => ({ notifyAuthExpired: expired }));
afterEach(() => vi.unstubAllGlobals());
it('works with React Native AbortSignal, which has no static timeout', async () => {
  vi.stubGlobal('AbortSignal', {});
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nonce: 'challenge' })));
  expect(await createApiClient({ baseUrl: 'https://fixture.invalid', token: '', memberId: '', fetchImpl }).appleChallenge()).toBe('challenge');
});
describe('account transport', () => {
  it('invalidates only the attempted credential if the deletion response was lost and retry returns 401', async () => {
    expired.mockClear();
    const fetchImpl = vi.fn(async () => new Response('{"error":"AUTH_INVALID"}', { status: 401 }));
    await expect(createApiClient({ baseUrl: 'https://fixture.invalid', token: 'old-token', memberId: 'old-member', fetchImpl }).deleteAccount()).rejects.toThrow();
    expect(expired).toHaveBeenCalledWith({ memberId: 'old-member', sessionToken: 'old-token' });
  });
  it('sends the exact credential, not a client-selected member id, and requires a deletion receipt', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ deleted: true })));
    const client = createApiClient({ baseUrl: 'https://fixture.invalid', token: 'synthetic', memberId: 'untrusted-id', fetchImpl });
    expect(await client.deleteAccount()).toBe(true);
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://fixture.invalid/api/me'); expect(request.method).toBe('DELETE');
    expect(request.body).toBe('{"confirmed":true}');
    expect(request.headers).toMatchObject({ authorization: 'Bearer synthetic' });
  });
});
