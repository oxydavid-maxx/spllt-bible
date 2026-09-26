import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { JournalSaveBar } from '../../src/ui/JournalSaveBar';

// 光佑 2026-09-26: after writing, members did not know what to do. The journal saves on its own, but
// the page showed no Save button and no sign that anything was saved.

function render(props: React.ComponentProps<typeof JournalSaveBar>) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(JournalSaveBar, props)); });
  return {
    button: () => tree.root.findAll((node) => node.props?.accessibilityRole === 'button')[0],
    text: () => JSON.stringify(tree.toJSON()),
    empty: () => tree.toJSON() === null,
  };
}

describe('the journal Save button and its label', () => {
  it('offers Save while the text is not saved, and saves on press', () => {
    const onSave = vi.fn();
    const bar = render({ status: 'unsaved', savedAt: null, onSave });
    expect(bar.text()).toContain('尚未儲存');
    expect(bar.button().props.accessibilityLabel).toBe('儲存日記');
    expect(bar.button().props.disabled).toBe(false);
    act(() => { bar.button().props.onPress(); });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('shows when it was saved, in Taipei time, and greys the button out', () => {
    const bar = render({ status: 'saved', savedAt: '2026-09-26T00:58:00.000Z', onSave: () => undefined });
    expect(bar.text()).toContain('✓ 已儲存 08:58');
    expect(bar.button().props.disabled).toBe(true);
    expect(bar.button().props.accessibilityState).toEqual({ disabled: true });
    expect(bar.text()).toContain('已儲存');
  });

  it('stays out of the way before anything is written', () => {
    expect(render({ status: 'empty', savedAt: null, onSave: () => undefined }).empty()).toBe(true);
  });
});
