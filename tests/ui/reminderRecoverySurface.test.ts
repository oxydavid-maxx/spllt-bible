import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: 'load' as 'load' | 'save' | null, retryLoad: vi.fn(async () => undefined), retrySave: vi.fn(async () => undefined), save: vi.fn(async () => undefined) }));
vi.mock('react-native', () => ({ Image: 'Image', Linking: {}, Pressable: 'Pressable', Text: 'Text', View: 'View', Switch: 'Switch', TextInput: 'TextInput', StyleSheet: { create: (x: unknown) => x, hairlineWidth: 1 } }));
vi.mock('../../src/services/authSession', () => ({ clearAuthSession: vi.fn(), retryAuthProfile: vi.fn(), useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'test:member', sessionToken: 'memory-only' }, profile: { memberId: 'test:member', displayName: '測試', groupName: '測試小組' }, profileStatus: 'ready' }) }));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => ({ retryLoad: state.retryLoad, retrySave: state.retrySave, savePreferences: state.save }), useReminderRuntimeSnapshot: () => ({ ready: state.error !== 'load', error: state.error, readingEnabled: false, meetingEnabled: false, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING', permission: 'undetermined' }) }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => null }));
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';

beforeEach(() => { vi.clearAllMocks(); state.error = 'load'; });
it.each(['load', 'save'] as const)('exposes the %s retry on the real account reminder surface', async error => {
  state.error = error;
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(React.createElement(AccountSurface)); });
  const text = view.root.findAllByType('Text' as never).map(x => x.props.children).join(' ');
  expect(text).not.toContain('提醒設定讀取中');
  expect(text).not.toContain('提醒設定已同步');
  const label = error === 'load' ? '重試讀取提醒設定' : '重試儲存提醒設定';
  const retry = view.root.findAllByProps({ accessibilityLabel: label }).find(x => typeof x.type === 'string')!;
  expect(retry).toBeDefined();
  await act(async () => { retry.props.onPress(); });
  expect(error === 'load' ? state.retryLoad : state.retrySave).toHaveBeenCalledTimes(1);
  expect(state.save).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
