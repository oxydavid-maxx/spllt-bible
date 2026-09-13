import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFcmSender, MEETING_REMINDER_TASK, presentValidatedMeetingReminder, registerDefaultReminderHeadlessTask, registerReminderHeadlessTask, type FcmReminderPayload, type HeadlessValidationResult } from '../../src/services/reminderDelivery';

const nativeNotifications = vi.hoisted(() => ({
  scheduleNotificationAsync: vi.fn(async () => 'native-meeting'),
  setNotificationChannelAsync: vi.fn(async () => null),
}));
vi.mock('expo-notifications', () => nativeNotifications);
const presentationAuthority = vi.hoisted(() => ({
  auth: { status: 'hydrating', session: null as { memberId: string; sessionToken: string } | null, epoch: 0, expiresAt: null as number | null },
  device: new Map<string, string>(),
  hasPersistedAuthTermination: vi.fn(async () => false),
}));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => presentationAuthority.auth, hasPersistedAuthTermination: presentationAuthority.hasPersistedAuthTermination }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => presentationAuthority.device.get(key) ?? null }));
beforeEach(() => {
  presentationAuthority.auth = { status: 'hydrating', session: null, epoch: 0, expiresAt: null };
  presentationAuthority.hasPersistedAuthTermination.mockReset().mockResolvedValue(false);
  presentationAuthority.device = new Map([
    ['qingmu.reminder.installationId', 'test-installation'], ['qingmu.reminder.deviceToken', 'test-device-token'],
    ['qingmu.reminder.bindingVersion', '1'], ['qingmu.reminder.ownerGeneration', '1'],
    ['qingmu.reminder.ownerReceipt.v1', JSON.stringify({ memberId: 'member:one', installationId: 'test-installation', token: 'test-device-token', bindingVersion: 1, ownerGeneration: 1 })],
  ]);
});

const currentMeeting = { event: 'MEETING_REMINDER' as const, reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2 };
const currentValidation = { valid: true, memberId: 'member:one', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' as const };

function headlessHarness(validateLatest: (payload: typeof currentMeeting) => Promise<HeadlessValidationResult>) {
  let handler!: (event: { data?: unknown; error?: unknown }) => Promise<void>;
  const present = vi.fn(async () => undefined);
  registerReminderHeadlessTask({ defineTask: (_name, next) => { handler = next; } }, { validateLatest, present });
  return { handler, present };
}

describe('owner-bound native reminder delivery', () => {
  it('presents the validated owner with a real FCM string-revision payload', async () => {
    const task = headlessHarness(async () => currentValidation);
    await task.handler({ data: { notification: null, data: { ...currentMeeting, scheduleRevision: '2', memberId: 'untrusted-push-owner' } } });
    expect(task.present).toHaveBeenCalledExactlyOnceWith({ ...currentMeeting, memberId: 'member:one' });
  });

  it.each([
    { ...currentValidation, memberId: undefined },
    { ...currentValidation, memberId: '' },
    { ...currentValidation, memberId: ' ' },
    { ...currentValidation, meetingId: 'other-meeting' },
    { ...currentValidation, scheduleRevision: 1 },
    { ...currentValidation, scheduleRevision: 2.5 },
    { ...currentValidation, scheduleRevision: -1 },
    { ...currentValidation, scheduleRevision: Number.NaN },
    { ...currentValidation, valid: 'true' },
    { ...currentValidation, status: 'CANCELLED' },
    null,
  ])('does not present stale, malformed or ownerless validation: %j', async (latest) => {
    const task = headlessHarness(async () => latest as HeadlessValidationResult);
    await expect(task.handler({ data: { data: { ...currentMeeting, scheduleRevision: '2' } } })).resolves.toBeUndefined();
    expect(task.present).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, '-1', '0.5', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid native revisions before validation: %s', async (scheduleRevision) => {
    const validate = vi.fn(async (payload: typeof currentMeeting) => ({ ...currentValidation, scheduleRevision: payload.scheduleRevision }));
    const task = headlessHarness(validate);
    await task.handler({ data: { data: { ...currentMeeting, scheduleRevision } } });
    expect(validate).not.toHaveBeenCalled();
    expect(task.present).not.toHaveBeenCalled();
  });

  it('fails closed when validation rejects', async () => {
    const task = headlessHarness(async () => { throw new Error('offline'); });
    await expect(task.handler({ data: { data: currentMeeting } })).resolves.toBeUndefined();
    expect(task.present).not.toHaveBeenCalled();
  });

  it('ensures the existing channel before presenting an immediate owner-bound local notification', async () => {
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('qingmu-reading-reminders', { name: '青牧提醒', importance: 4, vibrationPattern: [0, 250, 250, 250] });
    expect(nativeNotifications.scheduleNotificationAsync).toHaveBeenCalledWith({ content: { title: '青牧聚會提醒', body: '聚會資料可能已更新，請開啟 App 查看最新狀態。', data: { ...currentMeeting, memberId: 'member:one' } }, trigger: { channelId: 'qingmu-reading-reminders' } });
    expect(nativeNotifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(nativeNotifications.scheduleNotificationAsync.mock.invocationCallOrder[0]);
  });

  it('does not schedule a local notification without a validated owner', async () => {
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: '' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('presentation authority across the native channel await', () => {
  it('does not present a revoked expired snapshot with no session', async () => {
    presentationAuthority.auth = { status: 'expired', session: null, epoch: 1, expiresAt: null };
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it.each(['terminated', 'unreadable'])('does not present with %s persisted auth while hydrating', async (mode) => {
    if (mode === 'terminated') presentationAuthority.hasPersistedAuthTermination.mockResolvedValue(true);
    else presentationAuthority.hasPersistedAuthTermination.mockRejectedValue(new Error('storage unavailable'));
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not present after persisted termination during channel setup', async () => {
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => { presentationAuthority.hasPersistedAuthTermination.mockResolvedValue(true); return null; });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not trust legacy device keys without a persisted owner receipt', async () => {
    presentationAuthority.device.delete('qingmu.reminder.ownerReceipt.v1');
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule after the owner receipt is cleared during channel setup even if legacy keys remain', async () => {
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => { presentationAuthority.device.delete('qingmu.reminder.ownerReceipt.v1'); return null; });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'other-owner'])('refuses %s before ensuring the channel', async (status) => {
    presentationAuthority.auth = { status: status === 'other-owner' ? 'signed-in' : status, session: { memberId: 'member:two', sessionToken: 'test-session' }, epoch: 1, expiresAt: null };
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'other-owner', 'same-owner-new-epoch'])('does not schedule after %s during channel setup', async (status) => {
    presentationAuthority.auth = { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'test-session' }, epoch: 1, expiresAt: null };
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => {
      presentationAuthority.auth = { ...presentationAuthority.auth, status: status === 'other-owner' || status === 'same-owner-new-epoch' ? 'signed-in' : status, epoch: 2, session: { memberId: status === 'other-owner' ? 'member:two' : 'member:one', sessionToken: 'test-session' } };
      return null;
    });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule if a cold hydrating authority changes during channel setup', async () => {
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => {
      presentationAuthority.auth = { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'test-session' }, epoch: 1, expiresAt: null };
      return null;
    });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('presents for an expired interactive session with a matching device owner', async () => {
    presentationAuthority.auth = { status: 'expired', session: { memberId: 'member:one', sessionToken: 'expired-test-session' }, epoch: 1, expiresAt: 1 };
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('still rejects a known different owner while the interactive session is expired', async () => {
    presentationAuthority.auth = { status: 'expired', session: { memberId: 'member:two', sessionToken: 'expired-test-session' }, epoch: 1, expiresAt: 1 };
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('preserves background presentation when only interactive session expiry occurs during channel setup', async () => {
    presentationAuthority.auth = { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'test-session' }, epoch: 1, expiresAt: null };
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => { presentationAuthority.auth = { ...presentationAuthority.auth, status: 'expired', epoch: 2 }; return null; });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['qingmu.reminder.installationId', 'qingmu.reminder.deviceToken', 'qingmu.reminder.bindingVersion', 'qingmu.reminder.ownerGeneration'])('does not schedule after device binding drift: %s', async (key) => {
    nativeNotifications.setNotificationChannelAsync.mockImplementationOnce(async () => { presentationAuthority.device.set(key, 'changed'); return null; });
    await presentValidatedMeetingReminder({ ...currentMeeting, memberId: 'member:one' });
    expect(nativeNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('FCM sender and closed-app validation seam', () => {
  it('emits a data-only FCM v1 message with bounded TTL/collapse key through an injected transport', async () => {
    const requests: Array<{ url: string; body: string; authorization: string }> = [];
    const sender = createFcmSender({ projectId: 'qingmu-youth-test-20260908', enabled: true, getAccessToken: async () => 'access-token', fetchImpl: async (input, init) => { requests.push({ url: String(input), body: String(init?.body), authorization: String((init?.headers as Record<string, string>).authorization) }); return new Response(JSON.stringify({ name: 'projects/test/messages/1' }), { status: 200 }); } });
    const payload: FcmReminderPayload = { event: 'MEETING_REMINDER', reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2 };
    await expect(sender.send('device-token', payload, { ttlSeconds: 99999 })).resolves.toEqual({ messageId: 'projects/test/messages/1' });
    expect(requests[0].url).toContain('/v1/projects/qingmu-youth-test-20260908/messages:send');
    expect(requests[0].authorization).toBe('Bearer access-token');
    const body = JSON.parse(requests[0].body) as { message: { notification?: unknown; data: Record<string, string>; android: { ttl: string; collapse_key: string } } };
    expect(body.message.notification).toBeUndefined();
    expect(body.message.data.scheduleRevision).toBe('2');
    expect(body.message.android).toEqual({ ttl: '3600s', collapse_key: 'meeting:m1' });
  });

  it('registers a headless task that validates latest state before creating one local alert', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    registerReminderHeadlessTask({ defineTask: (name, next) => { expect(name).toBe(MEETING_REMINDER_TASK); handler = next; } }, { validateLatest: async (payload) => ({ valid: payload.scheduleRevision === 2, meetingId: payload.meetingId, scheduleRevision: 2, status: 'SCHEDULED', memberId: 'member:one' }), present: async (payload) => { presented.push(payload.reminderId); } });
    await handler!({ data: { event: 'MEETING_REMINDER', reminderId: 'meeting:m1:1', meetingId: 'm1', scheduleRevision: 1 } });
    await handler!({ data: { event: 'MEETING_REMINDER', reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2 } });
    expect(presented).toEqual(['meeting:m1:2']);
  });

  // Run 9 (2026-09-10) delivered the push and STILL showed nothing. The device log shows the
  // task firing with a real eventId and finishing in 3 ms, far too fast for validateLatest's
  // network call, which means it hit a synchronous early return.
  //
  // The cause is a contract mismatch between the two halves of this very file. createFcmSender
  // serialises the revision with String(...) because FCM data values MUST be strings, and the
  // handler then rejects anything whose scheduleRevision is not a number. So every meeting
  // reminder is dropped silently by the app's own guard, with no error and no notification.
  //
  // The existing handler test missed it because it injects the payload directly with a NUMBER,
  // which is not what FCM ever delivers. This case uses the wire shape the sender actually
  // produces.
  it('accepts the wire payload the sender actually produces, where scheduleRevision is a string', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    const validatedWith: number[] = [];
    registerReminderHeadlessTask(
      { defineTask: (_name, next) => { handler = next; } },
      {
        validateLatest: async (payload) => { validatedWith.push(payload.scheduleRevision); return { valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }; },
        present: async (payload) => { presented.push(payload.reminderId); },
      },
    );
    // Exactly what createFcmSender puts on the wire: every value a string.
    await handler!({ data: { event: 'MEETING_REMINDER', reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: '2' } });
    expect(presented).toEqual(['meeting:m1:2']);
    // and the revision must be normalised to a number, or the freshness comparison in the
    // handler would compare 2 against '2' and never match.
    expect(validatedWith).toEqual([2]);
  });

  it('still refuses a payload whose revision is not a usable number', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    registerReminderHeadlessTask(
      { defineTask: (_name, next) => { handler = next; } },
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }), present: async (p) => { presented.push(p.reminderId); } },
    );
    await handler!({ data: { event: 'MEETING_REMINDER', reminderId: 'x', meetingId: 'm1', scheduleRevision: 'not-a-number' } });
    await handler!({ data: { event: 'MEETING_REMINDER', reminderId: 'y', meetingId: 'm1', scheduleRevision: '' } });
    expect(presented).toEqual([]);
  });

  // Run 5 (2026-09-10) sent a data-only message that FCM accepted, yet no notification was
  // ever displayed and no task activity appeared in logcat. Defining a task only associates a
  // handler with a NAME; expo-notifications routes incoming background notifications to it
  // only after registerTaskAsync. The installed package says so directly: "You must define
  // the task first, with TaskManager.defineTask and register it with registerTaskAsync."
  // Without that call the delivery path is inert, which is why nothing was presented.
  it('binds the defined task to background notifications, so a data-only push can reach it', async () => {
    const order: string[] = [];
    let definedName: string | null = null;
    let registeredName: string | null = null;
    await registerDefaultReminderHeadlessTask(
      { validateLatest: async (payload) => ({ valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }), present: async () => {} },
      {
        loadTaskManager: async () => ({ defineTask: (name: string) => { definedName = name; order.push('define'); } }),
        loadNotifications: async () => ({ registerTaskAsync: async (name: string) => { registeredName = name; order.push('register'); return null; } }),
      },
    );
    expect(definedName).toBe(MEETING_REMINDER_TASK);
    expect(registeredName).toBe(MEETING_REMINDER_TASK);
    // Order is not cosmetic: registering a name that has no handler yet is the documented
    // way to get a task that never fires.
    expect(order).toEqual(['define', 'register']);
  });

  // Run 10 (2026-09-10) is what finally makes this unambiguous. The server row records
  // sent_at 09:42:49.208Z with a non-null provider_message_id; the device unfroze the app at
  // 09:42:49.064 and TaskService logged the named task starting AND finishing at 09:42:49.141
  // with eventId 753a4655. One send, one task execution, under a millisecond, nothing shown.
  // validateLatest performs a network fetch, so the handler never reached it.
  //
  // The reason is in expo-notifications' own Android source. FirebaseMessagingDelegate.onMessageReceived
  // calls runTaskManagerTasks(context, RemoteMessageSerializer.toBundle(remoteMessage)), and
  // RemoteMessageSerializer.toBundle puts the FCM data map under the "data" KEY, alongside
  // collapseKey/from/messageId/notification/sentTime/ttl. The package's own NotificationTaskPayload
  // type says the same: { notification: ... | null, data: { dataString?, [key]: unknown } }.
  //
  // Our handler read event.data.event, i.e. it treated the whole serialized RemoteMessage as the
  // data map. That property is undefined for every real push, so the guard returned synchronously
  // before the string-revision normalisation could ever run. The RC14f revision repair was
  // necessary — RemoteMessageSerializer stores every data value with putString, so the revision
  // really does arrive as '2' — but it sits BEHIND this shape check and could never be reached.
  it('reads the FCM data map from the serialized RemoteMessage that Android actually delivers', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    const validatedWith: number[] = [];
    registerReminderHeadlessTask(
      { defineTask: (_name, next) => { handler = next; } },
      {
        validateLatest: async (payload) => { validatedWith.push(payload.scheduleRevision); return { valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }; },
        present: async (payload) => { presented.push(payload.reminderId); },
      },
    );
    // Verbatim RemoteMessageSerializer.toBundle output for our data-only message: notification is
    // null because a data-only message carries no notification block, dataString is null because
    // we send no 'body' key, and every data value is a string.
    await handler!({
      data: {
        collapseKey: 'meeting:shadow-meeting-1',
        data: { dataString: null, event: 'MEETING_REMINDER', reminderId: 'meeting:shadow-meeting-1:2', meetingId: 'shadow-meeting-1', scheduleRevision: '2' },
        from: 'sender-id',
        messageId: 'message-id',
        messageType: null,
        notification: null,
        originalPriority: 2,
        priority: 2,
        sentTime: 1789033369208,
        to: null,
        ttl: 300,
      },
    });
    expect(presented).toEqual(['meeting:shadow-meeting-1:2']);
    expect(validatedWith).toEqual([2]);
  });

  // The second delivery route. BackgroundRemoteNotificationTaskConsumer.didExecuteJob runs when the
  // task arrives through the job queue rather than directly, and it wraps the payload as
  // { notification: NotificationSerializer.toBundle(...) }, which nests the data map under
  // request.content.data. Both routes reach the same defined task, so the handler must read both.
  it('reads the FCM data map from the job-queue notification shape as well', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    registerReminderHeadlessTask(
      { defineTask: (_name, next) => { handler = next; } },
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }), present: async (p) => { presented.push(p.reminderId); } },
    );
    await handler!({
      data: {
        notification: {
          request: {
            identifier: 'meeting:shadow-meeting-1:2',
            content: { title: null, body: null, dataString: null, data: { event: 'MEETING_REMINDER', reminderId: 'meeting:shadow-meeting-1:2', meetingId: 'shadow-meeting-1', scheduleRevision: '2' } },
            trigger: { type: 'push', remoteMessage: { data: { event: 'MEETING_REMINDER', reminderId: 'meeting:shadow-meeting-1:2', meetingId: 'shadow-meeting-1', scheduleRevision: '2' } } },
          },
        },
      },
    });
    expect(presented).toEqual(['meeting:shadow-meeting-1:2']);
  });

  // Widening where the handler looks must not widen WHAT it accepts. An unrelated push, or a
  // meeting payload with an unusable revision, must still be dropped at every nesting level.
  it('refuses unrelated or malformed pushes at every nesting level', async () => {
    let handler: ((event: { data?: unknown; error?: unknown }) => Promise<void>) | null = null;
    const presented: string[] = [];
    registerReminderHeadlessTask(
      { defineTask: (_name, next) => { handler = next; } },
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED', memberId: 'member:one' }), present: async (p) => { presented.push(p.reminderId); } },
    );
    await handler!({ data: { data: { event: 'SOMETHING_ELSE', reminderId: 'a', meetingId: 'm1', scheduleRevision: '2' } } });
    await handler!({ data: { data: { event: 'MEETING_REMINDER', reminderId: 'b', meetingId: 'm1', scheduleRevision: 'nope' } } });
    await handler!({ data: { data: { dataString: null }, notification: null } });
    await handler!({ data: { notification: { request: { content: { data: { event: 'MEETING_REMINDER', meetingId: 'm1', scheduleRevision: '2' } } } } } });
    await handler!({ data: {} });
    expect(presented).toEqual([]);
  });
});
