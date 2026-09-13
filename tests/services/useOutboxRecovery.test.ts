import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const appStateFixture = vi.hoisted(() => ({
  currentState: 'active' as string,
  listeners: new Set<(state: string) => void>(),
}));

vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return appStateFixture.currentState; },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      appStateFixture.listeners.add(callback);
      return { remove: () => appStateFixture.listeners.delete(callback) };
    },
  },
}));

import { useOutboxRecovery } from '../../src/services/useOutboxRecovery';

function emitAppState(state: string): void {
  appStateFixture.currentState = state;
  appStateFixture.listeners.forEach((listener) => listener(state));
}

function Harness(props: { memberId: string | null; sessionToken: string | null; flush: (send: (command: unknown) => Promise<unknown>, memberId?: string) => Promise<unknown[]> }) {
  useOutboxRecovery({
    memberId: props.memberId,
    sessionToken: props.sessionToken,
    planId: 'church-2026-09',
    taskDate: '2026-09-10',
    getRepository: () => ({
      get: () => ({ memberId: props.memberId ?? '', planId: 'church-2026-09', taskDate: '2026-09-10', status: 'UNREPORTED', revision: 0, syncStatus: 'PENDING_SAVE' }),
      flush: props.flush as never,
    }),
    getClient: () => ({ saveCompletion: vi.fn() as never }),
    getSession: () => (props.memberId ? { memberId: props.memberId, sessionToken: props.sessionToken ?? '' } : null),
    isCurrentAuthSession: (session) => !!session && session.memberId === props.memberId,
    onRecovered: () => {},
  });
  return null;
}

describe('useOutboxRecovery AppState wiring', () => {
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      const message = String(args[0] ?? '');
      if (message.includes('testing environment is not configured to support act')) return;
      originalError(...args);
    };
  });
  afterAll(() => { console.error = originalError; });
  afterEach(() => {
    appStateFixture.listeners.clear();
    appStateFixture.currentState = 'active';
  });

  it('flushes once on mount while active, and once more per active transition', async () => {
    const flush = vi.fn().mockResolvedValue([]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { memberId: 'member-1', sessionToken: 'tok', flush }));
    });
    expect(flush).toHaveBeenCalledTimes(1);

    await act(async () => { emitAppState('background'); });
    expect(flush).toHaveBeenCalledTimes(1); // backgrounding must not itself trigger a flush

    await act(async () => { emitAppState('active'); });
    expect(flush).toHaveBeenCalledTimes(2);

    renderer.unmount();
  });

  it('stops sending for the previous member once memberId/session changes, and never sends for signed-out', async () => {
    const flush = vi.fn().mockResolvedValue([]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, { memberId: 'member-1', sessionToken: 'tok', flush }));
    });
    expect(flush).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(React.createElement(Harness, { memberId: null, sessionToken: null, flush }));
    });
    const callsAfterSignOut = flush.mock.calls.length;

    await act(async () => { emitAppState('active'); });
    expect(flush.mock.calls.length).toBe(callsAfterSignOut); // no recovery controller exists once signed out

    renderer.unmount();
  });
});
