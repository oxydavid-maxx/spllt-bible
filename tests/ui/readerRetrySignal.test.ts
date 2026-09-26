import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create } from 'react-test-renderer';

// The SDK reader retries a chapter that failed to load whenever this counter changes. A read that
// failed while the reader was out of sight (a sign-in on the journal tab, reproduced on a Pixel on
// 2026-09-26) must recover the moment the member looks at the reader again.

const appState = vi.hoisted(() => ({ listeners: new Set<(state: string) => void>() }));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));

import { useReaderRetrySignal } from '../../src/ui/readerRetrySignal';

function mount(focused: boolean) {
  const seen = { signal: -1 };
  function Probe({ focused: isFocused }: { focused: boolean }) {
    seen.signal = useReaderRetrySignal(isFocused);
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(Probe, { focused })); });
  return {
    signal: () => seen.signal,
    setFocused: (next: boolean) => act(() => { renderer.update(React.createElement(Probe, { focused: next })); }),
  };
}
const emit = (state: string) => act(() => { appState.listeners.forEach((listener) => listener(state)); });

beforeEach(() => { appState.listeners.clear(); });

describe('the reader asks the SDK to retry when it comes back into view', () => {
  it('does not retry on first mount', () => {
    expect(mount(true).signal()).toBe(0);
  });

  it('bumps each time the reader tab regains focus, and not when it loses it', () => {
    const hook = mount(false);
    hook.setFocused(true);
    expect(hook.signal()).toBe(1);
    hook.setFocused(false);
    expect(hook.signal()).toBe(1);
    hook.setFocused(true);
    expect(hook.signal()).toBe(2);
  });

  it('bumps when the app returns to the foreground while the reader is showing', () => {
    const hook = mount(true);
    emit('background');
    expect(hook.signal()).toBe(0);
    emit('active');
    expect(hook.signal()).toBe(1);
  });

  it('ignores the app returning while another tab is showing; regaining focus covers it', () => {
    const hook = mount(false);
    emit('active');
    expect(hook.signal()).toBe(0);
    expect(appState.listeners.size).toBe(0);
  });
});
