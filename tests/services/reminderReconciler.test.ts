import { describe, expect, it } from 'vitest';

import { createReminderReconciler, resolveMeetingReminderTap } from '../../src/services/reminderReconciler';
import { createReminderScheduler, type ReminderSpec } from '../../src/services/reminderScheduler';
import { type ReminderNotificationAdapter } from '../../src/services/reminderScheduler';

function fakeAdapter(initial: any[] = []) {
  const scheduled = initial;
  const adapter: ReminderNotificationAdapter = {
    getPermissionsAsync: async () => ({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' } as any),
    requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' } as any),
    scheduleNotificationAsync: async (request) => { const identifier = `id-${scheduled.length + 1}`; scheduled.push({ identifier, content: request.content, trigger: request.trigger }); return identifier; },
    cancelScheduledNotificationAsync: async (identifier) => { const index = scheduled.findIndex((item) => item.identifier === identifier); if (index >= 0) scheduled.splice(index, 1); },
    getAllScheduledNotificationsAsync: async () => scheduled,
  };
  return { adapter, scheduled };
}

const reading: ReminderSpec = { reminderId: 'reading:member:one:2026-09-12', memberId: 'member:one', kind: 'READING', targetId: 'church-2026-09', taskDate: '2026-09-12', scheduleRevision: 0, triggerAt: '2026-09-12T08:00:00+08:00', route: '/today?date=2026-09-12', status: 'ACTIVE' };

describe('reminder reconciliation', () => {
  it('keeps account partitions, handles reading undo and revision invalidation', async () => {
    const fake = fakeAdapter([{ identifier: 'other', content: { data: { reminderId: 'reading:member:two:date', memberId: 'member:two', kind: 'READING', route: '/today' } }, trigger: new Date() }]);
    const scheduler = createReminderScheduler(fake.adapter);
    const reconciler = createReminderReconciler(scheduler);
    const first = await reconciler.reconcile({ memberId: 'member:one', readingEnabled: true, meetingEnabled: true, remoteDeliveryStatus: 'REMOTE_PENDING', reading, meeting: { meetingId: 'm1', scheduleRevision: 1, status: 'SCHEDULED' } });
    expect(first).toMatchObject({ created: [reading.reminderId, 'meeting:m1:1'], deliveryStatus: 'REMOTE_PENDING' });
    const second = await reconciler.reconcile({ memberId: 'member:one', readingEnabled: false, meetingEnabled: true, remoteDeliveryStatus: 'REMOTE_PENDING', reading: null, meeting: { meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' } });
    expect(second).toMatchObject({ cancelled: [reading.reminderId, 'meeting:m1:1'], created: ['meeting:m1:2'] });
    expect((await scheduler.list()).map((item) => item.memberId)).toEqual(['member:two']);
  });

  it('owns and schedules the complete future canonical reading set', async () => {
    const fake = fakeAdapter();
    const scheduler = createReminderScheduler(fake.adapter);
    const reconciler = createReminderReconciler(scheduler);
    const first = await reconciler.reconcile({ memberId: 'member:one', readingEnabled: true, meetingEnabled: false, remoteDeliveryStatus: 'LOCAL_ONLY', reading: null, readings: [reading, { ...reading, reminderId: 'reading:member:one:2026-09-15', taskDate: '2026-09-15', triggerAt: '2026-09-15T08:00:00+08:00' }], meeting: null });
    expect(first.created).toEqual(['reading:member:one:2026-09-12', 'reading:member:one:2026-09-15']);
    expect((await scheduler.list()).map((item) => item.taskDate)).toEqual(['2026-09-12', '2026-09-15']);
  });

  it('refetches latest state on tap and suppresses cancelled/stale events', () => {
    expect(resolveMeetingReminderTap({ meetingId: 'm1', scheduleRevision: 1 }, { meetingId: 'm1', scheduleRevision: 1, status: 'SCHEDULED' })).toEqual({ route: '/groups', meetingId: 'm1' });
    expect(resolveMeetingReminderTap({ meetingId: 'm1', scheduleRevision: 1 }, { meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' })).toBeNull();
    expect(resolveMeetingReminderTap({ meetingId: 'm1', scheduleRevision: 1 }, { meetingId: 'm1', scheduleRevision: 1, status: 'CANCELLED' })).toBeNull();
  });

  it('cancels a native schedule that completes after its auth authority is invalidated', async () => {
    let resolveSchedule!: (value: string) => void;
    let scheduleStarted!: () => void;
    const started = new Promise<void>((resolve) => { scheduleStarted = resolve; });
    const scheduled: any[] = [];
    const adapter: ReminderNotificationAdapter = {
      getPermissionsAsync: async () => ({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' } as any),
      requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true, expires: 'never', status: 'granted' } as any),
      scheduleNotificationAsync: async (request) => { scheduleStarted(); return new Promise((resolve) => { resolveSchedule = (identifier) => { scheduled.push({ identifier, content: request.content, trigger: request.trigger }); resolve(identifier); }; }); },
      cancelScheduledNotificationAsync: async (identifier) => { const index = scheduled.findIndex((item) => item.identifier === identifier); if (index >= 0) scheduled.splice(index, 1); },
      getAllScheduledNotificationsAsync: async () => scheduled,
      setNotificationChannelAsync: async () => null,
    };
    const scheduler = createReminderScheduler(adapter);
    const reconciler = createReminderReconciler(scheduler);
    let authorized = true;
    const operation = reconciler.reconcile({ memberId: 'member:one', readingEnabled: true, meetingEnabled: false, remoteDeliveryStatus: 'LOCAL_ONLY', reading, meeting: null }, () => authorized);
    await started;
    authorized = false;
    resolveSchedule('late-native-id');
    await operation;
    expect(await scheduler.list()).toEqual([]);
  });
});
