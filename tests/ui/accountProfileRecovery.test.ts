import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profileStatus: 'error' as 'error' | 'empty' | 'loading',
  retry: vi.fn(async () => undefined),
}));
vi.mock('react-native', () => ({
  Image: 'Image', Linking: {}, Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('../../src/services/authSession', () => ({
  clearAuthSession: vi.fn(), retryAuthProfile: () => state.retry(),
  useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'test:member', sessionToken: 'memory-only' }, profile: null, profileStatus: state.profileStatus }),
}));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => null, useReminderRuntimeSnapshot: () => ({}) }));
vi.mock('../../src/ui/ReminderSettings', () => ({ ReminderSettings: () => null }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => React.createElement('GoogleLoginCard') }));
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';

beforeEach(() => { state.profileStatus = 'error'; state.retry.mockReset().mockResolvedValue(undefined); });
function text(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType('Text' as never).map(node => String(node.props.children ?? '')).join(' ');
}
describe('actual signed-in account surface after profile request finishes', () => {
  it.each(['error', 'empty'] as const)('renders %s with recovery, without an endless loader or another sign-in', async status => {
    state.profileStatus = status;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    expect(text(renderer)).not.toContain('正在載入帳戶資料');
    expect(renderer.root.findAllByType('GoogleLoginCard' as never)).toHaveLength(0);
    const retry = renderer.root.findByProps({ accessibilityLabel: '重試載入帳戶資料' });
    expect(retry.props.disabled).toBe(false);
    await act(async () => { retry.props.onPress(); });
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ accessibilityLabel: '重試載入帳戶資料' }).props.disabled).toBe(false);
    await act(async () => { renderer.unmount(); });
  });
});
