import { afterEach, describe, expect, it, vi } from 'vitest';

const { appState, platform } = vi.hoisted(() => ({ appState: { currentState: 'active' as string }, platform: { OS: 'android' as string } }));
vi.mock('react-native', () => ({ AppState: appState, Platform: platform }));

import {
  FRIEND_NOTIFICATION_CHANNEL_ID, FRIEND_PUSH_TASK, consumeOpenFriendsList, parseFriendAdded, presentFriendAddedNotification,
  publishFriendAdded, registerConfiguredFriendPushTask, registerFriendPushTask, requestOpenFriendsList, subscribeFriendAdded,
  type FriendNotificationSource,
} from '../../src/services/friendPush';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY } from '../../src/services/reminderDevice';

/**
 * FRIEND_ADDED as each expo-notifications route actually delivers it. The shapes are the ones
 * reminderDelivery documents from the Android source; which route fires in which app state is only
 * provable on a phone, so these tests pin what each route does once it has fired.
 */

const data = { event: 'FRIEND_ADDED', friendMemberId: 'member-scanner', friendName: '小明' };
const receipt = JSON.stringify({ memberId: 'member-owner', installationId: 'install', token: 'device-token', bindingVersion: 1, ownerGeneration: 1 });

function notifications(permission: { granted?: boolean; status?: string } = { granted: true, status: 'granted' }) {
  const scheduled: unknown[] = [];
  const source: FriendNotificationSource & { requestPermissionsAsync: ReturnType<typeof vi.fn>; registerTaskAsync: ReturnType<typeof vi.fn> } = {
    getPermissionsAsync: vi.fn(async () => permission),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    setNotificationChannelAsync: vi.fn(async () => null),
    scheduleNotificationAsync: vi.fn(async (request: unknown) => { scheduled.push(request); return 'id'; }),
    registerTaskAsync: vi.fn(async () => undefined),
  };
  return { source, scheduled };
}
const store = (values: Record<string, string>) => ({ getItemAsync: async (key: string) => values[key] ?? null });

let unsubscribe: (() => void) | null = null;
afterEach(() => { unsubscribe?.(); unsubscribe = null; consumeOpenFriendsList(); appState.currentState = 'active'; });

describe('reading FRIEND_ADDED out of whichever route delivered it', () => {
  it('reads the task event, the job-queue wrapper and a foreground notification alike', () => {
    const expected = { friendMemberId: 'member-scanner', friendName: '小明' };
    expect(parseFriendAdded({ data, messageId: 'm', notification: null })).toEqual(expected);
    expect(parseFriendAdded({ notification: { request: { content: { data } } } })).toEqual(expected);
    expect(parseFriendAdded({ notification: { request: { content: { data: {} }, trigger: { remoteMessage: { data } } } } })).toEqual(expected);
    expect(parseFriendAdded({ request: { identifier: 'm', content: { data } } })).toEqual(expected);
  });

  it('ignores a meeting reminder and anything without a friend id', () => {
    expect(parseFriendAdded({ data: { event: 'MEETING_REMINDER', reminderId: 'r', meetingId: 'm', scheduleRevision: '1' } })).toBeNull();
    expect(parseFriendAdded({ data: { event: 'FRIEND_ADDED', friendName: '小明' } })).toBeNull();
  });
});

describe('the task that runs for every push', () => {
  function defineTask() {
    let handler!: (event: { data?: unknown; error?: unknown }) => Promise<void>;
    const present = vi.fn(async () => undefined);
    let foreground = true;
    registerFriendPushTask({ defineTask: (name, next) => { expect(name).toBe(FRIEND_PUSH_TASK); handler = next; } }, { isForeground: () => foreground, present });
    return { run: (value: unknown) => handler({ data: value }), present, setForeground: (value: boolean) => { foreground = value; } };
  }

  it('refreshes the open app in place and posts nothing while it is in the foreground', async () => {
    const task = defineTask();
    const heard = vi.fn();
    unsubscribe = subscribeFriendAdded(heard);
    await task.run({ data: { ...data, friendMemberId: 'member-foreground' } });
    expect(heard).toHaveBeenCalledWith({ friendMemberId: 'member-foreground', friendName: '小明' });
    expect(task.present).not.toHaveBeenCalled();
  });

  it('posts a notification instead when the app is in the background', async () => {
    const task = defineTask();
    task.setForeground(false);
    const heard = vi.fn();
    unsubscribe = subscribeFriendAdded(heard);
    await task.run({ data: { ...data, friendMemberId: 'member-background' } });
    expect(task.present).toHaveBeenCalledWith({ friendMemberId: 'member-background', friendName: '小明' });
    expect(heard).not.toHaveBeenCalled();
  });

  it('does nothing for a message that is not a friend push', async () => {
    const task = defineTask();
    task.setForeground(false);
    await task.run({ data: { event: 'MEETING_REMINDER' } });
    expect(task.present).not.toHaveBeenCalled();
  });

  it('delivers one in-app event when the listener and the task both carry the same push', () => {
    const heard = vi.fn();
    unsubscribe = subscribeFriendAdded(heard);
    publishFriendAdded({ friendMemberId: 'member-twice', friendName: '小明' }, 1_000);
    publishFriendAdded({ friendMemberId: 'member-twice', friendName: '小明' }, 2_000);
    publishFriendAdded({ friendMemberId: 'member-twice', friendName: '小明' }, 40_000);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('is defined before it is registered, under its own name', async () => {
    const order: string[] = [];
    const { source } = notifications();
    source.registerTaskAsync.mockImplementation(async (name: string) => { order.push(`register:${name}`); });
    await registerConfiguredFriendPushTask({
      loadTaskManager: async () => ({ defineTask: (name: string) => { order.push(`define:${name}`); } }),
      loadNotifications: async () => source,
      loadSecureStore: async () => store({}),
    });
    expect(order).toEqual([`define:${FRIEND_PUSH_TASK}`, `register:${FRIEND_PUSH_TASK}`]);
  });

  it('registers no background task on iOS, where the system shows the friend alert itself', async () => {
    const order: string[] = [];
    const { source } = notifications();
    source.registerTaskAsync.mockImplementation(async (name: string) => { order.push(`register:${name}`); });
    platform.OS = 'ios';
    try {
      await registerConfiguredFriendPushTask({
        loadTaskManager: async () => ({ defineTask: (name: string) => { order.push(`define:${name}`); } }),
        loadNotifications: async () => source,
        loadSecureStore: async () => store({}),
      });
    } finally { platform.OS = 'android'; }
    expect(order).toEqual([]);
  });

  it('reads the foreground from AppState by default', async () => {
    let handler!: (event: { data?: unknown }) => Promise<void>;
    const { source, scheduled } = notifications();
    await registerConfiguredFriendPushTask({
      loadTaskManager: async () => ({ defineTask: (_name: string, next: typeof handler) => { handler = next; } }),
      loadNotifications: async () => source,
      loadSecureStore: async () => store({ [REMINDER_DEVICE_OWNER_RECEIPT_KEY]: receipt }),
    });
    appState.currentState = 'background';
    await handler({ data: { data: { ...data, friendMemberId: 'member-appstate' } } });
    expect(scheduled).toHaveLength(1);
  });
});

describe('the notification a backgrounded phone shows', () => {
  it('says who added you, under the app’s name, addressed to the member this device is bound to', async () => {
    const { source, scheduled } = notifications();
    await presentFriendAddedNotification({ friendMemberId: 'member-scanner', friendName: '小明' }, { notifications: source, secureStore: store({ [REMINDER_DEVICE_OWNER_RECEIPT_KEY]: receipt }) });
    expect(scheduled).toEqual([{
      content: { title: '竹科聖經', body: '小明 已加你為好友', data: { kind: 'FRIEND_ADDED', memberId: 'member-owner', friendMemberId: 'member-scanner' } },
      trigger: { channelId: FRIEND_NOTIFICATION_CHANNEL_ID },
    }]);
  });

  it('never asks for permission, and shows nothing without it', async () => {
    const { source, scheduled } = notifications({ granted: false, status: 'undetermined' });
    await presentFriendAddedNotification({ friendMemberId: 'member-scanner', friendName: '小明' }, { notifications: source, secureStore: store({ [REMINDER_DEVICE_OWNER_RECEIPT_KEY]: receipt }) });
    expect(scheduled).toHaveLength(0);
    expect(source.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('shows nothing on a device that is no longer bound to anybody', async () => {
    const { source, scheduled } = notifications();
    await presentFriendAddedNotification({ friendMemberId: 'member-scanner', friendName: '小明' }, { notifications: source, secureStore: store({}) });
    expect(scheduled).toHaveLength(0);
  });
});

describe('opening the friends list from the notification', () => {
  it('is a request the 積分 screen takes once', () => {
    requestOpenFriendsList();
    expect(consumeOpenFriendsList()).toBe(true);
    expect(consumeOpenFriendsList()).toBe(false);
  });
});
