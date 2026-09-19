import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  Text: primitive('Text'),
  TextInput: primitive('TextInput'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { NominationBoard } from '../../src/ui/gamification/NominationBoard';
import type { RewardNomination } from '../../src/services/gamificationApiClient';

const nomination = (patch: Partial<RewardNomination> = {}): RewardNomination => ({
  nominationId: 'n1', name: '電影票', displayName: '小明', status: 'OPEN',
  voteCount: 0, voted: false, mine: false, revision: 1, ...patch,
});

function render(props: Partial<React.ComponentProps<typeof NominationBoard>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(NominationBoard, {
      nominations: [nomination()], canManage: false,
      onNominate: () => undefined, onVote: () => undefined, ...props,
    }));
  });
  const byLabel = (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0];
  const text = () => JSON.stringify(tree.toJSON());
  return { tree, byLabel, text };
}

describe('the board makes it clear whose idea a prize was', () => {
  it('names the person who suggested it', () => {
    expect(render().text()).toContain('小明 提名');
  });

  it('votes and un-votes through the same control', () => {
    const onVote = vi.fn();
    const { byLabel } = render({ onVote, nominations: [nomination({ voteCount: 3, voted: false })] });
    act(() => { byLabel('我也想要：電影票，目前 3 人').props.onPress(); });
    expect(onVote).toHaveBeenCalledWith('n1', true);

    const voted = render({ onVote, nominations: [nomination({ voteCount: 4, voted: true })] });
    act(() => { voted.byLabel('取消想要：電影票，目前 4 人').props.onPress(); });
    expect(onVote).toHaveBeenCalledWith('n1', false);
  });

  it('offers no vote control once a decision has been made', () => {
    const { byLabel } = render({ nominations: [nomination({ status: 'APPROVED' })] });
    expect(byLabel('我也想要：電影票，目前 0 人')).toBeUndefined();
    expect(render({ nominations: [nomination({ status: 'APPROVED' })] }).text()).toContain('已成為獎品');
  });

  it('keeps the 輔導 controls away from members', () => {
    expect(render({ onDecide: () => undefined }).byLabel('核准 電影票')).toBeUndefined();
    expect(render({ canManage: true, onDecide: () => undefined }).byLabel('核准 電影票')).toBeDefined();
  });

  // Approving without a price would create a prize nobody can save toward.
  it('will not approve until a price has been typed', () => {
    const onDecide = vi.fn();
    const { byLabel } = render({ canManage: true, onDecide });
    act(() => { byLabel('核准 電影票').props.onPress(); });
    expect(onDecide).not.toHaveBeenCalled();

    act(() => { byLabel('電影票 的積分').props.onChangeText('40'); });
    act(() => { byLabel('核准 電影票').props.onPress(); });
    expect(onDecide).toHaveBeenCalledWith('n1', 'approve', 1, 40);
  });

  it('clears the composer after submitting, so the next idea starts empty', () => {
    const onNominate = vi.fn();
    const { byLabel, text } = render({ onNominate });
    act(() => { byLabel('獎品名稱').props.onChangeText('桌遊'); });
    act(() => { byLabel('提名獎品').props.onPress(); });
    expect(onNominate).toHaveBeenCalledWith('桌遊', '');
    expect(text()).not.toContain('"value":"桌遊"');
  });

  it('ignores an empty submission rather than creating a blank idea', () => {
    const onNominate = vi.fn();
    const { byLabel } = render({ onNominate });
    act(() => { byLabel('提名獎品').props.onPress(); });
    expect(onNominate).not.toHaveBeenCalled();
  });
});

import { CommunityProgress } from '../../src/ui/gamification/CommunityProgress';

describe('the group line never turns a quiet week into an accusation', () => {
  const show = (props: { books: string[]; personDays: number | null }) => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(CommunityProgress, props)); });
    return JSON.stringify(tree.toJSON());
  };

  it('names the books the group has walked through', () => {
    expect(show({ books: ['提後', '多'], personDays: null })).toContain('一起走過：提後、多');
  });

  it('says nothing at all before the plan has started', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(CommunityProgress, { books: [], personDays: 5 })); });
    expect(tree.toJSON()).toBeNull();
  });

  it('omits the count entirely when the server withheld it', () => {
    const rendered = show({ books: ['提後'], personDays: null });
    expect(rendered).not.toContain('天次');
  });

  it('shows the count as a plain total, with no goal and nothing remaining', () => {
    const rendered = show({ books: ['提後'], personDays: 248 });
    expect(rendered).toContain('到目前一起讀了 248 天次');
    expect(rendered).not.toContain('目標');
    expect(rendered).not.toContain('還差');
  });
});
