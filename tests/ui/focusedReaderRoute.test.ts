import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/reader' }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text' }));
vi.mock('expo-router', () => {
  const Screen = (props: Record<string, unknown>) => React.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => React.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return { Tabs, usePathname: () => navigation.pathname };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('Icon') }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('AccountEntryButton') }));

import TabsLayout from '../../app/(tabs)/_layout';
import { theme } from '../../src/ui/Theme';

describe('focused Reader route composition', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });

  it('keeps Reader out of the tab list while preserving tab navigation around it', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });

    const tabs = renderer.root.findAll((node) => String(node.type) === 'Tabs')[0];
    const reader = renderer.root.findAll((node) => String(node.type) === 'Screen').find((node) => node.props.name === 'reader');

    expect(tabs).toBeDefined();
    expect(reader).toBeDefined();
    expect(reader?.props.options).toMatchObject({ headerShown: false, tabBarAccessibilityLabel: '讀經閱讀器' });
    expect(reader?.props.options.tabBarStyle).not.toMatchObject({ display: 'none' });
    expect(reader?.props.options.href).toBeNull();
    expect(reader?.props.options.headerRight).toBeUndefined();
    expect(tabs.props.screenOptions.headerRight().type).toBeTypeOf('function');
    renderer.unmount();
  });

  it('hides the main tab bar only while Reader immersion is active, then restores it', async () => {
    const { setReaderImmersed } = await import('../../src/ui/readerImmersionState');
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const tabs = renderer.root.findAll((node) => String(node.type) === 'Tabs')[0];
    expect(tabs.props.screenOptions.tabBarStyle).toBeUndefined();
    act(() => { setReaderImmersed(true); });
    expect(renderer.root.findAll((node) => String(node.type) === 'Tabs')[0].props.screenOptions.tabBarStyle).toMatchObject({ display: 'none' });
    act(() => { setReaderImmersed(false); });
    expect(renderer.root.findAll((node) => String(node.type) === 'Tabs')[0].props.screenOptions.tabBarStyle).toBeUndefined();
    renderer.unmount();
  });

  it('marks the visible reading tab selected while the hidden Reader route is focused', () => {
    navigation.pathname = '/reader';
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const today = renderer.root.findAll((node) => String(node.type) === 'Screen').find((node) => node.props.name === 'today')!;
    const onPress = vi.fn();
    const pressable = today.props.options.tabBarButton({
      accessibilityLabel: '讀經入口',
      accessibilityRole: 'tab',
      'aria-selected': false,
      accessibilityState: { selected: false },
      onPress,
      onLongPress: vi.fn(),
      style: {},
      children: React.createElement('TabContent'),
    });
    expect(pressable.props.accessibilityState.selected).toBe(true);
    expect(pressable.props['aria-selected']).toBe(true);
    // Mirrors installed RN Pressable normalization: aria-selected ?? accessibilityState.selected.
    const nativeSelected = pressable.props['aria-selected'] ?? pressable.props.accessibilityState.selected;
    expect(nativeSelected).toBe(true);
    expect(pressable.props.onPress).toBe(onPress);
    expect(today.props.options.tabBarIcon({ color: theme.colors.muted, size: 20, focused: false }).props.color).toBe(theme.colors.primary);
    const label = today.props.options.tabBarLabel({ color: theme.colors.muted, focused: false, position: 'below' });
    expect(label.props.style.color).toBe(theme.colors.primary);
    expect(renderer.root.findAll((node) => String(node.type) === 'Screen').find((node) => node.props.name === 'progress')?.props.options.tabBarButton).toBeUndefined();

    act(() => {
      navigation.pathname = '/progress';
      renderer.update(React.createElement(TabsLayout));
    });
    const focusedProgress = renderer.root.findAll((node) => String(node.type) === 'Screen').find((node) => node.props.name === 'progress')!;
    expect(focusedProgress.props.options.tabBarButton).toBeUndefined();
    const inactiveToday = renderer.root.findAll((node) => String(node.type) === 'Screen').find((node) => node.props.name === 'today')!;
    const inactiveButton = inactiveToday.props.options.tabBarButton({
      accessibilityLabel: '讀經入口',
      accessibilityRole: 'tab',
      'aria-selected': false,
      accessibilityState: { selected: false },
      onPress: vi.fn(),
      onLongPress: vi.fn(),
      style: {},
      children: React.createElement('TabContent'),
    });
    expect(inactiveButton.props.accessibilityState.selected).toBe(false);
    expect((inactiveButton.props['aria-selected'] ?? inactiveButton.props.accessibilityState.selected)).toBe(false);
    expect(inactiveToday.props.options.tabBarIcon({ color: theme.colors.muted, size: 20, focused: false }).props.color).toBe(theme.colors.muted);
    expect(inactiveToday.props.options.tabBarLabel({ color: theme.colors.muted, focused: false, position: 'below' }).props.style.color).toBe(theme.colors.muted);
    renderer.unmount();
  });
});
