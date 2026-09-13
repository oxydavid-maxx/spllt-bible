import { describe, expect, it } from 'vitest';

import { buildNextReadingReminderSpec, buildUpcomingReadingReminderSpecs, createReminderScheduler, type ReminderNotificationAdapter, type ReminderSpec } from '../../src/services/reminderScheduler';

function spec(overrides: Partial<ReminderSpec> = {}): ReminderSpec {
  return {
    reminderId: 'reading:member:one:2026-09-12',
    memberId: 'member:one',
    kind: 'READING',
    targetId: 'church-2026-09',
    taskDate: '2026-09-12',
    scheduleRevision: 0,
    triggerAt: '2026-09-12T08:00:00+08:00',
    route: '/today?date=2026-09-12',
    status: 'ACTIVE',
    ...overrides,
  };
}

function fakeAdapter(initial: Array<Record<string, unknown>> = [], granted = true) {
  const scheduled = initial as any[];
  const calls = { schedule: 0, cancel: [] as string[] };
  const adapter: ReminderNotificationAdapter = {
    getPermissionsAsync: async () => ({ granted, canAskAgain: !granted, expires: 'never', status: granted ? 'granted' : 'denied' } as any),
    requestPermissionsAsync: async () => ({ granted, canAskAgain: false, expires: 'never', status: granted ? 'granted' : 'denied' } as any),
    scheduleNotificationAsync: async (request) => { calls.schedule += 1; const identifier = `native-${calls.schedule}`; scheduled.push({ identifier, content: request.content, trigger: request.trigger }); return identifier; },
    cancelScheduledNotificationAsync: async (identifier) => { calls.cancel.push(identifier); const index = scheduled.findIndex((item) => item.identifier === identifier); if (index >= 0) scheduled.splice(index, 1); },
    getAllScheduledNotificationsAsync: async () => scheduled,
    setNotificationChannelAsync: async () => null,
  };
  return { adapter, calls, scheduled };
}

describe('local reminder scheduler', () => {
  it('selects the next canonical scheduled date in Asia/Taipei for the chosen daily time', () => {
    expect(buildNextReadingReminderSpec('member:one', '07:45', new Date('2026-09-11T23:00:00.000Z'))).toMatchObject({ reminderId: 'reading:member:one:2026-09-12', taskDate: '2026-09-12', route: '/today?date=2026-09-12' });
  });

  it('returns every future canonical task date without past, duplicate, or non-canonical reminders', () => {
    const specs = buildUpcomingReadingReminderSpecs('member:one', '07:45', new Date('2026-09-09T00:00:00.000Z'));
    expect(specs.length).toBeGreaterThan(1);
    expect(new Set(specs.map((item) => item.reminderId)).size).toBe(specs.length);
    expect(specs.every((item) => item.memberId === 'member:one' && item.taskDate && item.taskDate >= '2026-09-09' && item.triggerAt > '2026-09-09T00:00:00.000Z')).toBe(true);
    expect(specs.map((item) => item.taskDate)).toEqual(specs.map((item) => item.taskDate).slice().sort());
  });

  it('makes reading opt-in idempotent and cancels by stable reminder id', async () => {
    const fake = fakeAdapter();
    const scheduler = createReminderScheduler(fake.adapter);
    await scheduler.schedule(spec());
    await scheduler.schedule(spec());
    expect(fake.calls.schedule).toBe(2);
    expect(fake.calls.cancel).toEqual(['native-1']);
    expect((await scheduler.list()).map((item) => item.reminderId)).toEqual([spec().reminderId]);
    await scheduler.cancel(spec().reminderId);
    expect(await scheduler.list()).toEqual([]);
  });

  it('leaves the app usable when notification permission is denied', async () => {
    const fake = fakeAdapter([], false);
    const scheduler = createReminderScheduler(fake.adapter);
    await expect(scheduler.schedule(spec())).rejects.toThrow('NOTIFICATION_PERMISSION_DENIED');
    expect(fake.calls.schedule).toBe(0);
  });
});
