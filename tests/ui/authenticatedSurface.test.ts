import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: vi.fn(), requestPermissionsAsync: vi.fn(), getDevicePushTokenAsync: vi.fn(), addPushTokenListener: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixture-installation') }));
vi.mock('expo-modules-core', () => ({ EventEmitter: class {}, NativeModulesProxy: {}, requireNativeModule: vi.fn(), requireOptionalNativeModule: vi.fn(), Platform: { OS: 'test' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('react-native', () => ({
  Image: 'Image',
  Linking: { openSettings: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../../src/services/apiClient', () => ({
  createApiClient: vi.fn(() => ({
    getReminderSnapshot: vi.fn(async () => null),
    saveReminderPreferences: vi.fn(async () => null),
    registerReminderDeviceToken: vi.fn(async () => false),
    revokeReminderDeviceToken: vi.fn(async () => false),
  })),
}));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => React.createElement('GoogleLoginCard') }));

import { Image, Text } from 'react-native';
import { clearAuthSession, persistAuthProfile, setAuthSession } from '../../src/services/authSession';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';

const profile = { memberId: 'member:verified', displayName: '小明', avatarUrl: 'https://cdn.example/avatar.png', groupId: 'G01', groupName: 'A小組' };

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children ?? '')).join(' ');
}

describe('mounted verified identity surfaces', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });
  beforeEach(async () => {
    clearAuthSession();
    await act(async () => { await persistAuthProfile(profile); });
  });

  it('uses a generic header fallback before the verified profile arrives', () => {
    act(() => { setAuthSession({ memberId: 'member:verified', sessionToken: 'session' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(AccountEntryButton)); });
    expect(textContent(renderer)).toContain('人');
    expect(textContent(renderer)).not.toContain('v');
    renderer.unmount();
  });

  it('does not show a second Google sign-in CTA while a valid identity profile is loading', () => {
    act(() => { setAuthSession({ memberId: 'member:verified', sessionToken: 'session' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    expect(textContent(renderer)).toContain('身份已確認');
    expect(renderer.root.findAll((node) => String(node.type) === 'GoogleLoginCard')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '重試載入帳戶資料')).toHaveLength(1);
    renderer.unmount();
  });

  it('renders a verified avatar URI as an image in the mounted header and account surface', async () => {
    act(() => { setAuthSession({ memberId: profile.memberId, sessionToken: 'session' }); });
    await act(async () => { await persistAuthProfile(profile); });
    let header!: TestRenderer.ReactTestRenderer;
    let account!: TestRenderer.ReactTestRenderer;
    act(() => { header = TestRenderer.create(React.createElement(AccountEntryButton)); });
    act(() => { account = TestRenderer.create(React.createElement(AccountSurface)); });
    expect(header.root.findAllByType(Image)[0]?.props.source).toEqual({ uri: profile.avatarUrl });
    expect(account.root.findAllByType(Image)[0]?.props.source).toEqual({ uri: profile.avatarUrl });
    expect(textContent(account)).toContain('提醒設定讀取中；你的變更會在讀取完成後套用');
    expect(textContent(account)).not.toContain(profile.avatarUrl);
    header.unmount();
    account.unmount();
  });
});
