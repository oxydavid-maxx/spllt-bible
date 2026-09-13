import { describe, expect, it } from 'vitest';

import { createFcmSender, MEETING_REMINDER_TASK, registerDefaultReminderHeadlessTask, registerReminderHeadlessTask, type FcmReminderPayload } from '../../src/services/reminderDelivery';

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
    registerReminderHeadlessTask({ defineTask: (name, next) => { expect(name).toBe(MEETING_REMINDER_TASK); handler = next; } }, { validateLatest: async (payload) => ({ valid: payload.scheduleRevision === 2, meetingId: payload.meetingId, scheduleRevision: 2, status: 'SCHEDULED' }), present: async (payload) => { presented.push(payload.reminderId); } });
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
        validateLatest: async (payload) => { validatedWith.push(payload.scheduleRevision); return { valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED' }; },
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
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED' }), present: async (p) => { presented.push(p.reminderId); } },
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
      { validateLatest: async (payload) => ({ valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED' }), present: async () => {} },
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
        validateLatest: async (payload) => { validatedWith.push(payload.scheduleRevision); return { valid: true, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED' }; },
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
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED' }), present: async (p) => { presented.push(p.reminderId); } },
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
      { validateLatest: async (p) => ({ valid: true, meetingId: p.meetingId, scheduleRevision: p.scheduleRevision, status: 'SCHEDULED' }), present: async (p) => { presented.push(p.reminderId); } },
    );
    await handler!({ data: { data: { event: 'SOMETHING_ELSE', reminderId: 'a', meetingId: 'm1', scheduleRevision: '2' } } });
    await handler!({ data: { data: { event: 'MEETING_REMINDER', reminderId: 'b', meetingId: 'm1', scheduleRevision: 'nope' } } });
    await handler!({ data: { data: { dataString: null }, notification: null } });
    await handler!({ data: { notification: { request: { content: { data: { event: 'MEETING_REMINDER', meetingId: 'm1', scheduleRevision: '2' } } } } } });
    await handler!({ data: {} });
    expect(presented).toEqual([]);
  });
});
