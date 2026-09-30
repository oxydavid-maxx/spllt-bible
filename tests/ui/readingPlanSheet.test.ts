import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const animated = vi.hoisted(() => (require('../doubles/animatedDouble.cjs') as { createAnimatedDouble(): any }).createAnimatedDouble());
const boundary = vi.hoisted(() => ({
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, epoch: 1 },
  getReadingDays: vi.fn(),
  get: vi.fn(),
  scrollTo: vi.fn(),
  primitive: (name: string) => (props: any) => require('react').createElement(name, props, props.children),
}));
vi.mock('react-native', () => ({
  ...animated.modules(boundary.primitive),
  Modal: boundary.primitive('Modal'), Pressable: boundary.primitive('Pressable'),
  View: boundary.primitive('View'), Text: boundary.primitive('Text'),
  ScrollView: require('react').forwardRef((props: any, ref: any) => {
    require('react').useImperativeHandle(ref, () => ({ scrollTo: boundary.scrollTo }));
    return require('react').createElement('ScrollView', props, props.children);
  }),
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 800 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: boundary.primitive('SafeAreaProvider'), SafeAreaView: boundary.primitive('SafeAreaView') }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => boundary.auth, getAuthSnapshot: () => boundary.auth, isCurrentAuthSession: () => true }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: boundary.getReadingDays }) }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: () => ({ get: boundary.get }) }));

import { ReadingPlanSheet } from '../../src/ui/ReadingPlanSheet';
import { canonicalReadingPlan } from '../../src/domain/calendar';
import { theme } from '../../src/ui/Theme';

let tree: ReactTestRenderer | null = null;
const flat = (value: any) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const texts = () => tree!.root.findAll(node => String(node.type) === 'Text').map(node => node.children.join(''));
const row = (date: string) => tree!.root.findAll(node => String(node.type) === 'Pressable' && String(node.props.accessibilityLabel).startsWith(`讀 ${date} `))[0];
const onClose = vi.fn();
const onSelectDate = vi.fn();
async function mount(visible = true) {
  await act(async () => { tree = create(React.createElement(ReadingPlanSheet, { visible, onClose, onSelectDate })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
beforeEach(() => {
  animated.reset();
  boundary.auth = { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, epoch: 1 };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T04:00:00Z'));
  boundary.get.mockReturnValue(undefined);
  boundary.getReadingDays.mockImplementation(async (from: string, to: string) => ({ days: canonicalReadingPlan.days.filter(day => day.date >= from && day.date <= to).map(day => ({ taskDate: day.date, references: day.references, status: day.date === '2026-09-29' ? 'COMPLETED' : 'UNREPORTED', revision: day.date === '2026-09-29' ? 1 : 0 })) }));
});
afterEach(() => { act(() => tree?.unmount()); tree = null; vi.useRealTimers(); });

describe('the full reading plan shared by both entry points', () => {
  it('does no work while closed', async () => {
    await mount(false);
    expect(tree!.toJSON()).toBeNull();
    expect(boundary.getReadingDays).not.toHaveBeenCalled();
    expect(boundary.get).not.toHaveBeenCalled();
  });

  it('groups all 105 scheduled days by month, marks today and completed days, and counts actual completion', async () => {
    await mount();
    expect(texts()).toEqual(expect.arrayContaining(['整份讀經計畫', '9/1–12/31，共 105 天，已讀 1 天', '9 月', '10 月', '11 月', '12 月', '今天', '✓']));
    expect(tree!.root.findAll(node => String(node.type) === 'Pressable' && String(node.props.accessibilityLabel).startsWith('讀 2026-'))).toHaveLength(105);
    expect(flat(row('2026-09-30').props.style).backgroundColor).toBe(theme.colors.primarySoft);
    expect(row('2026-09-29').props.accessibilityLabel).toContain('已完成');
    expect(texts().join('')).not.toContain('讀經表原本');
    expect(boundary.getReadingDays.mock.calls.map(args => args.slice(0, 2))).toEqual([
      ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'],
    ]);
  });

  it('scrolls once to the measured today row after content layout, then leaves manual scrolling alone', async () => {
    await mount();
    const scroll = tree!.root.findByType('ScrollView' as never);
    act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 800 } } }));
    act(() => row('2026-09-30').props.onLayout({ nativeEvent: { layout: { y: 1400 } } }));
    act(() => scroll.props.onContentSizeChange(411, 6000));
    expect(boundary.scrollTo).not.toHaveBeenCalled();
    act(() => tree!.root.findByType('Modal' as never).props.onShow());
    expect(boundary.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 1080, animated: false });
    act(() => scroll.props.onContentSizeChange(411, 6100));
    expect(boundary.scrollTo).toHaveBeenCalledOnce();
  });

  it('does not treat an early empty content layout as ready to position the native list', async () => {
    await mount();
    const scroll = tree!.root.findByType('ScrollView' as never);
    act(() => scroll.props.onContentSizeChange(411, 0));
    act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 800 } } }));
    act(() => row('2026-09-30').props.onLayout({ nativeEvent: { layout: { y: 1400 } } }));
    expect(boundary.scrollTo).not.toHaveBeenCalled();
    act(() => tree!.root.findByType('Modal' as never).props.onShow());
    expect(boundary.scrollTo).not.toHaveBeenCalled();
    act(() => scroll.props.onContentSizeChange(411, 6000));
    expect(boundary.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 1080, animated: false });
  });

  it('closes and opens any chosen reading date without a completion mutation', async () => {
    await mount();
    act(() => row('2026-10-15').props.onPress());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelectDate).toHaveBeenCalledExactlyOnceWith('2026-10-15');
  });

  it('follows a header drag and dismisses once after the slide finishes, without selecting a date', async () => {
    await mount();
    act(() => tree!.root.findByType('Modal' as never).props.onShow());
    const sheet = tree!.root.findByProps({ testID: 'reading-plan-sheet' });
    const handle = tree!.root.findByProps({ testID: 'reading-plan-drag-handle' });
    act(() => sheet.props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
    const pan = handle.props.panConfig;
    expect(pan.onMoveShouldSetPanResponder({}, { dx: 2, dy: 12, vy: 0 })).toBe(true);
    act(() => pan.onPanResponderMove({}, { dx: 2, dy: 120, vy: 0.1 }));
    expect(flat(sheet.props.style).transform[0].translateY.value).toBe(120);
    act(() => pan.onPanResponderRelease({}, { dx: 2, dy: 120, vy: 0.1 }));
    expect(onClose).not.toHaveBeenCalled();
    expect(pan.onMoveShouldSetPanResponder({}, { dx: 0, dy: 20, vy: 1 })).toBe(false);
    act(() => animated.finishAll());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelectDate).not.toHaveBeenCalled();
    expect(animated.state.running).toBe(0);
    expect(animated.state.configs.every((config: any) => config.useNativeDriver === true)).toBe(true);
  });

  it('keeps list scrolling separate, returns a short drag, and accepts a downward flick', async () => {
    await mount();
    act(() => tree!.root.findByType('Modal' as never).props.onShow());
    const sheet = tree!.root.findByProps({ testID: 'reading-plan-sheet' });
    const pan = tree!.root.findByProps({ testID: 'reading-plan-drag-handle' }).props.panConfig;
    act(() => sheet.props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
    const scroll = tree!.root.findByType('ScrollView' as never);
    for (let node: typeof scroll | null = scroll; node; node = node.parent) expect(node.props.panConfig).toBeUndefined();
    expect(pan.onMoveShouldSetPanResponder({}, { dx: 20, dy: 4, vy: 0 })).toBe(false);
    expect(pan.onMoveShouldSetPanResponder({}, { dx: 0, dy: -20, vy: -1 })).toBe(false);
    act(() => pan.onPanResponderMove({}, { dx: 0, dy: 40, vy: 0.1 }));
    act(() => pan.onPanResponderRelease({}, { dx: 0, dy: 40, vy: 0.1 }));
    act(() => animated.finishAll());
    expect(flat(sheet.props.style).transform[0].translateY.value).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    act(() => pan.onPanResponderRelease({}, { dx: 0, dy: 20, vy: 0.8 }));
    act(() => animated.finishAll());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps pending local completion and shows the offline limit when the server cannot answer', async () => {
    boundary.getReadingDays.mockRejectedValue(new Error('offline'));
    boundary.get.mockImplementation(({ taskDate }: { taskDate: string }) => taskDate === '2026-09-28' ? { status: 'COMPLETED', revision: 1, syncStatus: 'PENDING_SAVE' } : undefined);
    await mount();
    expect(row('2026-09-28').props.accessibilityLabel).toContain('已完成');
    expect(texts()).toContain('9/1–12/31，共 105 天，已讀 1 天');
    expect(texts()).toContain('尚未連上更新，先顯示這支手機的完成記錄。');
  });

  it('keeps an unsynced local undo over a server completion, but accepts a newer confirmed revision', async () => {
    boundary.get.mockImplementation(({ taskDate }: { taskDate: string }) => taskDate === '2026-09-29' ? { status: 'NOT_COMPLETED', revision: 1, syncStatus: 'PENDING_SAVE' } : undefined);
    await mount();
    expect(row('2026-09-29').props.accessibilityLabel).not.toContain('已完成');
    expect(texts()).toContain('9/1–12/31，共 105 天，已讀 0 天');
    act(() => tree!.unmount());
    tree = null;
    boundary.get.mockImplementation(({ taskDate }: { taskDate: string }) => taskDate === '2026-09-29' ? { status: 'NOT_COMPLETED', revision: 0, syncStatus: 'CONFIRMED' } : undefined);
    await mount();
    expect(row('2026-09-29').props.accessibilityLabel).toContain('已完成');
  });

  it('ignores an old account response after switching accounts while the sheet is open', async () => {
    let finish!: (value: unknown) => void;
    boundary.getReadingDays.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await mount();
    boundary.auth = { status: 'signed-in', session: { memberId: 'other', sessionToken: 'new-token' }, epoch: 2 };
    boundary.getReadingDays.mockResolvedValue({ days: [] });
    await act(async () => { tree!.update(React.createElement(ReadingPlanSheet, { visible: true, onClose, onSelectDate })); });
    await act(async () => { finish({ days: [{ taskDate: '2026-09-29', status: 'COMPLETED', revision: 1, references: ['PSA.105'] }] }); });
    expect(row('2026-09-29').props.accessibilityLabel).not.toContain('已完成');
    expect(texts()).toContain('9/1–12/31，共 105 天，已讀 0 天');
  });
});
