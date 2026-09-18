import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  reminders: { ready: true, error: null, readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 5, permission: 'granted', remoteDeliveryStatus: 'REMOTE_READY' },
  save: vi.fn(async (_patch: unknown) => undefined),
}));
vi.mock('react-native', () => ({ Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', Text: 'Text', TextInput: 'TextInput', View: 'View', Linking: { openSettings: vi.fn() }, StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../../src/services/authSession', () => ({
  clearAuthSession: vi.fn(), retryAuthProfile: vi.fn(),
  useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'member:test', sessionToken: 'test-session' }, profileStatus: 'ready', profile: { memberId: 'member:test', displayName: 'Test', avatarUrl: null, groupId: 'test-group', groupName: 'Test group' } }),
}));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => ({ savePreferences: state.save }), useReminderRuntimeSnapshot: () => state.reminders }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => null }));
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';
import { ReminderSettings } from '../../src/ui/ReminderSettings';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.reminders = { ready: true, error: null, readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 5, permission: 'granted', remoteDeliveryStatus: 'REMOTE_READY' };
  state.save.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('mounted account reminder change producers', () => {
  it('submits only each changed field through actual switches, advance button and time input', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '讀經提醒' }).props.onValueChange(false);
    });
    // The wheel commits on every settle; the screen-reader path steps one wheel row (5 minutes).
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '每日讀經時間' }).props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); });
    expect(state.save.mock.calls.map(([patch]) => patch)).toEqual([{ readingEnabled: false }, { readingTime: '08:05' }]);
    await act(async () => { renderer.unmount(); });
  });

  it('does not copy stale sibling fields from callbacks captured before a later render', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    const old = renderer.root.findByType(ReminderSettings).props;
    state.reminders = { ...state.reminders, readingEnabled: false, meetingEnabled: false, readingTime: '10:00', meetingAdvanceMinutes: 60 };
    await act(async () => { renderer.update(React.createElement(AccountSurface)); });
    await act(async () => { old.onReadingChange(false); old.onMeetingChange(false); old.onMeetingAdvanceChange(30); old.onReadingTimeChange('09:30'); });
    expect(state.save.mock.calls.map(([patch]) => patch)).toEqual([{ readingEnabled: false }, { meetingEnabled: false }, { meetingAdvanceMinutes: 30 }, { readingTime: '09:30' }]);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps whole-row taps as single-field patches', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '讀經提醒列' }).props.onPress(); });
    expect(state.save.mock.calls.map(([patch]) => patch)).toEqual([{ readingEnabled: false }]);
    await act(async () => { renderer.unmount(); });
  });
});
