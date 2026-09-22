import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpServer } from '../../server/http';
import { seedMemberGroupProfile } from '../../server/groups';

/**
 * Run 5 (2026-09-10) recorded provider_message_id = NULL for a delivery the FCM API had
 * accepted. The cause was in server/http.ts: the reminderDelivery adapter awaited
 * fcmSender.send(...) and DISCARDED its result, so sendDueMeetingEvent always computed a null
 * message id. That made a real acknowledged send indistinguishable in the data from an
 * unacknowledged one, and it removed the only server-side handle for reconciling a delivery
 * against the provider.
 *
 * The earlier tests all INJECTED options.reminderDelivery, which bypasses that adapter
 * entirely, which is why the defect survived them. This test deliberately does NOT inject it,
 * so the real env-constructed adapter is the thing under test. Type correctness is not
 * accepted as proof of this outcome.
 */
describe('FCM provider message id survives the configured delivery adapter', () => {
  it('records the FCM message name in reminder_deliveries.provider_message_id', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'qingmu-fcm-cred-'));
    const credentialPath = join(dir, 'service-account.json');
    // Locally generated throwaway key. Not a real credential and never leaves this test.
    writeFileSync(credentialPath, JSON.stringify({ client_email: 'qa-tester@example.invalid', private_key: privateKey, token_uri: 'https://oauth.invalid/token' }), 'utf8');

    const EXPECTED_MESSAGE_NAME = 'projects/qingmu-youth-test-20260908/messages/0:1757480000000000%abcdef';
    const fcmRequests: Array<{ url: string; body: string }> = [];

    // Both createFcmSender and the access-token provider capture `fetch` when they are built,
    // so the stub has to be in place before createHttpServer runs.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth.invalid/token') {
        return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/messages:send')) {
        fcmRequests.push({ url, body: String(init?.body) });
        return new Response(JSON.stringify({ name: EXPECTED_MESSAGE_NAME }), { status: 200 });
      }
      throw new Error(`UNEXPECTED_FETCH:${url}`);
    });
    vi.stubEnv('QINGMU_FCM_PROJECT_ID', 'qingmu-youth-test-20260908');
    vi.stubEnv('QINGMU_REMINDER_WORKER_TOKEN', 'worker-token-for-test');
    vi.stubEnv('QINGMU_FCM_CREDENTIAL_FILE', credentialPath);

    const now = new Date('2030-09-12T11:00:00.000Z');
    const fakeTimer = { handlers: [] as Array<() => void | Promise<void>>, setInterval(handler: () => void | Promise<void>) { this.handlers.push(handler); return handler; }, clearInterval() {} };

    // NOTE: no reminderDelivery passed. That is the whole point of this test.
    const backend = createHttpServer({
      fixtureToken: 'fixture-token',
      reminderWorker: { autostart: true, now: () => now, timer: fakeTimer },
    });

    try {
      expect(backend.worker).not.toBeNull();
      seedMemberGroupProfile(backend.database.db, { memberId: 'fixture:self', groupId: 'G01', groupName: '合成小組', rpgId: 'RPG1', rpgName: '合成RPG', linkStatus: 'READY', meetingId: 'm1', meetingTitle: '合成聚會', startsAt: now.toISOString(), scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
      backend.database.db.prepare('UPDATE member_group_profiles SET schedule_source_ref = ? WHERE member_id = ?').run('test:configured-fcm-worker', 'fixture:self');
      backend.database.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run('fixture:self', now.toISOString());
      backend.database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install', 'fixture:self', 'ANDROID', 'device-token', now.toISOString(), now.toISOString());

      await fakeTimer.handlers[0]();

      // The send really went out through the configured adapter.
      expect(fcmRequests).toHaveLength(1);
      const sentBody = JSON.parse(fcmRequests[0].body) as { message: { token: string; notification?: unknown; data: Record<string, string> } };
      expect(sentBody.message.token).toBe('device-token');
      expect(sentBody.message.notification).toBeUndefined();
      expect(sentBody.message.data.reminderId).toBe('meeting:m1:1');

      // The outcome that run 5 lost: the provider's message name is persisted.
      const row = backend.database.db.prepare('SELECT status, provider_message_id FROM reminder_deliveries WHERE delivery_id = ?').get('fixture:self:meeting:m1:1') as { status: string; provider_message_id: string | null } | undefined;
      expect(row?.status).toBe('SENT');
      expect(row?.provider_message_id).toBe(EXPECTED_MESSAGE_NAME);
    } finally {
      await backend.stop();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
