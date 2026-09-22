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
import type { NominationRound, RewardNomination } from '../../src/services/gamificationApiClient';

const NOW = Date.parse('2026-09-20T04:00:00.000Z');
const round = (patch: Partial<NominationRound> = {}): NominationRound => ({
  roundId: 'r1', title: '十月獎品', closesAt: Date.parse('2026-09-30T16:00:00.000Z'), phase: 'VOTING', ...patch,
});

const nomination = (patch: Partial<RewardNomination> = {}): RewardNomination => ({
  nominationId: 'n1', name: '電影票', displayName: '小明', status: 'OPEN',
  voteCount: 0, voted: false, mine: false, revision: 1, ...patch,
});

function render(props: Partial<React.ComponentProps<typeof NominationBoard>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(NominationBoard, {
      round: round(), nowMs: NOW, nominations: [nomination()], canManage: false,
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
    const { byLabel, text } = render({ onNominate, nominations: [] });
    act(() => { byLabel('獎品名稱').props.onChangeText('桌遊'); });
    act(() => { byLabel('提名獎品').props.onPress(); });
    expect(onNominate).toHaveBeenCalledWith('桌遊', '');
    expect(text()).not.toContain('"value":"桌遊"');
  });

  it('ignores an empty submission rather than creating a blank idea', () => {
    const onNominate = vi.fn();
    const { byLabel } = render({ onNominate, nominations: [] });
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

describe('the round is an election, not a suggestion box', () => {
  it('shows the title and how long is left', () => {
    const view = render();
    expect(view.text()).toContain('十月獎品');
    expect(view.text()).toContain('還有 11 天');
  });

  it('says what is happening once voting has closed', () => {
    const view = render({ round: round({ phase: 'DECIDING' }) });
    expect(view.text()).toContain('投票結束');
  });

  it('takes no more votes after the close', () => {
    const onVote = vi.fn();
    const view = render({ round: round({ phase: 'DECIDING' }), onVote });
    const control = view.byLabel('我也想要：電影票，目前 0 人');
    expect(control.props.accessibilityState.disabled).toBe(true);
  });

  it('offers the composer to somebody who has not used their one idea', () => {
    expect(render({ nominations: [] }).byLabel('獎品名稱')).toBeDefined();
  });

  it('takes the composer away once that idea is in', () => {
    // One each. The composer standing there is an invitation to do something that will be refused.
    expect(render({ nominations: [nomination({ mine: true })] }).byLabel('獎品名稱')).toBeUndefined();
  });

  it('takes the composer away when voting has closed', () => {
    expect(render({ nominations: [], round: round({ phase: 'DECIDING' }) }).byLabel('獎品名稱')).toBeUndefined();
  });

  it('shows no round at all when none is running', () => {
    expect(render({ round: null, nominations: [] }).byLabel('獎品名稱')).toBeUndefined();
  });
});

describe('what a price estimate is allowed to look like', () => {
  it('reads as a guess, beside the person who suggested it', () => {
    expect(render({ nominations: [nomination({ estimatedPoints: 75 })] }).text()).toContain('約 75 分');
  });

  it('says nothing when there is no estimate, rather than explaining itself', () => {
    const view = render({ nominations: [nomination()] });
    expect(view.text()).not.toContain('約');
    expect(view.text()).not.toContain('估');
  });

  it('puts the estimate where the 輔導 is about to type a price', () => {
    const view = render({ canManage: true, onDecide: () => undefined, nominations: [nomination({ estimatedPoints: 250 })] });
    expect(view.byLabel('電影票 的積分').props.placeholder).toBe('250');
  });
});

describe('an idea, and the words for it, belong to whoever put them there', () => {
  const withSuggestion = nomination({ mine: true, note: '桌遊', noteSuggestion: '大家聚會後可以一起玩的桌遊。' });

  it('offers the author the rewrite, with no obligation attached', () => {
    const onResolveSuggestion = vi.fn();
    const view = render({ nominations: [withSuggestion], onResolveSuggestion });
    expect(view.text()).toContain('大家聚會後可以一起玩的桌遊。');

    act(() => { view.byLabel('維持我寫的').props.onPress(); });
    expect(onResolveSuggestion).toHaveBeenCalledWith('n1', false);
  });

  it('takes it when the author wants it', () => {
    const onResolveSuggestion = vi.fn();
    const view = render({ nominations: [withSuggestion], onResolveSuggestion });
    act(() => { view.byLabel('採用這個說法').props.onPress(); });
    expect(onResolveSuggestion).toHaveBeenCalledWith('n1', true);
  });

  it('draws nothing of the sort on somebody else’s idea', () => {
    // The server does not send it either. This is the second of the two places it would show.
    const view = render({ nominations: [nomination({ mine: false, note: '桌遊' })], onResolveSuggestion: () => undefined });
    expect(view.byLabel('採用這個說法')).toBeUndefined();
  });

  it('lets the author take their idea back, and nobody else', () => {
    const onWithdraw = vi.fn();
    const mine = render({ nominations: [nomination({ mine: true })], onWithdraw });
    act(() => { mine.byLabel('撤回 電影票').props.onPress(); });
    expect(onWithdraw).toHaveBeenCalledWith('n1');

    expect(render({ nominations: [nomination({ mine: false })], onWithdraw }).byLabel('撤回 電影票')).toBeUndefined();
  });

  it('stops offering the withdrawal once voting has closed', () => {
    const view = render({ nominations: [nomination({ mine: true })], round: round({ phase: 'DECIDING' }), onWithdraw: () => undefined });
    expect(view.byLabel('撤回 電影票')).toBeUndefined();
  });
});

describe('three votes, said out loud rather than discovered', () => {
  it('disables each action while a board mutation is pending', () => {
    const view = render({ busy: true, canManage: true, onDecide: () => undefined, onCloseRound: () => undefined, onWithdraw: () => undefined, onResolveSuggestion: () => undefined, nominations: [nomination({ mine: true, noteSuggestion: '建議' })] });
    for (const label of ['採用這個說法', '維持我寫的', '撤回 電影票', '核准 電影票', '婉拒 電影票', '移除 電影票', '結束這一輪']) expect(view.byLabel(label).props.disabled).toBe(true);
  });
  it('offers no note rewrite decision after voting closes', () => {
    const view = render({ round: round({ phase: 'DECIDING' }), nominations: [nomination({ mine: true, noteSuggestion: '建議' })], onResolveSuggestion: () => undefined });
    expect(view.byLabel('採用這個說法')).toBeUndefined();
    expect(view.byLabel('維持我寫的')).toBeUndefined();
  });
  it('says how many are left before anybody spends one', () => {
    // A board of tick boxes reads as "tick what you like". This one is "choose three", and somebody
    // who thinks it is unlimited ticks everything — which is the same as not voting at all.
    expect(render({ votesLeft: 3, votesPerMember: 3 }).text()).toContain('選 3 個,還有 3 票');
  });

  it('counts down as they are spent', () => {
    expect(render({ votesLeft: 1 }).text()).toContain('還有 1 票');
  });

  it('says what to do instead of just going quiet when they run out', () => {
    expect(render({ votesLeft: 0 }).text()).toContain('先取消一票');
  });

  it('stops offering a vote there is none left for', () => {
    const board = render({ votesLeft: 0, nominations: [nomination({ name: '雞排' })] });
    expect(board.tree.root.findAll((node) => node.props?.disabled === true).length).toBeGreaterThan(0);
  });

  it('still lets a member take back one they already cast', () => {
    // Disabling the ticked ones too would strand somebody on a choice they have already regretted,
    // which is the opposite of what a limit is for.
    const board = render({ votesLeft: 0, nominations: [nomination({ name: '雞排', voted: true })] });
    const take = board.byLabel('取消想要：雞排，目前 0 人');
    expect(take).toBeDefined();
    expect(take.props.disabled).toBe(false);
  });

  it('says nothing about votes once the round stops taking them', () => {
    expect(render({ round: round({ phase: 'DECIDING' }), votesLeft: 2 }).text()).not.toContain('還有 2 票');
  });
});
