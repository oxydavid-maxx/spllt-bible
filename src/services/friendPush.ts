import { AppState, Platform } from 'react-native';
import { friendAddedNotificationText } from '../domain/friendNotificationText';
import { candidateDataMaps, type ReminderBackgroundNotificationRegistrar, type ReminderTaskManager } from './reminderDelivery';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY, isReminderDeviceBinding, type ReminderDeviceSecureStore } from './reminderDevice';

/**
 * Being added as a friend, heard by push the moment it happens.
 *
 * The server sends a data-only FCM message { event: 'FRIEND_ADDED', friendMemberId, friendName } to
 * the QR owner's devices. Which part of this file handles it depends on the app's state, and the
 * routes are the ones reminderDelivery documents from expo-notifications' Android source:
 *
 *   Foreground. ExpoHandlingDelegate hands the message to the JS received-listeners, which the
 *   notification bridge forwards here as an in-app event: the friends list refreshes and an open
 *   我的好友 QR sheet says who just added you. FirebaseMessagingDelegate ALSO runs the registered
 *   task for every message, whatever the state, so the task publishes the same in-app event when it
 *   finds the app active; the bus drops the second copy.
 *
 *   Background or killed. Only the task sees it. It posts one local notification, and only when the
 *   member already allowed notifications — this never asks. Tapping it opens the 積分 friends list.
 */

export const FRIEND_PUSH_TASK = 'qingmu-youth-friend-push-v1';
export const FRIEND_NOTIFICATION_CHANNEL_ID = 'qingmu-friends';

export interface FriendAddedEvent {
  friendMemberId: string;
  friendName: string;
}

const MAX_FRIEND_NAME_LENGTH = 40;
/** The foreground listener and the task can both deliver one push; the second is the same event. */
const DUPLICATE_WINDOW_MS = 30_000;

function toFriendAdded(map: Record<string, unknown>): FriendAddedEvent | null {
  if (map.event !== 'FRIEND_ADDED' || typeof map.friendMemberId !== 'string' || !map.friendMemberId.trim()) return null;
  const name = typeof map.friendName === 'string' ? map.friendName.trim().slice(0, MAX_FRIEND_NAME_LENGTH) : '';
  return { friendMemberId: map.friendMemberId, friendName: name || '好友' };
}

/** Reads a task event, a job-queue wrapper, or a foreground notification, whichever shape arrived. */
export function parseFriendAdded(value: unknown): FriendAddedEvent | null {
  const root = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  // A foreground Notification object is { request: { content: { data } } } with no wrapper around it.
  const wrapped = root && 'request' in root && !('notification' in root) ? { notification: root } : value;
  for (const map of candidateDataMaps(wrapped)) {
    const event = toFriendAdded(map);
    if (event) return event;
  }
  return null;
}

type Listener = (event: FriendAddedEvent) => void;
const listeners = new Set<Listener>();
let lastPublished: { key: string; at: number } | null = null;

export function subscribeFriendAdded(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishFriendAdded(event: FriendAddedEvent, nowMs = Date.now()): void {
  const key = event.friendMemberId;
  if (lastPublished && lastPublished.key === key && nowMs - lastPublished.at < DUPLICATE_WINDOW_MS) return;
  lastPublished = { key, at: nowMs };
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* One screen failing to refresh must not stop the others. */ }
  }
}

// Tapping the notification asks for the friends list; the 積分 screen takes the request when it is
// on screen, now or the next time it is focused.
let openFriendsRequested = false;
const openFriendsListeners = new Set<() => void>();

export function requestOpenFriendsList(): void {
  openFriendsRequested = true;
  for (const listener of [...openFriendsListeners]) listener();
}

export function consumeOpenFriendsList(): boolean {
  const requested = openFriendsRequested;
  openFriendsRequested = false;
  return requested;
}

export function subscribeOpenFriendsList(listener: () => void): () => void {
  openFriendsListeners.add(listener);
  return () => { openFriendsListeners.delete(listener); };
}

export interface FriendPushRuntime {
  isForeground: () => boolean;
  present: (event: FriendAddedEvent) => Promise<void>;
}

export function registerFriendPushTask(taskManager: ReminderTaskManager, runtime: FriendPushRuntime): void {
  taskManager.defineTask(FRIEND_PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    const event = parseFriendAdded(data);
    if (!event) return;
    try {
      if (runtime.isForeground()) publishFriendAdded(event);
      else await runtime.present(event);
    } catch { /* A notification that cannot be shown is a notification the app shows next time it opens. */ }
  });
}

export interface FriendNotificationSource {
  getPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>;
  setNotificationChannelAsync: (id: string, channel: { name: string; importance: number }) => Promise<unknown>;
  scheduleNotificationAsync: (request: { content: { title: string; body: string; data: Record<string, unknown> }; trigger: { channelId: string } }) => Promise<unknown>;
}

/**
 * One local notification, for the member this device is bound to, only if notifications are
 * already allowed. The recipient comes from the device's own binding receipt: a device that signed
 * out has none, and says nothing.
 */
export async function presentFriendAddedNotification(event: FriendAddedEvent, dependencies: { notifications: FriendNotificationSource; secureStore: Pick<ReminderDeviceSecureStore, 'getItemAsync'> }): Promise<void> {
  const permission = await dependencies.notifications.getPermissionsAsync();
  if (permission.granted !== true && permission.status !== 'granted') return;
  const raw = await dependencies.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
  const receipt: unknown = raw ? JSON.parse(raw) : null;
  if (!isReminderDeviceBinding(receipt)) return;
  await dependencies.notifications.setNotificationChannelAsync(FRIEND_NOTIFICATION_CHANNEL_ID, { name: '好友', importance: 4 });
  await dependencies.notifications.scheduleNotificationAsync({
    content: { ...friendAddedNotificationText(event.friendName), data: { kind: 'FRIEND_ADDED', memberId: receipt.memberId, friendMemberId: event.friendMemberId } },
    trigger: { channelId: FRIEND_NOTIFICATION_CHANNEL_ID },
  });
}

export interface FriendPushLoaders {
  loadTaskManager?: () => Promise<ReminderTaskManager>;
  loadNotifications?: () => Promise<ReminderBackgroundNotificationRegistrar & FriendNotificationSource>;
  loadSecureStore?: () => Promise<Pick<ReminderDeviceSecureStore, 'getItemAsync'>>;
  isForeground?: () => boolean;
}

/**
 * Defined at module scope from the root layout, the way the meeting task was when Run 10 proved the
 * route on a phone: define first, then registerTaskAsync, or expo-notifications never calls it.
 */
export async function registerConfiguredFriendPushTask(loaders: FriendPushLoaders = {}): Promise<void> {
  // iOS friend pushes are alerts the system shows itself; a background task would need the remote-notification
  // background mode, which the app does not use there. Android's data-only push still needs the task.
  if (Platform.OS === 'ios') return;
  const loadTaskManager = loaders.loadTaskManager ?? (() => import('expo-task-manager') as unknown as Promise<ReminderTaskManager>);
  const loadNotifications = loaders.loadNotifications ?? (() => import('expo-notifications') as unknown as Promise<ReminderBackgroundNotificationRegistrar & FriendNotificationSource>);
  const loadSecureStore = loaders.loadSecureStore ?? (() => import('expo-secure-store'));
  // Headless, with no activity, React Native reports background; only a resumed app is active.
  const isForeground = loaders.isForeground ?? (() => AppState.currentState === 'active');
  const taskManager = await loadTaskManager();
  registerFriendPushTask(taskManager, {
    isForeground,
    present: async (event) => presentFriendAddedNotification(event, { notifications: await loadNotifications(), secureStore: await loadSecureStore() }),
  });
  const notifications = await loadNotifications();
  await notifications.registerTaskAsync(FRIEND_PUSH_TASK);
}
