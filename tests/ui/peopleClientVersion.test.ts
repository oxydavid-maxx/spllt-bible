import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// 光佑 (2026-10-21): 全體 (管理) shows beside each person which version their phone runs and the last day it
// was opened, e.g. 「Android 0.5.35 · 更新 bff271 · 10/21 打開」. Only administrators get it from the server;
// friends never see it. Same list as before, still two lines a row.
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value },
  FlatList: (props: any) => React.createElement('FlatList', props, props.data?.map((item: any) => React.createElement(React.Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item })))) }));

import { clientVersionLabel, PeopleList } from '../../src/ui/gamification/PeopleList';
import { createGamificationApiClient } from '../../src/services/gamificationApiClient';

const UPDATE = '019a3c1e-7d4f-7b2e-9c41-5e8f2abff271';
const ANDROID = { platform: 'android' as const, version: '0.5.35', build: '60', updateId: UPDATE, lastSeenDate: '2026-10-21' };
const IOS = { platform: 'ios' as const, version: '0.5.35', build: '60', updateId: null, lastSeenDate: '2026-10-09' };
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(element); });
  return tree;
}

describe('the version line', () => {
  it('reads like the brief: platform, store version, the end of the running update, the day opened', () => {
    expect(clientVersionLabel(ANDROID)).toBe('Android 0.5.35 · 更新 bff271 · 10/21 打開');
    expect(clientVersionLabel(IOS)).toBe('iOS 0.5.35 · 10/9 打開');
  });
  it('says so when the phone has never reported (an app older than this feature)', () => {
    expect(clientVersionLabel(null)).toBe('沒有版本紀錄');
  });
});

describe('全體 (管理) rows', () => {
  const people = [
    { memberId: 'a', displayName: '甲', earnedTotal: 9, rank: 1, congregation: 'main' as const, client: ANDROID },
    { memberId: 'b', displayName: '乙', earnedTotal: 4, rank: 2, congregation: 'youth' as const, client: null },
  ];

  it('shows each person\'s version and keeps the score, in two lines', () => {
    const tree = render(React.createElement(PeopleList, { people, showRank: true, showCongregation: true, showClient: true, onSelect: vi.fn() }));
    const rows = tree.root.findAll((node) => String(node.type) === 'Pressable');
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(['查看甲的積分，主堂，Android 0.5.35 · 更新 bff271 · 10/21 打開', '查看乙的積分，青少，沒有版本紀錄']);
    const first = rows[0].findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf);
    expect(first).toEqual(['甲', '9 總積分', '主堂', '第 1 名', 'Android 0.5.35 · 更新 bff271 · 10/21 打開']);
    // Two lines (compact rule): name, score, side and rank on the first; the version line, full width, on the second.
    const host = (node: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance => (typeof node.type === 'string' ? node : host(node.children[0] as TestRenderer.ReactTestInstance));
    const bands = (rows[0].children as TestRenderer.ReactTestInstance[]).map(host);
    expect(bands.map((band) => band.type)).toEqual(['View', 'Text']);
    expect(bands[1].props.numberOfLines).toBe(1);
  });

  it('shows no version anywhere else', () => {
    const tree = render(React.createElement(PeopleList, { people, onSelect: vi.fn() }));
    const all = tree.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf).join('|');
    expect(all).not.toContain('0.5.35');
    expect(all).not.toContain('版本紀錄');
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable').map((row) => row.props.accessibilityLabel)).toEqual(['查看甲的積分', '查看乙的積分']);
  });
});

describe('reading it from the server', () => {
  const answer = (people: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ scope: 'all', people }), { headers: { 'content-type': 'application/json' } }));
  const client = (fetchImpl: ReturnType<typeof answer>) => createGamificationApiClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });

  it('keeps a well-formed report and treats a missing one as never reported', async () => {
    const people = await client(answer([
      { memberId: 'a', displayName: '甲', earnedTotal: 9, rank: 1, client: ANDROID },
      { memberId: 'b', displayName: '乙', earnedTotal: 4, rank: 2, client: null },
      { memberId: 'c', displayName: '丙', earnedTotal: 1, rank: 3 },
    ])).getPeople('all');
    expect(people.map((person) => person.client)).toEqual([ANDROID, null, undefined]);
  });

  it('drops a malformed report without losing the person', async () => {
    const people = await client(answer([{ memberId: 'a', displayName: '甲', earnedTotal: 9, rank: 1, client: { platform: 'android', version: 7, lastSeenDate: 'yesterday' } }])).getPeople('all');
    expect(people).toEqual([{ memberId: 'a', displayName: '甲', earnedTotal: 9, rank: 1 }]);
  });
});
