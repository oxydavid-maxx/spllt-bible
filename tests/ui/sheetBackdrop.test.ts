import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? require('react').createElement('Modal', props, props.children as never) : null),
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  View: primitive('View'),
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
  Keyboard: { isVisible: () => false, addListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (props: Record<string, unknown>) => require('react').createElement('SafeAreaProvider', props, props.children as never),
  SafeAreaView: (props: Record<string, unknown>) => require('react').createElement('SafeAreaView', props, props.children as never),
}));

import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { ActionSheet } from '../../src/ui/gamification/ActionSheet';

// A Pressable is an accessibility element, and iOS hides every descendant of an accessibility element. A sheet
// nested inside its tappable backdrop was therefore one "關閉…" button to VoiceOver — and to XCUITest, which
// Maestro drives — with none of its actions reachable. Android's TalkBack still reached them, so only iOS broke.

const pressableAncestor = (node: ReactTestInstance) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (String(parent.type) === 'Pressable') return parent;
  return null;
};

describe('sheet actions are reachable by assistive technology on iOS', () => {
  it('does not nest an action sheet inside its backdrop', () => {
    const onClose = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(ActionSheet, { visible: true, title: '積分操作', onClose, dismissOnOutsideTap: true, actions: [{ label: '我的好友 QR', onPress: () => undefined }] })); });
    const action = tree.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '我的好友 QR');
    expect(pressableAncestor(action)).toBeNull();
    const backdrop = tree.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '關閉積分操作');
    backdrop.props.onPress();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('never wraps a sheet in a tap-swallowing Pressable, the marker of a sheet nested in its backdrop', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
    });
    const offenders = [...files('src'), ...files('app')].filter((path) => readFileSync(path, 'utf8').includes('onPress={() => undefined}'));
    expect(offenders).toEqual([]);
  });
});
