import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), KeyboardAvoidingView: primitive('KeyboardAvoidingView'), FlatList: (props: any) => React.createElement('FlatList', props, props.data?.map((item: any) => props.renderItem({ item }))), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value }, Modal: primitive('Modal'), TextInput: primitive('TextInput'), ActivityIndicator: primitive('ActivityIndicator') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: primitive('SafeAreaProvider'), SafeAreaView: primitive('SafeAreaView') }));

import { PeopleList } from '../../src/ui/gamification/PeopleList';
import { ScoreProfile } from '../../src/ui/gamification/ScoreProfile';
import { RedemptionList } from '../../src/ui/gamification/RedemptionList';
import { ActionSheet } from '../../src/ui/gamification/ActionSheet';

describe('shared gamification UI', () => {
  it('uses one people list shape and keeps every row at least 48dp', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(PeopleList, { people: [{ memberId: 'm1', displayName: '小明', earnedTotal: 4, rank: 1 }], showRank: true, onSelect: vi.fn() })); });
    const row = renderer.root.findAll((node) => String(node.type) === 'Pressable')[0];
    expect(row.props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findByProps({ children: '第 1 名' })).toBeDefined();
  });

  it('does not render a private balance when the profile projection omits it', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: { memberId: 'm1', displayName: '好友', earnedTotal: 4, band: 2, months: [{ month: '2026-04', earnedPoints: 1 }], permissions: { canEditTarget: false, canRedeem: false } } })); });
    expect(renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ')).not.toContain('可兌換積分');
  });

  it('requires a reason before an admin can reverse a redemption', () => {
    const onReverse = vi.fn(); let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(RedemptionList, { redemptions: [{ redemptionId: 'r1', memberId: 'm1', rewardId: 'reward-1', rewardName: '飲料', costPoints: 2, status: 'COMPLETED', confirmedAt: 10 }], canReverse: true, onReverse })); });
    const reverse = renderer.root.findAll((node) => node.props.accessibilityLabel === '撤銷飲料')[0];
    act(() => { reverse.props.onPress(); });
    const input = renderer.root.findByProps({ accessibilityLabel: '撤銷理由' });
    act(() => { input.props.onChangeText('現場更正'); });
    const confirm = renderer.root.findByProps({ accessibilityLabel: '確認撤銷兌換' });
    act(() => { confirm.props.onPress(); });
    expect(onReverse).toHaveBeenCalledWith('r1', '現場更正');
  });

  it('keeps modal actions above the system bottom inset and scrollable', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ActionSheet, { visible: true, title: '管理獎品', onClose: vi.fn(), actions: [{ label: '建立獎品', onPress: vi.fn() }] }, React.createElement('View', null, React.createElement('Text', null, '長內容')))); });
    expect(renderer.root.findByType('SafeAreaProvider' as any)).toBeDefined();
    const safeArea = renderer.root.findByType('SafeAreaView' as any);
    expect(safeArea.props.edges).toEqual(['bottom', 'left', 'right']);
    expect(safeArea.props.style.maxHeight).toBe('85%');
    const keyboard = renderer.root.findByType('KeyboardAvoidingView' as any);
    expect(keyboard.props.behavior).toBe('padding');
    const body = renderer.root.findByType('ScrollView' as any);
    expect(body.props.keyboardShouldPersistTaps).toBe('handled');
    expect(body.props.style.flexShrink).toBe(1);
    const actionStyle = renderer.root.findByProps({ accessibilityLabel: '建立獎品' }).props.style;
    expect((Array.isArray(actionStyle) ? actionStyle[0] : actionStyle).minHeight).toBeGreaterThanOrEqual(48);
  });
});
