import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal, controllable stand-in for expo-router's useFocusEffect. It runs the
// effect inside a real useEffect (post-commit, like the genuine hook) on mount and
// whenever the callback identity changes (deps changed while focused), and exposes
// triggerFocus() so a test can simulate the tab regaining focus without remounting.
const focusHarness = vi.hoisted(() => {
  let runner: (() => void) | null = null;
  return {
    setRunner(fn: (() => void) | null) { runner = fn; },
    triggerFocus() { runner?.(); },
  };
});

vi.mock('expo-router', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactRuntime.useEffect(() => {
        let cleanup = cb() || null;
        const run = () => {
          if (cleanup) cleanup();
          cleanup = cb() || null;
        };
        focusHarness.setRunner(run);
        return () => {
          if (cleanup) cleanup();
          focusHarness.setRunner(null);
        };
      }, [cb]);
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

let callSequence = 0;
const groupRequests = new Map<string, Array<{ promise: Promise<any>; resolve: (value: any) => void; reject: (reason?: unknown) => void; callIndex: number }>>();
vi.mock('../../src/services/apiClient', () => ({
  createApiClient: vi.fn(({ memberId }: { memberId: string }) => ({
    getGroups: () => {
      let resolve!: (value: any) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise((next, fail) => { resolve = next; reject = fail; });
      const callIndex = ++callSequence;
      const list = groupRequests.get(memberId) ?? [];
      list.push({ promise, resolve, reject, callIndex });
      groupRequests.set(memberId, list);
      return promise;
    },
  })),
}));

import { Text } from 'react-native';
import GroupsScreen from '../../app/(tabs)/groups';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

function profile(memberId: string, groupName: string) {
  return { groupId: `group:${memberId}`, groupName, rpgs: [{ rpgId: 'rpg', rpgName: 'RPG', openChatUrl: null, callUrl: null, callProvider: null, callScope: null, linkStatus: 'PENDING_UI_VERIFICATION', linkRevision: 1, standingRoom: true, meeting: null, roster: null, lastUpdatedAt: null }] };
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children ?? '')).join(' ');
}

function pendingCallsFor(memberId: string) {
  return groupRequests.get(memberId) ?? [];
}

describe('groups tab focus refresh', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });
  beforeEach(() => {
    clearAuthSession();
    groupRequests.clear();
    callSequence = 0;
  });

  it('refetches the group snapshot when the tab regains focus', async () => {
    act(() => { setAuthSession({ memberId: 'member:a', sessionToken: 'a-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    const calls = pendingCallsFor('member:a');
    expect(calls).toHaveLength(1);
    await act(async () => { calls[0].resolve(profile('member:a', 'A小組')); await Promise.resolve(); });
    expect(textContent(renderer)).toContain('A小組');

    // Simulate the user returning to My RPG by ordinary tab navigation (no remount).
    act(() => { focusHarness.triggerFocus(); });
    expect(pendingCallsFor('member:a')).toHaveLength(2);

    renderer.unmount();
  });

  it('keeps the previous snapshot when a focus refetch fails (offline)', async () => {
    act(() => { setAuthSession({ memberId: 'member:a', sessionToken: 'a-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    let calls = pendingCallsFor('member:a');
    await act(async () => { calls[0].resolve(profile('member:a', 'A小組')); await Promise.resolve(); });
    expect(textContent(renderer)).toContain('A小組');

    act(() => { focusHarness.triggerFocus(); });
    calls = pendingCallsFor('member:a');
    expect(calls).toHaveLength(2);
    await act(async () => { calls[1].reject(new Error('offline')); await Promise.resolve(); await Promise.resolve(); });

    expect(textContent(renderer)).toContain('A小組');
    renderer.unmount();
  });

  it('clears on a failed initial load with no prior snapshot for the session', async () => {
    act(() => { setAuthSession({ memberId: 'member:a', sessionToken: 'a-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    const calls = pendingCallsFor('member:a');
    await act(async () => { calls[0].reject(new Error('offline')); await Promise.resolve(); await Promise.resolve(); });

    expect(textContent(renderer)).not.toContain('A小組');
    renderer.unmount();
  });

  it('ignores a late focus-refetch response after the session has changed', async () => {
    act(() => { setAuthSession({ memberId: 'member:a', sessionToken: 'a-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(GroupsScreen)); });
    let calls = pendingCallsFor('member:a');
    await act(async () => { calls[0].resolve(profile('member:a', 'A小組')); await Promise.resolve(); });

    act(() => { focusHarness.triggerFocus(); });
    calls = pendingCallsFor('member:a');
    expect(calls).toHaveLength(2);
    const staleCall = calls[1];

    // Session changes to member B before the stale focus-refetch for member A resolves.
    act(() => { setAuthSession({ memberId: 'member:b', sessionToken: 'b-token' }); });
    await act(async () => { staleCall.resolve(profile('member:a', '過期資料')); await Promise.resolve(); await Promise.resolve(); });

    expect(textContent(renderer)).not.toContain('過期資料');
    renderer.unmount();
  });
});
