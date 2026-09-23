import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ replace: vi.fn(), setDate: vi.fn() }));
vi.mock('expo-router', () => {
  const runtime = require('react') as typeof React;
  const Screen = (props: Record<string, unknown>) => runtime.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => runtime.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return { Tabs, router: { replace: boundary.replace }, useFocusEffect: (callback: React.EffectCallback) => runtime.useEffect(callback, [callback]) };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('Icon') }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('AccountEntryButton') }));
vi.mock('../../src/ui/readingSession', () => ({ setSelectedReadingDate: boundary.setDate }));

import TodayScreen from '../../app/(tabs)/today';
import TabsLayout from '../../app/(tabs)/_layout';

const all = (renderer: TestRenderer.ReactTestRenderer, type: string) => renderer.root.findAll(node => String(node.type) === type);
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
    expect(screens.filter(node => node.props.options.href !== null).map(node => node.props.name)).toEqual(['today', 'progress', 'announcements', 'journal']);
    const reader = screens.find(node => node.props.name === 'reader');
    expect(reader?.props.options.href).toBeNull();
    expect(reader?.props.options.tabBarStyle).toBeUndefined();
    act(() => renderer.unmount());
  });
});
