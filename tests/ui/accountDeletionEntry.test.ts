import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Google Play requires an in-app path to request deletion of the account and its data; a link to
// the web resource that explains the request is an accepted form of that path.
const native = vi.hoisted(() => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('react-native', () => ({
  Image: 'Image', Linking: { openURL: native.openURL, openSettings: vi.fn() }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('../../src/services/authSession', () => ({
  clearAuthSession: vi.fn(), retryAuthProfile: vi.fn(),
  useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'memory-only' }, profileStatus: 'ready',
    profile: { memberId: 'member:one', displayName: '小明', avatarUrl: null, groupId: 'G01', groupName: 'A小組' } }),
}));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => null, useReminderRuntimeSnapshot: () => ({}) }));
vi.mock('../../src/ui/ReminderSettings', () => ({ ReminderSettings: () => null }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => null }));
import { AccountSurface, ACCOUNT_DELETION_URL } from '../../src/ui/accountSurfaceComponent';

describe('account deletion entry', () => {
  it('lets a signed-in member open the account and data deletion request page', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    const entry = renderer.root.findByProps({ accessibilityLabel: '申請刪除帳號與資料' });
    expect(entry.props.accessibilityRole).toBe('link');
    await act(async () => { entry.props.onPress(); });
    expect(native.openURL).toHaveBeenCalledExactlyOnceWith(ACCOUNT_DELETION_URL);
    expect(ACCOUNT_DELETION_URL).toBe(`https://github.com/oxydavid-maxx/spllt-bible/blob/main/docs/play/privacy-policy.md#${encodeURIComponent('刪除帳號與資料')}`);
    await act(async () => { renderer.unmount(); });
  });
});
