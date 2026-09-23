import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../server/db';
import { seedMemberGroupProfile } from '../../server/groups';
import { createReminderWorker } from '../../server/reminderWorker';

describe('configured reminder worker', () => {
  it('discovers and sends due events through the normal worker tick with fake clock, without a due HTTP dispatch', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '小明', groupId: 'G01' }] });
    const due = new Date('2030-09-12T11:00:00.000Z');
    seedMemberGroupProfile(database.db, { memberId: 'member:one', groupId: 'G01', groupName: '合成小組', rpgId: 'RPG1', rpgName: '合成RPG', linkStatus: 'READY', meetingId: 'm1', meetingTitle: '合成聚會', startsAt: due.toISOString(), scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
    database.db.prepare('UPDATE member_group_profiles SET schedule_source_ref = ? WHERE member_id = ?').run('test:discovered', 'member:one');
    database.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run('member:one', due.toISOString());
    database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install-one', 'member:one', 'ANDROID', 'device-token', due.toISOString(), due.toISOString());
    const sent: unknown[] = [];
    const fakeTimer = { handlers: [] as Array<() => void | Promise<void>>, setInterval(handler: () => void | Promise<void>) { this.handlers.push(handler); return handler; }, clearInterval() {} };
    const worker = createReminderWorker({ db: database.db, now: () => due, intervalMs: 1000, timer: fakeTimer, send: async (_token, payload) => { sent.push(payload); return { messageId: 'test-message-id' }; } });
    worker.start();
    await fakeTimer.handlers[0]();
    expect(sent).toEqual([{ event: 'MEETING_REMINDER', reminderId: 'meeting:m1:1', meetingId: 'm1', scheduleRevision: 1 }]);
    expect(database.db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id = ?').get('member:one:meeting:m1:1')).toMatchObject({ status: 'SENT' });
    await fakeTimer.handlers[0]();
    expect(sent).toHaveLength(1);
    worker.stop();
    database.close();
  });

  it('sends once per authorized recipient for the same meeting revision and treats an ambiguous provider result as reconcile-only', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '甲', groupId: 'G01' }, { id: 'member:two', displayName: '乙', groupId: 'G01' }] });
    const due = new Date('2030-09-12T11:00:00.000Z');
    for (const memberId of ['member:one', 'member:two']) {
      seedMemberGroupProfile(database.db, { memberId, groupId: 'G01', groupName: '合成小組', rpgId: 'RPG1', rpgName: '合成RPG', linkStatus: 'READY', meetingId: 'm1', meetingTitle: '合成聚會', startsAt: due.toISOString(), scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
      database.db.prepare('UPDATE member_group_profiles SET schedule_source_ref = ? WHERE member_id = ?').run('test:authorized-recipients', memberId);
      database.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run(memberId, due.toISOString());
      database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(`install-${memberId}`, memberId, 'ANDROID', `token-${memberId}`, due.toISOString(), due.toISOString());
    }
    const sent: string[] = [];
    const worker = createReminderWorker({ db: database.db, now: () => due, timer: { setInterval: () => 1, clearInterval: () => undefined }, send: async (token) => { sent.push(token); return { messageId: `msg-${token}` }; } });
    await worker.tick();
    await worker.tick();
    expect(sent).toEqual(['token-member:one', 'token-member:two']);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM reminder_deliveries WHERE status = ?').get('SENT')).toMatchObject({ count: 2 });

    const db2 = createDatabase({ members: [{ id: 'member:three', displayName: '丙', groupId: 'G02' }] });
    seedMemberGroupProfile(db2.db, { memberId: 'member:three', groupId: 'G02', groupName: '合成小組2', rpgId: 'RPG2', rpgName: '合成RPG2', linkStatus: 'READY', meetingId: 'm2', meetingTitle: '合成聚會2', startsAt: due.toISOString(), scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
    db2.db.prepare('UPDATE member_group_profiles SET schedule_source_ref = ? WHERE member_id = ?').run('test:ambiguous-provider', 'member:three');
    db2.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run('member:three', due.toISOString());
    db2.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install-three', 'member:three', 'ANDROID', 'token-three', due.toISOString(), due.toISOString());
    let ambiguousAttempts = 0;
    const ambiguous = createReminderWorker({ db: db2.db, now: () => due, timer: { setInterval: () => 1, clearInterval: () => undefined }, send: async () => { ambiguousAttempts += 1; throw new Error('provider-timeout-after-accept'); } });
    await ambiguous.tick();
    expect(db2.db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id = ?').get('member:three:meeting:m2:1')).toMatchObject({ status: 'UNKNOWN' });
    await ambiguous.tick();
    expect(ambiguousAttempts).toBe(1);
    expect(database.db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id = ?').get('member:one:meeting:m1:1')).toMatchObject({ status: 'SENT' });
    db2.close();
    database.close();
  });
});
