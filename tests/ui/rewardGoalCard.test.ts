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
  it('does not ask the server to set the target it already has', () => {
    const onChooseTarget = vi.fn();
    const card = render({ onChooseTarget });
    act(() => { card.byLabel('目前目標：電影票 75 分').props.onPress(); });
    expect(onChooseTarget).not.toHaveBeenCalled();
  });

  it('still changes to a different prize', () => {
    const onChooseTarget = vi.fn();
    const snack: Reward = { rewardId: 'r-snack', name: '雞排', costPoints: 25, active: true, revision: 1 };
    const card = render({ onChooseTarget, rewards: [movie, snack] });
    act(() => { card.byLabel('設為目標：雞排 25 分').props.onPress(); });
    expect(onChooseTarget).toHaveBeenCalledWith('r-snack');
  });

  it('marks the current goal as selected for a screen reader', () => {
    expect(render().byLabel('目前目標：電影票 75 分').props.accessibilityState.selected).toBe(true);
  });
});
