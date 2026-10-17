import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ clear: vi.fn(), remove: vi.fn(async () => true) }));
vi.mock('react-native', () => ({ Image: 'Image', Linking: { openSettings: vi.fn() }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../../src/services/authSession', () => ({
  clearAuthSession: state.clear, clearAuthSessionIfCurrent: state.clear, retryAuthProfile: vi.fn(),
  useAuthSnapshot: () => ({ status: 'signed-in', epoch: 1, session: { memberId: 'member:one', sessionToken: 'memory-only' }, profileStatus: 'ready', profile: { memberId: 'member:one', displayName: '虛構甲', avatarUrl: null, groupId: 'G01', groupName: '測試小組' } }),
}));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ deleteAccount: state.remove }) }));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => null, useReminderRuntimeSnapshot: () => ({}) }));
vi.mock('../../src/ui/ReminderSettings', () => ({ ReminderSettings: () => null }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => null }));
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';
beforeEach(() => { state.clear.mockClear(); state.remove.mockReset().mockResolvedValue(true); });
describe('in-app permanent account deletion', () => {
  it('requires the second confirmation, supports cancellation, then deletes and logs out', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(AccountSurface)); });
    const press = async (label: string) => act(async () => { await tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
    await press('刪除帳號與資料');
    expect(JSON.stringify(tree.toJSON())).toContain('這會永久刪除你的帳號與伺服器上的個人資料，無法復原。');
    expect(JSON.stringify(tree.toJSON())).not.toContain('匯出日記');
    expect(state.remove).not.toHaveBeenCalled();
    await press('取消');
    expect(tree.root.findAllByProps({ accessibilityLabel: '確認刪除' })).toHaveLength(0);
    await press('刪除帳號與資料'); await press('確認刪除');
    expect(state.remove).toHaveBeenCalledTimes(1); expect(state.clear).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
  it('keeps the account signed in on failure and allows retry', async () => {
    state.remove.mockRejectedValueOnce(new Error('offline'));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(AccountSurface)); });
    await act(async () => tree.root.findByProps({ accessibilityLabel: '刪除帳號與資料' }).props.onPress());
    await act(async () => tree.root.findByProps({ accessibilityLabel: '確認刪除' }).props.onPress());
    expect(JSON.stringify(tree.toJSON())).toContain('刪除沒有完成，請稍後重試。'); expect(state.clear).not.toHaveBeenCalled();
    await act(async () => tree.root.findByProps({ accessibilityLabel: '確認刪除' }).props.onPress());
    expect(state.clear).toHaveBeenCalledOnce(); await act(async () => tree.unmount());
  });
});
