import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// The account page shows the installed version at the bottom in every state, including a profile
// that failed to load: a tester stuck there is exactly the one who needs to say which build they have.
const state = vi.hoisted(() => ({ profileLoaded: true }));
vi.mock('react-native', () => ({
  Image: 'Image', Linking: { openURL: vi.fn(async () => undefined), openSettings: vi.fn() }, Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '0.5.24', nativeBuildVersion: '47' }));
vi.mock('../../src/services/authSession', () => ({
  clearAuthSession: vi.fn(), retryAuthProfile: vi.fn(),
  useAuthSnapshot: () => state.profileLoaded
    ? { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'memory-only' }, profileStatus: 'ready',
      profile: { memberId: 'member:one', displayName: '小明', avatarUrl: null, groupId: 'G01', groupName: 'A小組' } }
    : { status: 'signed-in', session: { memberId: 'member:one', sessionToken: 'memory-only' }, profileStatus: 'error', profile: null },
}));
vi.mock('../../src/services/reminderRuntime', () => ({ getReminderRuntimeOwner: () => null, useReminderRuntimeSnapshot: () => ({}) }));
vi.mock('../../src/ui/ReminderSettings', () => ({ ReminderSettings: () => null }));
vi.mock('../../src/ui/congregation/CongregationSetting', () => ({ CongregationSetting: () => null }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => null }));
import { AccountSurface } from '../../src/ui/accountSurfaceComponent';

async function versionTexts(): Promise<string[]> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
  const texts = renderer.root.findAll(node => String(node.type) === 'Text' && String(node.props.children).startsWith('版本')).map(node => String(node.props.children));
  await act(async () => { renderer.unmount(); });
  return texts;
}

describe('account page version', () => {
  it('shows the installed version to a signed-in member', async () => {
    state.profileLoaded = true;
    expect(await versionTexts()).toEqual(['版本 0.5.24 (47)']);
  });

  it('still shows it when the profile failed to load', async () => {
    state.profileLoaded = false;
    expect(await versionTexts()).toEqual(['版本 0.5.24 (47)']);
  });
});
