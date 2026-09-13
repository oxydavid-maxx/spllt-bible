import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// groups.tsx now refetches on tab focus via expo-router's useFocusEffect (F-GROUPS-REFRESH-1);
// stub it to still run the effect once on mount (and again if its callback identity changes),
// matching the previous mount-effect behaviour these tests exercise, without loading the real
// expo-router -> react-native module chain (which is not vitest/Flow-syntax safe here).
vi.mock('expo-router', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactRuntime.useEffect(() => cb(), [cb]);
    },
  };
});
vi.mock('../../src/ui/GroupCard', () => ({ GroupCard: ({ groupName }: { groupName: string }) => React.createElement('GroupCard', { groupName }) }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixture-id') }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));
vi.mock('expo-modules-core', () => ({ EventEmitter: class {}, NativeModulesProxy: {}, requireNativeModule: vi.fn(), requireOptionalNativeModule: vi.fn(), Platform: { OS: 'test' } }));
vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: (value: unknown) => value },
  Text: 'Text',
  View: 'View',
}));

const groupRequests = new Map<string, { promise: Promise<any>; resolve: (value: any) => void }>();
vi.mock('../../src/services/apiClient', () => ({
  createApiClient: vi.fn(({ memberId }: { memberId: string }) => ({
    getGroups: () => {
      let resolve!: (value: any) => void;
      const promise = new Promise((next) => { resolve = next; });
      groupRequests.set(memberId, { promise, resolve });
      return promise;
    },
  })),
}));

import { Text } from 'react-native';
import GroupsScreen from '../../app/(tabs)/groups';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

function profile(memberId: string, groupName: string) {
  return { groupId: `group:${memberId}`, groupName, rpgs: [{ rpgId: 'rpg', rpgName: 'RPG', openChatUrl: null, callUrl: null, callProvider: null, callScope: null, linkStatus: 'PENDING_UI_VERIFICATION', linkRevision: 1, standingRoom: true, meeting: null, roster: null, lastUpdatedAt: null }], };
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children ?? '')).join(' ');
}

describe('mounted authenticated group boundary', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });
  beforeEach(() => {
    clearAuthSession();
    groupRequests.clear();
  });

  it('clears the previous member group surface immediately on logout', async () => {
    act(() => { setAuthSession({ memberId: 'member:old', sessionToken: 'old-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    await act(async () => { groupRequests.get('member:old')?.resolve(profile('member:old', '舊帳戶小組')); await Promise.resolve(); });
    expect(textContent(renderer)).toContain('舊帳戶小組');
    act(() => { clearAuthSession(); });
    expect(textContent(renderer)).not.toContain('舊帳戶小組');
    renderer.unmount();
  });

  it('does not keep member A group data visible while member B is hydrating', async () => {
    act(() => { setAuthSession({ memberId: 'member:a', sessionToken: 'a-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    await act(async () => { groupRequests.get('member:a')?.resolve(profile('member:a', 'A小組')); await Promise.resolve(); });
    act(() => { setAuthSession({ memberId: 'member:b', sessionToken: 'b-token' }); });
    expect(textContent(renderer)).not.toContain('A小組');
    renderer.unmount();
  });
});
