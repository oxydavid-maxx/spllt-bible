import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? require('react').createElement('Modal', props, props.children as never) : null),
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  TextInput: primitive('TextInput'), View: primitive('View'),
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
  Keyboard: { isVisible: () => false, addListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (props: Record<string, unknown>) => require('react').createElement('SafeAreaProvider', props, props.children as never),
  SafeAreaView: (props: Record<string, unknown>) => require('react').createElement('SafeAreaView', props, props.children as never),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { ActionSheet } from '../../src/ui/gamification/ActionSheet';

// Tapping outside a sheet should close it. That was missing everywhere except the footnote panel.
// But it must NOT close a sheet holding work in progress: a redemption being confirmed in front of
// a student, a reversal reason half typed, a camera mid-scan. This file pins both halves, and the
// per-sheet classification, so a sheet added later cannot quietly inherit the wrong one.

const render = (props: Record<string, unknown>) => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(ActionSheet, { visible: true, title: '測試', onClose: () => undefined, ...props } as never)); });
  return tree;
};

const backdropOf = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((node) => String(node.type) === 'Pressable')[0];

describe('an overlay closes when you tap away from it, unless something would be lost', () => {
  it('closes an informational sheet on an outside tap', () => {
    const onClose = vi.fn();
    const tree = render({ onClose, dismissOnOutsideTap: true });
    const backdrop = backdropOf(tree);
    expect(backdrop.props.accessibilityLabel).toBe('關閉測試');
    backdrop.props.onPress();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores an outside tap when the sheet holds work in progress', () => {
    const onClose = vi.fn();
    const backdrop = backdropOf(render({ onClose }));
    expect(backdrop.props.onPress).toBeUndefined();
    expect(backdrop.props.accessibilityLabel).toBeUndefined();
  });

  it('does not close when the tap lands on the sheet itself', () => {
    const onClose = vi.fn();
    const tree = render({ onClose, dismissOnOutsideTap: true, children: React.createElement('Text', null, '內容') });
    const swallow = tree.root.findAll((node) => String(node.type) === 'Pressable')[1];
    swallow.props.onPress();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('classifies every sheet on the points page, so a new one cannot inherit the wrong default', () => {
    const source = readFileSync(join(process.cwd(), 'app/(tabs)/progress.tsx'), 'utf8');
    const sheets = [...source.matchAll(/<ActionSheet visible=\{sheet === '(\w[\w-]*)'[^>]*?>/g)]
      .map((match) => ({ name: match[1], dismissible: match[0].includes('dismissOnOutsideTap') }));

    expect(Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet.dismissible]))).toEqual({
      menu: true,          // a list of choices
      qr: true,            // shows a code
      rewards: true,       // choosing applies immediately
      scan: false,         // camera mid-scan
      'admin-rewards': false, // typed name and price
      redeem: false,       // debits points in front of a student
      redemptions: false,  // a reversal reason being typed
      pending: false,      // finishing an unconfirmed transaction
    });
  });
});
