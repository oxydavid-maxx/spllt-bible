import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => {
  const Screen = (props: Record<string, unknown>) => React.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => React.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return { Tabs };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('Icon') }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('AccountEntryButton') }));

import TabsLayout from '../../app/(tabs)/_layout';

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
});
