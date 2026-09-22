import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? require('react').createElement('Modal', props, props.children as never) : null),
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
  Keyboard: { isVisible: () => true, addListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' },
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  TextInput: primitive('TextInput'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('../../src/storage/mobileDatabase', () => ({
  openQingmuJournalStore: () => ({ get: () => null, save: (command: Record<string, unknown>) => command }),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { JournalPanel } from '../../src/ui/JournalPanel';

// An Android Modal is its own window, and that window does not resize when the keyboard opens. A
// panel with a fixed height therefore keeps every pixel it had and the keyboard simply covers the
// bottom of it: by the third line you are typing where you cannot see. The reader's action sheets
// already solved this, so the panel uses the same hook rather than a second copy of the idea.

function renderPanel() {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(JournalPanel, {
      visible: true, memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-20',
      dateLabel: '9月20日', newOperationId: () => 'op-1', onClose: () => undefined,
    } as never));
  });
  return tree;
}

const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : ((style ?? {}) as Record<string, unknown>);

describe('the keyboard never covers what is being written', () => {
  it('gives the panel room to shrink instead of a fixed height', () => {
    const sheet = renderPanel().root.findAll((node) => node.props?.accessibilityViewIsModal === true)[0];
    expect(flatten(sheet.props.style).height).toBeUndefined();
  });

  it('bounds the panel so it still reads as a panel and not a full screen', () => {
    const sheet = renderPanel().root.findAll((node) => node.props?.accessibilityViewIsModal === true)[0];
    expect(flatten(sheet.props.style).maxHeight).toBeDefined();
  });

  it('avoids the keyboard, and on Android only while the keyboard is actually up', () => {
    const avoider = renderPanel().root.findAll((node) => String(node.type) === 'KeyboardAvoidingView')[0];
    expect(avoider).toBeDefined();
    expect(avoider.props.behavior).toBe('padding');
    expect(avoider.props.enabled).toBe(true);
  });
});
