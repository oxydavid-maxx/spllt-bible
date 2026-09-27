import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  received: null as ((notification: unknown) => void) | null,
  response: null as ((response: unknown) => void) | null,
  removeReceived: vi.fn(),
  push: vi.fn(),
  auth: { status: 'signed-in', session: { memberId: 'member-owner', sessionToken: 'session' }, epoch: 1 },
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) } }));
vi.mock('expo-router', () => ({ router: { push: state.push }, useRootNavigationState: () => ({ key: 'root' }) }));
vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: () => undefined,
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { state.response = listener; return { remove: () => undefined }; },
  addNotificationReceivedListener: (listener: (notification: unknown) => void) => { state.received = listener; return { remove: state.removeReceived }; },
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => undefined,
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.auth, getAuthSnapshot: () => state.auth }));
vi.mock('../../src/services/configuredReminderHeadless', () => ({ validateConfiguredMeetingReminder: vi.fn() }));

import { ReminderNotificationBridge } from '../../src/services/ReminderNotificationBridge';
import { consumeOpenFriendsList, subscribeFriendAdded } from '../../src/services/friendPush';

let renderer: TestRenderer.ReactTestRenderer | null = null;
afterEach(() => { act(() => { renderer?.unmount(); }); renderer = null; consumeOpenFriendsList(); });

async function mount() {
  await act(async () => { renderer = TestRenderer.create(React.createElement(ReminderNotificationBridge)); });
  await act(async () => { await vi.dynamicImportSettled(); });
}

describe('the notification bridge carries friend pushes into the app', () => {
  it('turns a FRIEND_ADDED data push that arrives in the foreground into an in-app event', async () => {
    await mount();
    const heard = vi.fn();
    const unsubscribe = subscribeFriendAdded(heard);
    state.received?.({ request: { identifier: 'fcm-1', content: { data: { event: 'FRIEND_ADDED', friendMemberId: 'member-bridge', friendName: '小明' } } } });
    unsubscribe();
    expect(heard).toHaveBeenCalledWith({ friendMemberId: 'member-bridge', friendName: '小明' });
  });

  it('opens the 積分 friends list when the posted notification is tapped', async () => {
    await mount();
    await act(async () => {
      state.response?.({ actionIdentifier: 'default', notification: { date: 1, request: { identifier: 'local-1', content: { data: { kind: 'FRIEND_ADDED', memberId: 'member-owner', friendMemberId: 'member-bridge' } } } } });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(state.push).toHaveBeenCalledWith('/progress');
    expect(consumeOpenFriendsList()).toBe(true);
  });

  it('stops listening when the root goes away', async () => {
    await mount();
    act(() => { renderer?.unmount(); });
    renderer = null;
    expect(state.removeReceived).toHaveBeenCalled();
  });
});
