import { describe, expect, it } from 'vitest';
import type { NotificationRequestInput } from 'expo-notifications';

import { createReminderReconciler } from '../../src/services/reminderReconciler';
import { buildNextReadingReminderSpec, buildUpcomingReadingReminderSpecs, createReminderScheduler, type ReminderNotificationAdapter, type ReminderSpec } from '../../src/services/reminderScheduler';
import { canonicalSeptemberPlan } from '../../src/domain/calendar';

const schedule = canonicalSeptemberPlan.days.map((day) => ({ taskDate: day.date, planId: canonicalSeptemberPlan.planId }));

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

function fakeAdapter(initial: Array<Record<string, unknown>> = [], granted = true, platform: 'request' | 'android' | 'ios' = 'request') {
  const scheduled = initial as any[];
  const calls = { schedule: 0, cancel: [] as string[], requests: [] as NotificationRequestInput[], channels: [] as string[] };
  const adapter: ReminderNotificationAdapter = {
    getPermissionsAsync: async () => ({ granted, canAskAgain: !granted, expires: 'never', status: granted ? 'granted' : 'denied' } as any),
    requestPermissionsAsync: async () => ({ granted, canAskAgain: false, expires: 'never', status: granted ? 'granted' : 'denied' } as any),
    scheduleNotificationAsync: async (request) => {
      calls.schedule += 1;
      calls.requests.push(request);
      const identifier = `native-${calls.schedule}`;
      const input = request.trigger as { date: Date; channelId?: string };
      // Expo 56.0.25: Android DateTrigger.toBundle exposes value in milliseconds.
      // iOS DateTriggerRecord becomes a UNTimeIntervalNotificationTrigger; its
      // NotificationTriggerRecord exposes the original interval, not an absolute date.
      const trigger = platform === 'android'
        ? { type: 'date', repeats: false, value: input.date.getTime(), channelId: input.channelId }
        : platform === 'ios'
          ? { class: 'UNTimeIntervalNotificationTrigger', type: 'timeInterval', repeats: false, seconds: (input.date.getTime() - Date.parse('2026-09-11T00:00:00.000Z')) / 1000 }
          : request.trigger;
      scheduled.push({ identifier, content: JSON.parse(JSON.stringify(request.content)), trigger });
      return identifier;
    },
    cancelScheduledNotificationAsync: async (identifier) => { calls.cancel.push(identifier); const index = scheduled.findIndex((item) => item.identifier === identifier); if (index >= 0) scheduled.splice(index, 1); },
    getAllScheduledNotificationsAsync: async () => scheduled,
    setNotificationChannelAsync: async (channelId) => { calls.channels.push(channelId); return null; },
  };
  return { adapter, calls, scheduled };
}

describe('local reminder scheduler', () => {
  it('selects the next account-scheduled date in Asia/Taipei for the chosen daily time', () => {
    expect(buildNextReadingReminderSpec('member:one', '07:45', new Date('2026-09-11T23:00:00.000Z'), schedule)).toMatchObject({ reminderId: 'reading:member:one:2026-09-12', taskDate: '2026-09-12', targetId: 'church-2026-09', route: '/today?date=2026-09-12' });
  });

  it('returns every future account-scheduled task date without past or duplicate reminders', () => {
    const specs = buildUpcomingReadingReminderSpecs('member:one', '07:45', new Date('2026-09-09T00:00:00.000Z'), schedule);
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

  it('schedules on the same Android channel created before requesting permission', async () => {
    const fake = fakeAdapter();
    await createReminderScheduler(fake.adapter).schedule(spec());
    expect(fake.calls.channels).toEqual(['qingmu-reading-reminders']);
    expect(fake.calls.requests[0].trigger).toEqual({ type: 'date', date: new Date(spec().triggerAt), channelId: fake.calls.channels[0] });
  });

  it.each(['android', 'ios'] as const)('restores the absolute scheduled time from %s native readback after scheduler recreation', async (platform) => {
    const fake = fakeAdapter([], true, platform);
    const reading = spec({ triggerAt: '2026-09-12T00:00:00.000Z' });
    await createReminderScheduler(fake.adapter).schedule(reading);
    expect(await createReminderScheduler(fake.adapter).list()).toEqual([reading]);
  });

  it.each(['android', 'ios'] as const)('does not cancel or requeue an unchanged %s native schedule on fresh reconciliation', async (platform) => {
    const fake = fakeAdapter([], true, platform);
    const reading = spec({ triggerAt: '2026-09-12T00:00:00.000Z' });
    const snapshot = { memberId: reading.memberId, readingEnabled: true, meetingEnabled: false, remoteDeliveryStatus: 'LOCAL_ONLY' as const, reading, meeting: null };
    expect(await createReminderReconciler(createReminderScheduler(fake.adapter)).reconcile(snapshot)).toMatchObject({ created: [reading.reminderId], cancelled: [], unchanged: [] });
    expect(await createReminderReconciler(createReminderScheduler(fake.adapter)).reconcile(snapshot)).toMatchObject({ created: [], cancelled: [], unchanged: [reading.reminderId] });
    expect(fake.calls.schedule).toBe(1);
    expect(fake.calls.cancel).toEqual([]);
    expect(fake.scheduled.map((request) => request.identifier)).toEqual(['native-1']);
  });

  it('uses the Android native timestamp instead of conflicting persisted metadata', async () => {
    const reading = spec({ triggerAt: '2026-09-12T00:00:00.000Z' });
    const fake = fakeAdapter([{ identifier: 'native', content: { data: { ...reading, triggerAt: '2026-09-13T00:00:00.000Z' } }, trigger: { type: 'date', repeats: false, value: Date.parse(reading.triggerAt) } }]);
    expect((await createReminderScheduler(fake.adapter).list())[0].triggerAt).toBe(reading.triggerAt);
  });

  it.each([
    { type: 'date', value: Number.NaN },
    { type: 'date', value: Number.POSITIVE_INFINITY },
    { type: 'date', value: 1e20 },
    { type: 'date', value: '1789171200000' },
    { type: 'date' },
    { type: 'timeInterval', repeats: true, seconds: 86400 },
    { type: 'timeInterval', repeats: false },
    { type: 'timeInterval', repeats: false, seconds: Number.NaN },
    { type: 'timeInterval', repeats: false, seconds: -1 },
    { type: 'daily', value: 1789171200000 },
    null,
  ])('does not treat malformed or unrelated native triggers as valid via persisted metadata: %j', async (trigger) => {
    const reading = spec({ triggerAt: '2026-09-12T00:00:00.000Z' });
    const fake = fakeAdapter([{ identifier: 'bad-native', content: { data: reading }, trigger }]);
    const scheduler = createReminderScheduler(fake.adapter);
    expect(await scheduler.list()).toEqual([{ ...reading, triggerAt: '1970-01-01T00:00:00.000Z' }]);
    await scheduler.cancelForMember(reading.memberId);
    expect(fake.calls.cancel).toEqual(['bad-native']);
    expect(await scheduler.list()).toEqual([]);
  });

  it.each([undefined, 'invalid', '0'])('keeps legacy or malformed iOS metadata cancellable instead of inventing an absolute time: %s', async (triggerAt) => {
    const reading = spec();
    const fake = fakeAdapter([{ identifier: 'legacy-ios', content: { data: { ...reading, triggerAt } }, trigger: { type: 'timeInterval', repeats: false, seconds: 86400 } }]);
    const scheduler = createReminderScheduler(fake.adapter);
    expect((await scheduler.list())[0].triggerAt).toBe('1970-01-01T00:00:00.000Z');
    expect(await createReminderReconciler(scheduler).reconcile({ memberId: reading.memberId, readingEnabled: false, meetingEnabled: false, remoteDeliveryStatus: 'LOCAL_ONLY', reading: null, meeting: null })).toMatchObject({ cancelled: [reading.reminderId], created: [] });
    expect(fake.calls.cancel).toEqual(['legacy-ios']);
  });
});
