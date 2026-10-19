import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 青少/主堂 (維護者 2026-10-17): a new member chooses once, right after signing in;
// a member from before is never asked; the account page can change it after a confirmation.
const state = vi.hoisted(() => ({
  auth: { status: 'signed-in', session: { memberId: 'm1', sessionToken: 't1' } } as { status: string; session: { memberId: string; sessionToken: string } | null },
  congregation: null as 'youth' | 'main' | null,
  foreground: new Set<() => void>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('../../src/services/appVisibility', () => ({ subscribeAppActive: (fn: () => void) => { state.foreground.add(fn); return () => state.foreground.delete(fn); } }));
vi.mock('react-native', () => ({ Modal: primitive('Modal'), Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (s: unknown) => s } }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.auth }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getCongregation: state.get, setCongregation: state.set }) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: { visible: boolean; title: string; actions?: Array<{ label: string; onPress: () => void }>; children?: unknown }) =>
  props.visible ? require('react').createElement('ActionSheet', props, props.children, ...(props.actions ?? []).map((action) => require('react').createElement('Pressable', { key: action.label, accessibilityLabel: action.label, onPress: action.onPress }))) : null }));
import { CongregationGate } from '../../src/ui/congregation/CongregationGate';
import { CongregationSetting } from '../../src/ui/congregation/CongregationSetting';
import { resetCongregationStore, useCongregation } from '../../src/ui/congregation/congregationStore';

let tree: TestRenderer.ReactTestRenderer | null = null;
const texts = () => tree!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
const button = (label: string) => tree!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)[0];
async function mount(element: React.ReactElement) { await act(async () => { tree = TestRenderer.create(element); }); }

beforeEach(() => {
  resetCongregationStore();
  state.auth = { status: 'signed-in', session: { memberId: 'm1', sessionToken: 't1' } };
  state.get.mockReset().mockImplementation(async () => state.congregation);
  state.set.mockReset().mockImplementation(async (value: 'youth' | 'main') => { state.congregation = value; return value; });
});
afterEach(() => { act(() => tree?.unmount()); tree = null; });

describe('the first choice after signing in', () => {
  it('asks a member who has not chosen, and goes away once the choice is saved', async () => {
    state.congregation = null;
    await mount(React.createElement(CongregationGate));
    expect(texts()).toContain('你在哪裡聚會？');
    expect(button('青少，國中、高中、大專')).toBeDefined(); expect(button('主堂，成人')).toBeDefined();
    await act(async () => { button('主堂，成人').props.onPress(); });
    expect(state.set).toHaveBeenCalledWith('main');
    expect(tree!.toJSON()).toBeNull();
  });
  it('never asks a member who already belongs, nor anyone signed out', async () => {
    state.congregation = 'youth';
    await mount(React.createElement(CongregationGate));
    expect(tree!.toJSON()).toBeNull();
    act(() => tree!.unmount()); resetCongregationStore();
    state.auth = { status: 'signed-out', session: null }; state.congregation = null;
    await mount(React.createElement(CongregationGate));
    expect(tree!.toJSON()).toBeNull(); expect(state.get).toHaveBeenCalledTimes(1);
  });
  it('keeps asking when the save fails, and says so', async () => {
    state.congregation = null; state.set.mockRejectedValueOnce(new Error('offline'));
    await mount(React.createElement(CongregationGate));
    await act(async () => { button('青少，國中、高中、大專').props.onPress(); });
    expect(texts()).toContain('你在哪裡聚會？');
    expect(texts().join('')).toContain('沒有存到');
  });
});

describe('changing it on the account page', () => {
  it('shows where the member belongs and changes it only after a confirmation', async () => {
    state.congregation = 'youth';
    await mount(React.createElement(CongregationSetting));
    expect(texts()).toEqual(expect.arrayContaining(['我在哪裡聚會', '青少']));
    await act(async () => { button('改我在哪裡聚會').props.onPress(); });
    expect(tree!.root.findAll((node) => String(node.type) === 'ActionSheet')[0].props.title).toBe('改到主堂？');
    expect(texts().join('')).toContain('已經得到的積分不會變');
    expect(state.set).not.toHaveBeenCalled();
    await act(async () => { button('改到主堂').props.onPress(); });
    expect(state.set).toHaveBeenCalledWith('main');
    expect(texts()).toContain('主堂');
    expect(tree!.root.findAll((node) => String(node.type) === 'ActionSheet')).toHaveLength(0);
  });
});


it('refreshes all mounted congregation consumers once on foreground and never while idle (7)', async () => {
  vi.useFakeTimers(); state.congregation = 'youth';
  await mount(React.createElement(React.Fragment, null, React.createElement(CongregationGate), React.createElement(CongregationSetting)));
  expect(state.get).toHaveBeenCalledTimes(1);
  state.congregation = 'main';
  await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); });
  expect(state.get).toHaveBeenCalledTimes(1);
  await act(async () => { state.foreground.forEach(fn => fn()); });
  expect(texts()).toContain('主堂'); expect(state.get).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});


it('keeps a newly saved congregation when an older foreground read returns late (7)', async () => {
  let current!: ReturnType<typeof useCongregation>;
  function Harness() { current = useCongregation(); return null; }
  state.congregation = 'youth'; await mount(React.createElement(Harness));
  let resolve!: (value: string) => void; state.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => { state.foreground.forEach(fn => fn()); });
  await act(async () => { await current.choose('main'); });
  await act(async () => { resolve('youth'); });
  expect(current.value).toBe('main');
});
