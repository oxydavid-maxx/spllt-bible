import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../server/db';
import { seedMemberGroupProfile } from '../../server/groups';
import { createApiHandler } from '../../server/routes';
import { registerDeviceDeliveryToken, revokeDeviceDeliveryToken } from '../../server/reminders';

function auth(memberId: string) {
  return { authorization: 'Bearer fixture-token', 'x-qingmu-member-id': memberId };
}

describe('reminder preferences and due-time authority', () => {
  it('uses owner generation and binding version to reject stale same-token revoke/register races', () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '甲', groupId: 'G' }, { id: 'member:two', displayName: '乙', groupId: 'G' }] });
    const old = registerDeviceDeliveryToken(database.db, { memberId: 'member:one', installationId: 'install-shared', platform: 'ANDROID', token: 'same-token', ownerGeneration: 1 });
    const next = registerDeviceDeliveryToken(database.db, { memberId: 'member:two', installationId: 'install-shared', platform: 'ANDROID', token: 'same-token', ownerGeneration: 2 });
    expect(next.bindingVersion).toBeGreaterThan(old.bindingVersion);
    expect(revokeDeviceDeliveryToken(database.db, 'member:one', 'install-shared', old.bindingVersion, 1)).toBe(false);
    expect(database.db.prepare('SELECT member_id, revoked_at FROM device_delivery_tokens WHERE installation_id = ?').get('install-shared')).toMatchObject({ member_id: 'member:two', revoked_at: null });
    database.close();
  });
  it('keeps opt-in/member token state isolated and marks external delivery pending when unconfigured', async () => {
    const database = createDatabase({
      members: [
        { id: 'member:one', displayName: '小明', groupId: 'G01' },
        { id: 'member:two', displayName: '同工乙', groupId: 'G02' },
      ],
    });
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token' });
    const save = await api({ method: 'PUT', url: '/api/me/reminders', headers: auth('member:one'), body: JSON.stringify({ reading_enabled: true, meeting_enabled: true, reading_time: '07:45', meeting_advance_minutes: 15 }) });
    expect(save).toMatchObject({ status: 200, body: { memberId: 'member:one', readingEnabled: true, meetingEnabled: true, readingTime: '07:45', meetingAdvanceMinutes: 15, remoteDeliveryStatus: 'REMOTE_PENDING' } });
    const reopened = await api({ method: 'GET', url: '/api/me/reminders', headers: auth('member:one') });
    expect(reopened).toMatchObject({ status: 200, body: { readingTime: '07:45', meetingAdvanceMinutes: 15 } });
    const registerOne = await api({ method: 'POST', url: '/api/me/reminders/device-token', headers: auth('member:one'), body: JSON.stringify({ installation_id: 'install-one', token: 'token-one', platform: 'ANDROID' }) });
    const registerTwo = await api({ method: 'POST', url: '/api/me/reminders/device-token', headers: auth('member:two'), body: JSON.stringify({ installation_id: 'install-two', token: 'token-two', platform: 'ANDROID' }) });
    expect(registerOne).toMatchObject({ status: 200, body: { registered: true } });
    expect(registerTwo).toMatchObject({ status: 200, body: { registered: true } });
    const revoked = await api({ method: 'POST', url: '/api/me/reminders/device-token/revoke', headers: auth('member:one'), body: JSON.stringify({ installation_id: 'install-one' }) });
    expect(revoked).toMatchObject({ status: 200, body: { revoked: true } });
    expect(database.db.prepare('SELECT member_id, revoked_at FROM device_delivery_tokens ORDER BY installation_id').all()).toMatchObject([
      { member_id: 'member:one' },
      { member_id: 'member:two', revoked_at: null },
    ]);
    const unauthenticated = await api({ method: 'GET', url: '/api/me/reminders', headers: {} });
    expect(unauthenticated.status).toBe(401);
    database.close();
  });

  it('rechecks latest meeting revision/status at due time and can send after interactive session expiry', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '小明', groupId: 'G01' }] });
    const triggerAt = new Date(Date.now() - 1_000).toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    seedMemberGroupProfile(database.db, {
      memberId: 'member:one', groupId: 'G01', groupName: 'A小組', rpgId: 'RPG1', rpgName: 'A-RPG',
      linkStatus: 'READY', meetingId: 'meeting-1', meetingTitle: '本週聚會', startsAt: triggerAt, scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei',
    });
    database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install-one', 'member:one', 'ANDROID', 'device-token', triggerAt, triggerAt);
    database.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run('member:one', triggerAt);
    const sent: Array<Record<string, unknown>> = [];
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token', reminderDelivery: { workerToken: 'worker-secret', enabled: true, send: async (_token, payload) => { sent.push(payload); } } });
    const deviceValidation = await api({ method: 'POST', url: '/api/device/reminders/validate', headers: { 'x-qingmu-installation-id': 'install-one', 'x-qingmu-device-token': 'device-token' }, body: JSON.stringify({ meeting_id: 'meeting-1', schedule_revision: 1 }) });
    expect(deviceValidation).toMatchObject({ status: 200, body: { valid: true, meetingId: 'meeting-1', scheduleRevision: 1, status: 'SCHEDULED' } });
    const response = await api({ method: 'POST', url: '/internal/reminders/due', headers: { 'x-qingmu-reminder-worker': 'worker-secret' }, body: JSON.stringify({ reminder_id: 'meeting:meeting-1:1', member_id: 'member:one', meeting_id: 'meeting-1', schedule_revision: 1, trigger_at: triggerAt, expires_at: expiresAt }) });
    expect(response).toMatchObject({ status: 200, body: { decision: 'SEND', reminderId: 'meeting:meeting-1:1', meetingId: 'meeting-1', scheduleRevision: 1 } });
    expect(sent).toEqual([{ event: 'MEETING_REMINDER', reminderId: 'meeting:meeting-1:1', meetingId: 'meeting-1', scheduleRevision: 1 }]);

    seedMemberGroupProfile(database.db, {
      memberId: 'member:one', groupId: 'G01', groupName: 'A小組', rpgId: 'RPG1', rpgName: 'A-RPG',
      linkStatus: 'READY', meetingId: 'meeting-1', meetingTitle: '本週聚會', startsAt: triggerAt, scheduleRevision: 2, scheduleStatus: 'CANCELLED', timeZone: 'Asia/Taipei',
    });
    const stale = await api({ method: 'POST', url: '/internal/reminders/due', headers: { 'x-qingmu-reminder-worker': 'worker-secret' }, body: JSON.stringify({ reminder_id: 'meeting:meeting-1:old', member_id: 'member:one', meeting_id: 'meeting-1', schedule_revision: 1, trigger_at: triggerAt, expires_at: expiresAt }) });
    expect(stale).toMatchObject({ status: 200, body: { decision: 'DROP_CANCELLED', latestRevision: 2, latestStatus: 'CANCELLED' } });
    const cancelledValidation = await api({ method: 'POST', url: '/api/device/reminders/validate', headers: { 'x-qingmu-installation-id': 'install-one', 'x-qingmu-device-token': 'device-token' }, body: JSON.stringify({ meeting_id: 'meeting-1', schedule_revision: 1 }) });
    expect(cancelledValidation).toMatchObject({ status: 200, body: { valid: false, scheduleRevision: 2, status: 'CANCELLED' } });
    expect(sent).toHaveLength(1);
    database.close();
  });

  it('does not disclose another member meeting state through device validation', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '甲', groupId: 'G01' }, { id: 'member:two', displayName: '乙', groupId: 'G02' }] });
    seedMemberGroupProfile(database.db, { memberId: 'member:two', groupId: 'G02', groupName: '另一組', rpgId: 'RPG2', rpgName: '另一RPG', linkStatus: 'READY', meetingId: 'private-meeting', meetingTitle: '另一場', startsAt: '2030-09-12T11:00:00.000Z', scheduleRevision: 7, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
    database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install-one', 'member:one', 'ANDROID', 'token-one', '2030-09-12T00:00:00Z', '2030-09-12T00:00:00Z');
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token' });
    const response = await api({ method: 'POST', url: '/api/device/reminders/validate', headers: { 'x-qingmu-installation-id': 'install-one', 'x-qingmu-device-token': 'token-one' }, body: JSON.stringify({ meeting_id: 'private-meeting', schedule_revision: 7 }) });
    expect(response).toMatchObject({ status: 403, body: { error: 'DEVICE_DELIVERY_REVOKED' } });
    database.close();
  });
});
