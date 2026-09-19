import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Modal: (props: Record<string, unknown>) => (props.visible ? require('react').createElement('Modal', props, props.children as never) : null),
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

// The panel covers the reader while it is open, so nobody ever selects a verse with it up: the real
// sequence is read, copy, then open the journal. A copied verse is therefore offered on the next
// open rather than inserted, because someone who copied a verse for their clipboard should not find
// it pasted into their journal.

function render(props: Partial<React.ComponentProps<typeof JournalPanel>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(JournalPanel, {
      visible: true, memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-19',
      dateLabel: '9月19日', newOperationId: () => 'op-1', onClose: () => undefined, ...props,
    } as never));
  });
  return {
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
    text: () => JSON.stringify(tree.toJSON()),
  };
}

describe('a copied verse is offered, never pasted in behind your back', () => {
  it('offers nothing when no verse has been copied', () => {
    expect(render().byLabel('插入剛複製的經文')).toBeUndefined();
  });

  it('offers the verse when one was copied before the panel opened', () => {
    const panel = render({ pendingQuote: '「神賜給我們的不是膽怯的心」提後 1:7' });
    expect(panel.byLabel('插入剛複製的經文')).toBeDefined();
    expect(panel.text()).toContain('提後 1:7');
  });

  it('does not put the verse in the text box until it is tapped', () => {
    const panel = render({ pendingQuote: '「神賜給我們的不是膽怯的心」提後 1:7' });
    expect(panel.byLabel('靈修日記').props.value).toBe('');
  });

  it('inserts it on one tap and stops offering', () => {
    const onQuoteConsumed = vi.fn();
    const panel = render({ pendingQuote: '「神賜給我們的不是膽怯的心」提後 1:7', onQuoteConsumed });
    act(() => { panel.byLabel('插入剛複製的經文').props.onPress(); });

    expect(panel.byLabel('靈修日記').props.value).toContain('提後 1:7');
    expect(panel.byLabel('插入剛複製的經文')).toBeUndefined();
    expect(onQuoteConsumed).toHaveBeenCalledOnce();
  });
});
