import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import { createSessionToken } from '../server/session';

const opened: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function assembled(ready: boolean) {
  const db = createDatabase({ members: [{ id: 'test:alice', displayName: 'Alice', groupId: 'G' }] }); opened.push(db);
  const secret = 'remote-isolated-test-secret';
  const api = createApiHandler({ db, authMode: 'google-only', sessionSecret: secret, productionGoogleAuth: { verify: async () => { throw new Error('No real Google auth'); }, resolveMember: async () => null }, remoteReminderStatus: ready ? 'REMOTE_READY' : 'REMOTE_PENDING' } as Parameters<typeof createApiHandler>[0]);
  const headers = { authorization: `Bearer ${createSessionToken('test:alice', secret)}`, 'x-qingmu-member-id': 'test:alice' };
  return { db, api, headers };
}
describe('remote boundary on the deployed preferences baseline', () => {
  it('reports the same configured readiness after both GET and PUT', async () => {
    const { api, headers } = assembled(true);
    expect(await api({ method: 'GET', url: '/api/me/reminders', headers })).toMatchObject({ status: 200, body: { remoteDeliveryStatus: 'REMOTE_READY' } });
    expect(await api({ method: 'PUT', url: '/api/me/reminders', headers, body: JSON.stringify({ reading_enabled: true, meeting_enabled: true }) })).toMatchObject({ status: 200, body: { remoteDeliveryStatus: 'REMOTE_READY' } });
  });
  it('keeps missing configuration pending after saving preferences', async () => {
    const { api, headers } = assembled(false);
    expect(await api({ method: 'PUT', url: '/api/me/reminders', headers, body: JSON.stringify({ reading_enabled: true, meeting_enabled: true }) })).toMatchObject({ body: { remoteDeliveryStatus: 'REMOTE_PENDING' } });
  });
  it('adds nullable meeting authority and a delivery ledger to the baseline schema', () => {
    const { db } = assembled(false);
    const columns = db.db.prepare('PRAGMA table_info(member_group_profiles)').all().map(row => row.name);
    expect(columns).toEqual(expect.arrayContaining(['meeting_id', 'meeting_title', 'starts_at', 'time_zone', 'schedule_revision', 'schedule_status', 'last_updated_at', 'schedule_source_ref']));
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminder_deliveries'").get()).toBeTruthy();
  });
  it('has an independent device validation boundary without accepting an interactive session as a device', async () => {
    const { api, headers } = assembled(false);
    expect(await api({ method: 'POST', url: '/api/device/reminders/validate', headers, body: JSON.stringify({ meeting_id: 'test:m', schedule_revision: 1 }) })).toMatchObject({ status: 401, body: { error: 'DEVICE_DELIVERY_AUTH_REQUIRED' } });
  });
});
