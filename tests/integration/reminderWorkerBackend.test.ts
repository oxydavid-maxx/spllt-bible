import { describe, expect, it } from 'vitest';

import { createHttpServer } from '../../server/http';
import { seedMemberGroupProfile } from '../../server/groups';

describe('configured backend reminder path', () => {
  it('starts the normal backend worker path and sends at due time through the injected transport', async () => {
    const now = new Date('2030-09-12T11:00:00.000Z');
    const sent: unknown[] = [];
    const fakeTimer = { handlers: [] as Array<() => void | Promise<void>>, setInterval(handler: () => void | Promise<void>) { this.handlers.push(handler); return handler; }, clearInterval() {} };
    const backend = createHttpServer({
      fixtureToken: 'fixture-token',
      reminderDelivery: { enabled: true, send: async (_token, payload) => { sent.push(payload); return { messageId: 'synthetic-fcm-ack' }; } },
      reminderWorker: { autostart: true, now: () => now, timer: fakeTimer },
    });
    seedMemberGroupProfile(backend.database.db, { memberId: 'fixture:self', groupId: 'G01', groupName: '合成小組', rpgId: 'RPG1', rpgName: '合成RPG', linkStatus: 'READY', meetingId: 'm1', meetingTitle: '合成聚會', startsAt: now.toISOString(), scheduleRevision: 1, scheduleStatus: 'SCHEDULED', timeZone: 'Asia/Taipei' });
    backend.database.db.prepare('INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, meeting_advance_minutes, updated_at) VALUES (?, 0, 1, 0, ?)').run('fixture:self', now.toISOString());
    backend.database.db.prepare('INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run('install', 'fixture:self', 'ANDROID', 'token', now.toISOString(), now.toISOString());
    backend.database.db.prepare('UPDATE member_group_profiles SET schedule_source_ref = ? WHERE member_id = ?').run('test:normal-worker', 'fixture:self');
    expect(backend.worker).not.toBeNull();
    await fakeTimer.handlers[0]();
    expect(sent).toEqual([{ event: 'MEETING_REMINDER', reminderId: 'meeting:m1:1', meetingId: 'm1', scheduleRevision: 1 }]);
    backend.server.close();
  });
});
