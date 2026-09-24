import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ replace: vi.fn(), setDate: vi.fn(), todayTabPress: vi.fn(), setDiaryDate: vi.fn(), selectedDate: '2026-09-12', pathname: '/today' }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text' }));
vi.mock('expo-router', () => {
  const runtime = require('react') as typeof React;
  const Screen = (props: Record<string, unknown>) => runtime.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => runtime.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return { Tabs, router: { replace: boundary.replace }, useFocusEffect: (callback: React.EffectCallback) => runtime.useEffect(callback, [callback]), usePathname: () => boundary.pathname };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('Icon') }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('AccountEntryButton') }));
vi.mock('../../src/ui/readingSession', () => ({
  setSelectedReadingDate: boundary.setDate,
  requestTodayReaderTabPress: boundary.todayTabPress,
  setJournalEntryDate: boundary.setDiaryDate,
  getReadingSessionSnapshot: () => ({ selectedDate: boundary.selectedDate }),
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-out', session: null, epoch: 0 }) }));

import TodayScreen from '../../app/(tabs)/today';
import TabsLayout from '../../app/(tabs)/_layout';

const all = (renderer: TestRenderer.ReactTestRenderer, type: string) => renderer.root.findAll(node => String(node.type) === type);
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const message = String(args[0] ?? '');
    if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return;
    originalError(...args);
  };
});
afterAll(() => { console.error = originalError; });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-23T04:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('reading tab entry', () => {
  it('uses Taipei today and opens Reader only when the reading tab route focuses', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(TodayScreen)); });
    expect(boundary.setDate).toHaveBeenCalledExactlyOnceWith('2026-09-23');
    expect(boundary.replace).toHaveBeenCalledExactlyOnceWith('/reader');
    act(() => renderer.unmount());
  });

  it('keeps four visible tabs and leaves the hidden Reader route able to show the tab bar', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const screens = all(renderer, 'Screen');
    const visibleScreens = screens.filter(node => node.props.options.href !== null);
    expect(visibleScreens.map(node => node.props.name)).toEqual(['announcements', 'today', 'progress', 'journal']);
    expect(visibleScreens.map(node => node.props.options.title)).toEqual(['公告', '讀經', '積分', '日記']);
    expect(all(renderer, 'Tabs')[0].props.initialRouteName).toBe('today');
    const reader = screens.find(node => node.props.name === 'reader');
    expect(reader?.props.options.href).toBeNull();
    expect(reader?.props.options.tabBarStyle).toBeUndefined();
    act(() => renderer.unmount());
  });

  it('returns from Diary to the existing Reader session without resetting it to today', () => {
    boundary.pathname = '/journal';
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const tabs = all(renderer, 'Tabs')[0];
    const listeners = tabs.props.screenListeners as (input: { route: { name: string } }) => { tabPress?: (event: { defaultPrevented: boolean; preventDefault?: () => void }) => void };
    const press = listeners({ route: { name: 'today' } }).tabPress;
    expect(press).toBeDefined();
    const event = { defaultPrevented: false, preventDefault: vi.fn() };
    act(() => press!(event));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(boundary.replace).toHaveBeenCalledExactlyOnceWith('/reader');
    expect(boundary.todayTabPress).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('opens Diary on the selected Reader task date, but on Taipei today from other tabs', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const tabs = all(renderer, 'Tabs')[0];
    const listeners = tabs.props.screenListeners as (input: { route: { name: string } }) => { tabPress?: (event: { defaultPrevented: boolean }) => void };
    boundary.pathname = '/reader';
    act(() => renderer.update(React.createElement(TabsLayout)));
    const readerListener = all(renderer, 'Tabs')[0].props.screenListeners as typeof listeners;
    act(() => readerListener({ route: { name: 'journal' } }).tabPress!({ defaultPrevented: false }));
    expect(boundary.setDiaryDate).toHaveBeenLastCalledWith('2026-09-12');

    boundary.pathname = '/progress';
    act(() => renderer.update(React.createElement(TabsLayout)));
    const progressListener = all(renderer, 'Tabs')[0].props.screenListeners as typeof listeners;
    act(() => progressListener({ route: { name: 'journal' } }).tabPress!({ defaultPrevented: false }));
    expect(boundary.setDiaryDate).toHaveBeenLastCalledWith('2026-09-23');
    act(() => renderer.unmount());
  });
});
