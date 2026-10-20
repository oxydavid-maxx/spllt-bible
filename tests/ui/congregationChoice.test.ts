import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 青少/主堂 (維護者 2026-10-17, 2026-10-20): every member chooses where they meet, in words that say
// "我" and name both the side they are on and the side they are not; nobody can skip it, not even when the
// phone cannot reach the server and has never seen their choice. The 積分 page and 我的帳戶 change it the same way.
const state = vi.hoisted(() => ({
  auth: { status: 'signed-in', session: { memberId: 'm1', sessionToken: 't1' } } as { status: string; session: { memberId: string; sessionToken: string } | null },
  congregation: null as 'youth' | 'main' | null,
  foreground: new Set<(revision?: number) => void>(),
  stored: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('../../src/services/appVisibility', () => ({ subscribeAppActive: (fn: (revision?: number) => void) => { state.foreground.add(fn); return () => state.foreground.delete(fn); } }));
vi.mock('react-native', () => ({ Modal: primitive('Modal'), Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (s: unknown) => s } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => state.stored.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.stored.set(key, value); },
  deleteItemAsync: async (key: string) => { state.stored.delete(key); },
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.auth }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getCongregation: state.get, setCongregation: state.set }) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: { visible: boolean; title: string; actions?: Array<{ label: string; onPress: () => void; disabled?: boolean }>; children?: unknown }) =>
  props.visible ? require('react').createElement('ActionSheet', props, props.children, ...(props.actions ?? []).map((action) => require('react').createElement('Pressable', { key: action.label, accessibilityLabel: action.label, disabled: action.disabled, onPress: action.onPress }))) : null }));
import { CongregationGate } from '../../src/ui/congregation/CongregationGate';
import { CongregationLine } from '../../src/ui/congregation/CongregationLine';
import { CongregationSetting } from '../../src/ui/congregation/CongregationSetting';
import { resetCongregationStore, useCongregation } from '../../src/ui/congregation/congregationStore';

let tree: TestRenderer.ReactTestRenderer | null = null;
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
// Whole lines: a sentence with a quieter "(不是青少)" inside is still one line to the reader.
const texts = () => tree!.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf);
const pressables = (label: string) => tree!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label);
const button = (label: string) => pressables(label)[0];
const confirm = () => tree!.root.find((node) => String(node.type) === 'Pressable' && node.props.testID === 'congregation-confirm');
const sheet = () => tree!.root.findAll((node) => String(node.type) === 'ActionSheet');
async function mount(element: React.ReactElement) { await act(async () => { tree = TestRenderer.create(element); }); }
// A failed read looks up what this phone remembers (SecureStore, loaded on demand) before it settles.
async function settle() { for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
async function press(node: TestRenderer.ReactTestInstance) { await act(async () => { if (!node.props.disabled) node.props.onPress(); }); }

beforeEach(() => {
  resetCongregationStore();
  state.stored.clear();
  state.auth = { status: 'signed-in', session: { memberId: 'm1', sessionToken: 't1' } };
  state.get.mockReset().mockImplementation(async () => state.congregation);
  state.set.mockReset().mockImplementation(async (value: 'youth' | 'main') => { state.congregation = value; return value; });
});
// A saved choice is remembered in the background; let it land before the next test wipes this "phone".
afterEach(async () => { act(() => tree?.unmount()); tree = null; await new Promise((resolve) => setTimeout(resolve, 50)); });

describe('the first choice', () => {
  it('starts with nothing chosen and cannot be confirmed until a side is picked', async () => {
    state.congregation = null;
    await mount(React.createElement(CongregationGate));
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(texts()).toContain('選錯沒關係，積分頁上隨時可以改，以前讀的天數會一起跟過去。');
    const youth = button('青少，國中、高中、大專學生'), main = button('主堂，社青、家長、長輩');
    expect(youth.props.accessibilityState).toMatchObject({ checked: false });
    expect(main.props.accessibilityState).toMatchObject({ checked: false });
    expect(confirm().props.disabled).toBe(true);
    await press(confirm());
    expect(state.set).not.toHaveBeenCalled();
  });

  it('words the confirm button after the side picked, and saves only on confirm', async () => {
    state.congregation = null;
    await mount(React.createElement(CongregationGate));
    await press(button('主堂，社青、家長、長輩'));
    expect(state.set).not.toHaveBeenCalled();
    expect(confirm().props.disabled).toBe(false);
    expect(confirm().props.accessibilityLabel).toBe('我在主堂聚會 (不是青少)');
    expect(textOf(confirm())).toBe('我在主堂聚會 (不是青少)');
    await press(button('青少，國中、高中、大專學生'));
    expect(confirm().props.accessibilityLabel).toBe('我在青少聚會 (不是主堂)');
    await press(confirm());
    expect(state.set).toHaveBeenCalledWith('youth');
    expect(tree!.toJSON()).toBeNull();
  });

  it('has no way out but choosing: no skip, no close, and the system back does nothing', async () => {
    state.congregation = null;
    await mount(React.createElement(CongregationGate));
    const labels = tree!.root.findAll((node) => String(node.type) === 'Pressable').map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(['青少，國中、高中、大專學生', '主堂，社青、家長、長輩', '請先選上面其中一個']);
    const modal = tree!.root.find((node) => String(node.type) === 'Modal');
    act(() => modal.props.onRequestClose());
    expect(texts()).toContain('我平常在哪裡聚會？');
  });

  it('never asks a member who already chose, nor anyone signed out', async () => {
    state.congregation = 'youth';
    await mount(React.createElement(CongregationGate));
    expect(tree!.toJSON()).toBeNull();
    act(() => tree!.unmount()); resetCongregationStore();
    state.auth = { status: 'signed-out', session: null }; state.congregation = null;
    await mount(React.createElement(CongregationGate));
    expect(tree!.toJSON()).toBeNull(); expect(state.get).toHaveBeenCalledTimes(1);
  });

  it('keeps asking when the save fails, says so, and can be pressed again', async () => {
    state.congregation = null; state.set.mockRejectedValueOnce(new Error('offline'));
    await mount(React.createElement(CongregationGate));
    await press(button('青少，國中、高中、大專學生'));
    await press(confirm());
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(texts()).toContain('沒有存到，請檢查網路後再按一次。');
    expect(confirm().props.disabled).toBe(false);
    await press(confirm());
    expect(state.set).toHaveBeenCalledTimes(2);
    expect(tree!.toJSON()).toBeNull();
  });
});

describe('when where I meet cannot be read', () => {
  it('still asks on a phone that has never seen my choice, with 再試一次', async () => {
    state.get.mockRejectedValue(new Error('offline'));
    await mount(React.createElement(CongregationGate)); await settle();
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(texts()).toContain('沒有連上網路，讀不到之前選的。可以直接選，或按「再試一次」。');
    state.get.mockReset().mockResolvedValueOnce('youth');
    await press(button('再試一次'));
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(tree!.toJSON()).toBeNull();
  });

  it('stays up while 再試一次 is reading, and keeps asking a member who has not chosen', async () => {
    state.get.mockRejectedValueOnce(new Error('offline'));
    await mount(React.createElement(CongregationGate)); await settle();
    let answer!: (value: null) => void;
    state.get.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    await press(button('再試一次'));
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(button('再試一次').props.disabled).toBe(true);
    await act(async () => { answer(null); });
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(texts()).not.toContain('沒有連上網路，讀不到之前選的。可以直接選，或按「再試一次」。');
    expect(pressables('再試一次')).toHaveLength(0);
  });

  it('does not ask on a phone that has seen my choice, uses it, and takes the server’s answer next time', async () => {
    state.congregation = 'main';
    await mount(React.createElement(CongregationGate));
    expect(tree!.toJSON()).toBeNull();
    await vi.waitFor(() => expect([...state.stored.values()]).toEqual(['main']));
    act(() => tree!.unmount()); resetCongregationStore();
    state.get.mockReset().mockRejectedValueOnce(new Error('offline'));
    await mount(React.createElement(React.Fragment, null, React.createElement(CongregationGate), React.createElement(CongregationLine, { variant: 'points' }))); await settle();
    expect(texts()).not.toContain('我平常在哪裡聚會？');
    expect(texts()).toContain('我在主堂聚會 (不是青少)');
    state.get.mockResolvedValueOnce('youth');
    await act(async () => { state.foreground.forEach((fn) => fn(1)); });
    expect(texts()).toContain('我在青少聚會 (不是主堂)');
  });

  it('reads again after a timeout before asking, so one slow first answer does not ask anybody', async () => {
    const timeout = () => Object.assign(new Error('READ_TIMEOUT'), { retryable: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      state.get.mockRejectedValueOnce(timeout()).mockResolvedValueOnce('youth');
      await mount(React.createElement(CongregationGate));
      expect(tree!.toJSON()).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(state.get).toHaveBeenCalledTimes(2);
      expect(tree!.toJSON()).toBeNull();
      act(() => tree!.unmount()); resetCongregationStore();
      state.get.mockReset().mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout());
      state.auth = { status: 'signed-in', session: { memberId: 'm3', sessionToken: 't3' } };
      await mount(React.createElement(CongregationGate));
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(tree!.toJSON()).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(state.get).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
    await settle();
    expect(texts()).toContain('我平常在哪裡聚會？');
    expect(texts()).toContain('沒有連上網路，讀不到之前選的。可以直接選，或按「再試一次」。');
  });

  it('remembers a choice per member, not per phone', async () => {
    state.congregation = 'main';
    await mount(React.createElement(CongregationGate));
    await vi.waitFor(() => expect(state.stored.size).toBe(1));
    act(() => tree!.unmount()); resetCongregationStore();
    state.auth = { status: 'signed-in', session: { memberId: 'm2', sessionToken: 't2' } };
    state.get.mockReset().mockRejectedValue(new Error('offline'));
    await mount(React.createElement(CongregationGate)); await settle();
    expect(texts()).toContain('我平常在哪裡聚會？');
  });
});

describe('the line that says where I meet, and 改', () => {
  it('says which side I am on and which I am not, with a separate 改 button', async () => {
    state.congregation = 'main';
    await mount(React.createElement(CongregationLine, { variant: 'points' }));
    expect(texts()).toContain('我在主堂聚會 (不是青少)');
    expect(button('改我在哪裡聚會')).toBeDefined();
    expect(textOf(button('改我在哪裡聚會'))).toBe('改');
  });

  it('names the change on the confirm button and cannot confirm without changing sides', async () => {
    state.congregation = 'main';
    await mount(React.createElement(CongregationLine, { variant: 'points' }));
    await press(button('改我在哪裡聚會'));
    expect(sheet()[0].props.title).toBe('我平常在哪裡聚會？');
    // The side I am on now first, then the one I can change to.
    expect(tree!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio').map((node) => node.props.accessibilityLabel))
      .toEqual(['主堂 (現在)，社青、家長、長輩', '青少，國中、高中、大專學生']);
    expect(texts()).toContain('改了之後，我以前讀經的天數會一起算到新的那一邊；積分不會變。');
    expect(button('請選要改成哪一邊').props.disabled).toBe(true);
    await press(button('主堂 (現在)，社青、家長、長輩'));
    expect(button('請選要改成哪一邊').props.disabled).toBe(true);
    await press(button('青少，國中、高中、大專學生'));
    expect(pressables('請選要改成哪一邊')).toHaveLength(0);
    expect(state.set).not.toHaveBeenCalled();
    await press(button('改成：我在青少聚會 (不是主堂)'));
    expect(state.set).toHaveBeenCalledWith('youth');
    expect(sheet()).toHaveLength(0);
    expect(texts()).toContain('我在青少聚會 (不是主堂)');
  });

  it('keeps the sheet open and says so when the change was not saved', async () => {
    state.congregation = 'youth'; state.set.mockRejectedValueOnce(new Error('offline'));
    await mount(React.createElement(CongregationLine, { variant: 'points' }));
    await press(button('改我在哪裡聚會'));
    await press(button('主堂，社青、家長、長輩'));
    await press(button('改成：我在主堂聚會 (不是青少)'));
    expect(sheet()).toHaveLength(1);
    expect(texts()).toContain('沒有存到，請檢查網路後再試一次。');
    expect(texts()).toContain('我在青少聚會 (不是主堂)');
  });

  it('is the same setting, worded the same, on 我的帳戶', async () => {
    state.congregation = 'youth';
    await mount(React.createElement(React.Fragment, null, React.createElement(CongregationSetting), React.createElement(CongregationLine, { variant: 'points' })));
    expect(texts().filter((line) => line === '我在青少聚會 (不是主堂)')).toHaveLength(2);
    expect(texts()).not.toContain('我在哪裡聚會');
    await press(pressables('改我在哪裡聚會')[0]);
    await press(button('主堂，社青、家長、長輩'));
    await press(button('改成：我在主堂聚會 (不是青少)'));
    expect(texts().filter((line) => line === '我在主堂聚會 (不是青少)')).toHaveLength(2);
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
  expect(texts()).toContain('我在主堂聚會 (不是青少)'); expect(state.get).toHaveBeenCalledTimes(2);
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


it('rechecks congregation on a newer foreground even while the older read is pending (7)', async () => {
  state.congregation = 'youth'; await mount(React.createElement(CongregationSetting));
  let resolve!: (v: string) => void; state.get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => { state.foreground.forEach(fn => fn(1)); });
  state.congregation = 'main';
  await act(async () => { state.foreground.forEach(fn => fn(2)); });
  expect(state.get).toHaveBeenCalledTimes(3); expect(texts()).toContain('我在主堂聚會 (不是青少)');
  await act(async () => { resolve('youth'); }); expect(texts()).toContain('我在主堂聚會 (不是青少)');
});
