import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// The root of 夜間模式: whatever the controller decides reaches every screen at once, the navigation bars and the
// status bar included, without remounting anything (a remount would throw the reader back to the chapter top).
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItem: () => null, setItem: () => undefined }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-router', () => ({
  DefaultTheme: { dark: false, colors: { primary: 'p', background: 'b', card: 'c', text: 't', border: 'r', notification: 'n' }, fonts: {} },
  DarkTheme: { dark: true, colors: { primary: 'p', background: 'b', card: 'c', text: 't', border: 'r', notification: 'n' }, fonts: {} },
  ThemeProvider: (props: { value: unknown; children?: React.ReactNode }) => React.createElement('NavigationTheme', props, props.children),
}));

import { NightModeProvider } from '../../src/ui/NightModeProvider';
import { useColors } from '../../src/ui/useAppTheme';
import { useNightMode } from '../../src/ui/nightModeContext';
import { createNightModeController, type NightModeClock, type Scheme } from '../../src/services/nightMode';
import { darkColors, lightColors } from '../../src/ui/Theme';

function phone(initial: Scheme) {
  let scheme = initial;
  const listeners = new Set<(scheme: Scheme | null) => void>();
  return {
    flip(next: Scheme) { scheme = next; listeners.forEach((listener) => listener(next)); },
    system: { current: () => scheme, subscribe: (listener: (scheme: Scheme | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, apply: () => undefined },
  };
}
const noon: NightModeClock = { now: () => new Date('2026-11-04T12:00:00'), setTimeout: () => 0, clearTimeout: () => undefined };

let mounts = 0;
let lastChoice: ReturnType<typeof useNightMode> | null = null;
function Screen() {
  React.useEffect(() => { mounts += 1; }, []);
  const colors = useColors();
  lastChoice = useNightMode();
  return React.createElement('View', { testID: 'page', style: { backgroundColor: colors.background } });
}

describe('NightModeProvider', () => {
  it('跟手機: the phone switching to dark turns every screen dark at once, without remounting it', async () => {
    const device = phone('light');
    const controller = createNightModeController({ storage: { getItem: () => 'system', setItem: () => undefined }, system: device.system, clock: noon });
    let renderer!: TestRenderer.ReactTestRenderer;
    mounts = 0;
    await act(async () => { renderer = TestRenderer.create(React.createElement(NightModeProvider, { controller }, React.createElement(Screen))); });
    const page = () => renderer.root.find((node) => node.props.testID === 'page');
    const navigation = () => renderer.root.find((node) => String(node.type) === 'NavigationTheme');
    const statusBar = () => renderer.root.find((node) => String(node.type) === 'StatusBar');
    expect(page().props.style.backgroundColor).toBe(lightColors.background);
    expect(statusBar().props.style).toBe('dark');
    act(() => device.flip('dark'));
    expect(page().props.style.backgroundColor).toBe(darkColors.background);
    expect(navigation().props.value.dark).toBe(true);
    expect(navigation().props.value.colors.card).toBe(darkColors.surface);
    expect(statusBar().props.style).toBe('light');
    expect(mounts).toBe(1);
    renderer.unmount();
  });

  it('a choice made on a screen applies everywhere and is what the screens read back', async () => {
    const device = phone('light');
    const stored = new Map<string, string>();
    const controller = createNightModeController({ storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } }, system: device.system, clock: noon });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(NightModeProvider, { controller }, React.createElement(Screen))); });
    expect(lastChoice?.choice).toBe('auto');
    act(() => lastChoice!.setChoice('dark'));
    expect(lastChoice?.choice).toBe('dark');
    expect(renderer.root.find((node) => node.props.testID === 'page').props.style.backgroundColor).toBe(darkColors.background);
    expect([...stored.values()]).toEqual(['dark']);
    renderer.unmount();
  });
});
