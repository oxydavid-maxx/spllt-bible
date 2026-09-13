import { describe, expect, it } from 'vitest';

import { createApiClient } from '../../src/services/apiClient';

describe('reminder API client contract', () => {
  it('uses the authenticated member boundary for preference and token lifecycle', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = createApiClient({
      baseUrl: 'https://example.test',
      token: 'session',
      memberId: 'member:one',
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
        if (String(input).endsWith('/api/me/reminders')) return new Response(JSON.stringify({ memberId: 'member:one', readingEnabled: true, meetingEnabled: false, remoteDeliveryStatus: 'REMOTE_PENDING', meetings: [] }), { status: 200 });
        return new Response(JSON.stringify({ registered: true, revoked: true }), { status: 200 });
      },
    });
    await expect(client.getReminderSnapshot()).resolves.toMatchObject({ memberId: 'member:one', remoteDeliveryStatus: 'REMOTE_PENDING' });
    await expect(client.saveReminderPreferences({ readingEnabled: true, meetingEnabled: false })).resolves.toMatchObject({ readingEnabled: true });
    await expect(client.registerReminderDeviceToken({ installationId: 'install-one', token: 'device-token' })).resolves.toBe(true);
    await expect(client.revokeReminderDeviceToken('install-one')).resolves.toBe(true);
    expect(requests.map((request) => request.method)).toEqual(['GET', 'PUT', 'POST', 'POST']);
    expect(requests.every((request) => request.url.includes('/api/me/reminders'))).toBe(true);
    expect(requests[1].body).toContain('reading_enabled');
  });
});
