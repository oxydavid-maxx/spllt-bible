import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { RewardGoalCard } from '../../src/ui/gamification/RewardGoalCard';
import { RewardControls } from '../../src/ui/gamification/RewardControls';
import type { Reward } from '../../src/services/gamificationApiClient';

const movie: Reward = { rewardId: 'r-movie', name: '電影票', costPoints: 75, active: true, revision: 1 };

function render(props: Partial<React.ComponentProps<typeof RewardGoalCard>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(React.createElement(RewardGoalCard, {
      target: movie, redeemableBalance: 6, earnedTotal: 6, rewards: [movie],
      canEditTarget: true, onChooseTarget: () => undefined, ...props,
    } as never));
  });
  return {
    root: tree.root,
    text: () => JSON.stringify(tree.toJSON()),
    byLabel: (label: string) => tree.root.findAll((node) => node.props?.accessibilityLabel === label)[0],
  };
}

describe('the goal reads across the card instead of hiding in a ring', () => {
  it('states the fraction where a person reads it, not inside a 72dp circle', () => {
    const card = render();
    const bar = card.byLabel('兌換進度');
    expect(bar).toBeDefined();
    expect(card.text()).toContain('6/75 分');
  });

  it('keeps no ring, so the right half is no longer empty', () => {
    expect(render().root.findAll((node) => String(node.type) === 'Svg')).toHaveLength(0);
  });
});

describe('tapping the prize you are already saving for', () => {
  // A second reward on purpose: the shelf only renders when it offers a choice, so a one-reward
  // catalogue whose reward is already the target has no card to tap.
  const snack: Reward = { rewardId: 'r-snack', name: '雞排', costPoints: 25, active: true, revision: 1 };

  it('does not ask the server to set the target it already has', () => {
    const onChooseTarget = vi.fn();
    const card = render({ onChooseTarget, rewards: [movie, snack] });
    act(() => { card.byLabel('目前目標：電影票 75 分').props.onPress(); });
    expect(onChooseTarget).not.toHaveBeenCalled();
  });

  it('still changes to a different prize', () => {
    const onChooseTarget = vi.fn();
    const card = render({ onChooseTarget, rewards: [movie, snack] });
    act(() => { card.byLabel('設為目標：雞排 25 分').props.onPress(); });
    expect(onChooseTarget).toHaveBeenCalledWith('r-snack');
  });

  it('marks the current goal as selected for a screen reader', () => {
    const card = render({ rewards: [movie, snack] });
    expect(card.byLabel('目前目標：電影票 75 分').props.accessibilityState.selected).toBe(true);
  });
});

describe('the shelf appears only when it has something to offer', () => {
  const popcorn: Reward = { rewardId: 'r-popcorn', name: '爆米花', costPoints: 40, active: true, revision: 1 };

  it('is hidden when the only reward on it is the one already chosen', () => {
    // What the points page looked like on the device: 目標獎品/電影票/7 of 75 with a full-width bar,
    // and then a 116dp card repeating 電影票, 75 分 and the same progress, with the rest of the row
    // empty. A shelf offering the choice you have already made is not a choice.
    const card = render({ target: movie, rewards: [movie] });
    expect(card.byLabel('獎品架')).toBeUndefined();
  });

  it('appears when a second reward gives the member somewhere else to go', () => {
    const card = render({ target: movie, rewards: [movie, popcorn] });
    expect(card.byLabel('獎品架')).toBeDefined();
  });

  it('appears for a single reward that has not been chosen yet', () => {
    const card = render({ target: null, rewards: [movie] });
    expect(card.byLabel('獎品架')).toBeDefined();
  });

  it('opens the existing picker from the main goal even when its sole reward is already selected', () => {
    const openPicker = vi.fn();
    const alternate: Reward = { rewardId: 'r-alternate', name: '雞排', costPoints: 25, active: true, revision: 1 };
    const card = render({ target: movie, rewards: [movie], onOpenPicker: openPicker });
    const goal = card.byLabel('目標獎品：電影票 75 分，開啟獎品選擇');
    expect(goal.props.accessibilityRole).toBe('button');
    expect(card.text()).toContain('更換目標 ›');
    act(() => { goal.props.onPress(); });
    expect(openPicker).toHaveBeenCalledTimes(1);

    const otherChoices = render({ target: movie, rewards: [movie, alternate], onOpenPicker: openPicker });
    const otherGoal = otherChoices.byLabel('目標獎品：電影票 75 分，開啟獎品選擇');
    expect(otherGoal.findAll((node) => String(node.type) === 'Pressable')).toHaveLength(1);
    expect(otherChoices.byLabel('獎品架')).toBeDefined();
  });

  it('shows the selected sole active reward immediately in the existing picker', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(RewardControls, { rewards: [movie, { ...movie, rewardId: 'retired', active: false }], selectedRewardId: movie.rewardId, canEdit: true })); });
    const choices = tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio');
    expect(choices).toHaveLength(1);
    expect(choices[0].props.accessibilityState.selected).toBe(true);
  });

  it('ignores retired rewards when deciding, so a shelf of one live reward stays hidden', () => {
    const retired: Reward = { ...popcorn, active: false };
    const card = render({ target: movie, rewards: [movie, retired] });
    expect(card.byLabel('獎品架')).toBeUndefined();
  });
});
