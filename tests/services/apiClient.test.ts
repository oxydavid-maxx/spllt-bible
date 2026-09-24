import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/services/apiClient';
import * as authState from '../../src/services/authState';

describe('session onboarding client', () => {
  it('keeps unknown Google identities out until an invite claim succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'UNKNOWN_MEMBER' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionToken: 'signed-session', memberId: 'member:one', expiresInSeconds: 3600 }), { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: '', memberId: '', fetchImpl });

    await expect(client.establishSession('google-id-token')).resolves.toMatchObject({ status: 403, error: 'UNKNOWN_MEMBER' });
    await expect(client.claimInvite('google-id-token', 'invite-code')).resolves.toMatchObject({ sessionToken: 'signed-session', memberId: 'member:one' });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://api.example.test/api/onboarding/claim', expect.objectContaining({ method: 'POST', body: JSON.stringify({ invite_code: 'invite-code' }) }));
  });

  it('classifies a valid revision conflict without defaulting missing fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'REVISION_CONFLICT', revision: 5, status: 'COMPLETED' }), { status: 409 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl });
    await expect(client.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-1', expectedRevision: 2, syncStatus: 'PENDING_SAVE',
    })).resolves.toMatchObject({ ok: false, conflict: true, error: 'REVISION_CONFLICT', revision: 5, status: 'COMPLETED' });
  });

  it('preserves pointsDelta and wallet totals from a confirmed completion response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', operationId: 'op-award',
      status: 'COMPLETED', revision: 3, syncStatus: 'CONFIRMED', pointsDelta: 2, earnedTotal: 14, redeemableBalance: 9,
    }), { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl });
    await expect(client.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-award', expectedRevision: 2, syncStatus: 'PENDING_SAVE',
    })).resolves.toMatchObject({ ok: true, operationId: 'op-award', pointsDelta: 2, earnedTotal: 14, redeemableBalance: 9 });
  });

  it('accepts an old successful completion response without guessing a points delta', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', operationId: 'op-old-server',
      status: 'COMPLETED', revision: 1, syncStatus: 'CONFIRMED', earnedTotal: 10, redeemableBalance: 10,
    }), { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl });
    const result = await client.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-old-server', expectedRevision: 0, syncStatus: 'PENDING_SAVE',
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result).not.toHaveProperty('pointsDelta');
  });

  it('classifies an authoritative stale operation replay so the repository may rotate it explicitly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'OPERATION_REPLAY_STALE', revision: 5, status: 'NOT_COMPLETED' }), { status: 409 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl });
    await expect(client.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-stale', expectedRevision: 2, syncStatus: 'PENDING_SAVE',
    })).resolves.toMatchObject({ ok: false, conflict: true, error: 'OPERATION_REPLAY_STALE', revision: 5, status: 'NOT_COMPLETED' });
  });

  it('does not treat malformed conflicts or mismatched successful bodies as confirmation', async () => {
    const malformed = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'REVISION_CONFLICT' }), { status: 409 }));
    const malformedClient = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl: malformed });
    await expect(malformedClient.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-malformed', expectedRevision: 2, syncStatus: 'PENDING_SAVE',
    })).resolves.toMatchObject({ ok: false, error: 'INVALID_API_RESPONSE' });

    const mismatched = vi.fn().mockResolvedValue(new Response(JSON.stringify({ memberId: 'other', planId: 'church-2026-09', taskDate: '2026-09-08', status: 'COMPLETED', revision: 3, operationId: 'op-mismatch' }), { status: 200 }));
    const mismatchedClient = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl: mismatched });
    await expect(mismatchedClient.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-mismatch', expectedRevision: 2, syncStatus: 'PENDING_SAVE',
    })).resolves.toMatchObject({ ok: false, error: 'INVALID_API_RESPONSE' });
  });

  it('publishes expired to the mounted auth snapshot on an authenticated 401', async () => {
    const expiry = vi.spyOn(authState, 'notifyAuthExpired');
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'google:self', fetchImpl: async () => new Response('{}', { status: 401 }) });
    await expect(client.getProgress('2026-09-08')).resolves.toBeNull();
    expect(expiry).toHaveBeenCalledTimes(1);
  });

  it('parses the authenticated reading-day schedule with the server completion window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      today: '2026-09-14', timezone: 'Asia/Taipei',
      days: [{ taskDate: '2026-10-01', planId: 'church-2026-10', references: ['REV.1'], sourceRevision: 2, sourceDigest: 'digest', status: 'UNREPORTED', revision: 0, canComplete: false }],
    }), { status: 200 }));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: 'token', memberId: 'member:one', fetchImpl });
    await expect(client.getReadingDays('2026-09-14', '2026-10-01')).resolves.toMatchObject({ days: [{ taskDate: '2026-10-01', planId: 'church-2026-10', canComplete: false }] });
  });
});
