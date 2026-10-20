import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// The account page shows the installed version at the bottom in every state, including a profile
// that failed to load: a tester stuck there is exactly the one who needs to say which build they have.
const state = vi.hoisted(() => ({ profileLoaded: true }));
// The running JS: the copy inside the store build, or an update downloaded later (docs/eas-update.md).
const update = vi.hoisted(() => ({ isEmbeddedLaunch: true, updateId: null as string | null, createdAt: null as Date | null }));
vi.mock('expo-updates', () => ({
  get isEmbeddedLaunch() { return update.isEmbeddedLaunch; },
  get updateId() { return update.updateId; },
  get createdAt() { return update.createdAt; },
}));
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

  it('adds the downloaded update, so a tester can say which one they run', async () => {
    state.profileLoaded = true;
    Object.assign(update, { isEmbeddedLaunch: false, updateId: '0a1b2c3d-4e5f-4789-abcd-ef0123456789', createdAt: new Date(2026, 9, 20, 13, 5) });
    try {
      expect(await versionTexts()).toEqual(['版本 0.5.24 (47) · 更新 20261020-456789']);
    } finally {
      Object.assign(update, { isEmbeddedLaunch: true, updateId: null, createdAt: null });
    }
  });

  // EAS update IDs are UUIDv7: the front is the time, so two updates published hours apart share it
  // (20261020: preview 01a15891-… and production 01a158f0-… both read 01a158). The end is random.
  it('tells apart two updates published the same afternoon', async () => {
    state.profileLoaded = true;
    try {
      Object.assign(update, { isEmbeddedLaunch: false, updateId: '01a15891-2561-7d7e-aff1-574ccc8a8355', createdAt: new Date(2026, 9, 20, 17, 7) });
      const preview = await versionTexts();
      Object.assign(update, { updateId: '01a158f0-23ea-7b91-abca-86ca1fbff271', createdAt: new Date(2026, 9, 20, 18, 51) });
      const production = await versionTexts();
      expect([preview, production]).toEqual([['版本 0.5.24 (47) · 更新 20261020-8a8355'], ['版本 0.5.24 (47) · 更新 20261020-bff271']]);
    } finally {
      Object.assign(update, { isEmbeddedLaunch: true, updateId: null, createdAt: null });
    }
  });

  it('says nothing more while the store build runs its own copy', async () => {
    state.profileLoaded = true;
    Object.assign(update, { isEmbeddedLaunch: true, updateId: '0a1b2c3d-4e5f-4789-abcd-ef0123456789', createdAt: new Date(2026, 9, 1) });
    try {
      expect(await versionTexts()).toEqual(['版本 0.5.24 (47)']);
    } finally {
      Object.assign(update, { isEmbeddedLaunch: true, updateId: null, createdAt: null });
    }
  });
});
