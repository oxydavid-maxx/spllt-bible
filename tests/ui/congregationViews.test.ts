import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// 積分頁 (維護者 2026-10-20): both 青少 and 主堂 can be looked at; where I count is said in one sentence that
// names the side I am on and the side I am not. Looking never changes where I count or what I may aim at.
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value },
  FlatList: (props: any) => React.createElement('FlatList', props, props.data?.map((item: any) => React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))) }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Path: el('Path') }; });

import type { GroupReading } from '../../src/services/devotionClient';
import { GroupReadingCard } from '../../src/ui/gamification/GroupReadingCard';
import { RewardPicker } from '../../src/ui/gamification/RewardPicker';
import { PeopleList } from '../../src/ui/gamification/PeopleList';

function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(element); });
  return tree;
}
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf);
const tab = (tree: TestRenderer.ReactTestRenderer, label: string) => tree.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === label);

const youthView: GroupReading = {
  scope: 'youth', month: '2026-10', today: '2026-10-20', todayReaders: 2, yesterdayReaders: 4,
  days: [{ date: '2026-10-17', readers: 6 }, { date: '2026-10-20', readers: 2 }], monthReads: 52, busiest: { date: '2026-10-17', readers: 6 }, qualifyingDays: 15,
  prizes: [{ id: 'beanbag', name: '新的懶骨頭 (摩脫教室)', icon: 'beanbag', members: 15, months: 2, qualifiedThisMonth: 0, achievedMonths: 0 }],
  myDaysThisMonth: 5,
};
const churchView: GroupReading = { ...youthView, scope: 'main', monthReads: 54, prizes: [] };

describe('團體: the 全教會｜青少 switch', () => {
  it('marks the side on screen, and asks for the other side when tapped', () => {
    const onView = vi.fn();
    const tree = render(React.createElement(GroupReadingCard, { view: churchView, own: 'main', onView }));
    expect(tab(tree, '全教會').props.accessibilityState).toMatchObject({ selected: true });
    expect(tab(tree, '青少').props.accessibilityState).toMatchObject({ selected: false });
    act(() => tab(tree, '青少').props.onPress());
    expect(onView).toHaveBeenCalledWith('youth');
    expect(texts(tree)).toContain('全教會一起讀經');
    expect(texts(tree).join('')).not.toContain('只是看看');
  });

  it('says I am only looking when the side on screen is not mine, and does not count me in its prize', () => {
    const tree = render(React.createElement(GroupReadingCard, { view: youthView, own: 'main', onView: vi.fn() }));
    expect(texts(tree)).toContain('我在主堂聚會 (不是青少)，這裡只是看看青少。');
    expect(texts(tree)).toContain('團體獎');
    expect(texts(tree).join('')).not.toContain('算你一份');
    const church = render(React.createElement(GroupReadingCard, { view: churchView, own: 'youth', onView: vi.fn() }));
    expect(texts(church)).toContain('我在青少聚會 (不是主堂)，這裡只是看看全教會。');
  });

  it('keeps my own line on my own side', () => {
    const tree = render(React.createElement(GroupReadingCard, { view: youthView, own: 'youth', onView: vi.fn() }));
    expect(texts(tree).join('')).not.toContain('只是看看');
    expect(texts(tree)).toContain('你這個月讀了 5 天，再 10 天就算你一份');
  });

  it('says so when the other side could not be read, and keeps the month controls', () => {
    const tree = render(React.createElement(GroupReadingCard, { view: churchView, own: 'main', onView: vi.fn(), failedSide: 'youth', onPreviousMonth: vi.fn() }));
    expect(texts(tree)).toContain('沒有讀到青少的人數，請再按一次。');
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '上個月')).toHaveLength(1);
  });

  it('shows no switch where the screen offers none', () => {
    const tree = render(React.createElement(GroupReadingCard, { view: youthView }));
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'tab')).toHaveLength(0);
  });
});

const movie = { rewardId: 'sheet-youth-1', name: '電影票', costPoints: 75, active: true, revision: 1 };
const bookmark = { rewardId: 'sheet-main-1', name: '書籤', costPoints: 20, active: true, revision: 1 };

describe('選擇目標獎品: 主堂獎品｜青少獎品', () => {
  it('opens on my own side, and says when my side has no prizes yet', () => {
    const onView = vi.fn();
    const tree = render(React.createElement(RewardPicker, { own: 'main', viewing: 'main', ownRewards: [], otherRewards: null, onView, onSelect: vi.fn() }));
    expect(tab(tree, '主堂獎品').props.accessibilityState).toMatchObject({ selected: true });
    expect(tab(tree, '青少獎品').props.accessibilityState).toMatchObject({ selected: false });
    expect(texts(tree)).toContain('主堂的獎品還沒上架。同工在試算表「主堂獎品」分頁加上後，這裡就會出現。');
    act(() => tab(tree, '青少獎品').props.onPress());
    expect(onView).toHaveBeenCalledWith('youth');
  });

  it('lets me pick on my own side', () => {
    const onSelect = vi.fn();
    const tree = render(React.createElement(RewardPicker, { own: 'main', viewing: 'main', ownRewards: [bookmark], otherRewards: null, onView: vi.fn(), onSelect }));
    const choice = tree.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio');
    act(() => choice.props.onPress());
    expect(onSelect).toHaveBeenCalledWith('sheet-main-1');
  });

  it('shows the other side’s prizes without any way to pick one, and says why', () => {
    const onSelect = vi.fn();
    const tree = render(React.createElement(RewardPicker, { own: 'main', viewing: 'youth', ownRewards: [], otherRewards: [movie], onView: vi.fn(), onSelect }));
    expect(tab(tree, '青少獎品').props.accessibilityState).toMatchObject({ selected: true });
    expect(texts(tree)).toEqual(expect.arrayContaining(['電影票', '75 分', '我在主堂聚會 (不是青少)，青少的獎品看得到、不能選。']));
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio')).toHaveLength(0);
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole !== 'tab')).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says when the other side has none yet, is still loading, or could not be read', () => {
    const empty = render(React.createElement(RewardPicker, { own: 'youth', viewing: 'main', ownRewards: [movie], otherRewards: [], onView: vi.fn(), onSelect: vi.fn() }));
    expect(texts(empty)).toContain('主堂的獎品還沒上架。同工在試算表「主堂獎品」分頁加上後，這裡就會出現。');
    const loading = render(React.createElement(RewardPicker, { own: 'youth', viewing: 'main', ownRewards: [movie], otherRewards: null, onView: vi.fn(), onSelect: vi.fn() }));
    expect(texts(loading)).toContain('載入中…');
    const failed = render(React.createElement(RewardPicker, { own: 'youth', viewing: 'main', ownRewards: [movie], otherRewards: null, otherFailed: true, onView: vi.fn(), onSelect: vi.fn() }));
    expect(texts(failed)).toContain('沒有讀到主堂的獎品，請稍後再試。');
    const youthEmpty = render(React.createElement(RewardPicker, { own: 'youth', viewing: 'youth', ownRewards: [], otherRewards: null, onView: vi.fn(), onSelect: vi.fn() }));
    expect(texts(youthEmpty)).toContain('青少的獎品還沒上架。同工在試算表「青少獎品」分頁加上後，這裡就會出現。');
  });
});

describe('全體 (管理): each person’s side', () => {
  const people = [{ memberId: 'a', displayName: '甲', earnedTotal: 9, rank: 1, congregation: 'main' as const }, { memberId: 'b', displayName: '乙', earnedTotal: 4, rank: 2, congregation: 'youth' as const }];
  it('labels each person 主堂 or 青少 when asked to', () => {
    const tree = render(React.createElement(PeopleList, { people, showRank: true, showCongregation: true, onSelect: vi.fn() }));
    expect(texts(tree)).toEqual(expect.arrayContaining(['甲', '主堂', '乙', '青少']));
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable').map((node) => node.props.accessibilityLabel)).toEqual(['查看甲的積分，主堂', '查看乙的積分，青少']);
  });
  it('shows no side anywhere else', () => {
    const tree = render(React.createElement(PeopleList, { people, onSelect: vi.fn() }));
    expect(texts(tree)).not.toContain('主堂'); expect(texts(tree)).not.toContain('青少');
  });
});
