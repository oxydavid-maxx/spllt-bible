import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Android system bars over an open panel follow 夜間模式 (Pixel, 2026-11-05). What JS hands the platform, end to end:
// the app's status bar style (dark scheme → light icons, light scheme → dark icons, set by NightModeProvider), and a panel
// window that is edge-to-edge (both bars transparent; React Native then gives the navigation bar the icons of the night
// mode the app set) and is rebuilt after the style changed, so it copies the new status bar icons
// (ReactModalHostView.updateSystemAppearance runs only when a dialog is built).
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? React.createElement('Modal', props, props.children as React.ReactNode) : null),
  View: 'View', Text: 'Text', StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-secure-store', () => ({ getItem: () => null, setItem: () => undefined }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-router', () => ({
  DefaultTheme: { dark: false, colors: {}, fonts: {} },
  DarkTheme: { dark: true, colors: {}, fonts: {} },
  ThemeProvider: (props: { children?: React.ReactNode }) => props.children,
}));

import { AppModal, SYSTEM_BARS_SETTLE_MS } from '../../src/ui/AppModal';
import { NightModeProvider } from '../../src/ui/NightModeProvider';
import { createNightModeController, type NightModeChoice, type Scheme } from '../../src/services/nightMode';

function phone(initial: Scheme) {
  let scheme = initial;
  const listeners = new Set<(scheme: Scheme | null) => void>();
  return {
    flip(next: Scheme) { scheme = next; listeners.forEach((listener) => listener(next)); },
    system: { current: () => scheme, subscribe: (listener: (scheme: Scheme | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, apply: () => undefined },
  };
}
const noon = { now: () => new Date('2026-11-05T12:00:00'), setTimeout: () => 0, clearTimeout: () => undefined };

function app(choice: NightModeChoice, device: ReturnType<typeof phone>) {
  const controller = createNightModeController({ storage: { getItem: () => choice, setItem: () => undefined }, system: device.system, clock: noon });
  return React.createElement(NightModeProvider, { controller },
    React.createElement(AppModal, { visible: true, transparent: true, animationType: 'fade', onRequestClose: () => undefined }, React.createElement('Text', null, '更多閱讀工具')));
}

describe('system bars over an open panel (Android)', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { act(() => renderer?.unmount()); renderer = null; vi.useRealTimers(); });
  const statusIcons = () => renderer!.root.find((node) => String(node.type) === 'StatusBar').props.style;
  const panel = () => renderer!.root.find((node) => String(node.type) === 'Modal').props;

  it('opened while dark: light status bar icons, an edge-to-edge window built in dark', () => {
    act(() => { renderer = TestRenderer.create(app('dark', phone('light'))); });
    expect(statusIcons()).toBe('light');
    expect(panel()).toMatchObject({ statusBarTranslucent: true, navigationBarTranslucent: true, hardwareAccelerated: true });
  });

  it('opened while light: dark status bar icons, an edge-to-edge window built in light', () => {
    act(() => { renderer = TestRenderer.create(app('light', phone('dark'))); });
    expect(statusIcons()).toBe('dark');
    expect(panel()).toMatchObject({ statusBarTranslucent: true, navigationBarTranslucent: true, hardwareAccelerated: false });
  });

  it('switching while the panel is open: the icons change first, then the window is rebuilt to take them', () => {
    const device = phone('light');
    act(() => { renderer = TestRenderer.create(app('system', device)); });
    expect(statusIcons()).toBe('dark');
    expect(panel().hardwareAccelerated).toBe(false);
    // Light → dark: the status bar style becomes light icons at once; the panel window is rebuilt after it.
    act(() => device.flip('dark'));
    expect(statusIcons()).toBe('light');
    expect(panel().hardwareAccelerated).toBe(false);
    act(() => { vi.advanceTimersByTime(SYSTEM_BARS_SETTLE_MS); });
    expect(panel().hardwareAccelerated).toBe(true);
    expect(panel()).toMatchObject({ statusBarTranslucent: true, navigationBarTranslucent: true });
    // Dark → light: dark icons, and the window rebuilt again.
    act(() => device.flip('light'));
    expect(statusIcons()).toBe('dark');
    act(() => { vi.advanceTimersByTime(SYSTEM_BARS_SETTLE_MS); });
    expect(panel().hardwareAccelerated).toBe(false);
  });
});
