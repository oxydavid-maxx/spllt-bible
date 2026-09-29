import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app-owned bottom sheet that Metro serves for '@gorhom/bottom-sheet' (docs/design/lean-reader-sheets.md).
// React Native's Animated and PanResponder are the only doubles (tests/doubles/animatedDouble.cjs):
// timings finish when the test says so, so the tests can see what is still running.
const animated = vi.hoisted(() => (require('../doubles/animatedDouble.cjs') as { createAnimatedDouble(): any }).createAnimatedDouble());
const anim = animated.state as { running: number; configs: Array<Record<string, unknown>> };
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
const rn = vi.hoisted(() => ({
  View: primitive('View'), Pressable: primitive('Pressable'),
  ...animated.modules(primitive),
  StyleSheet: { create: (x: unknown) => x, flatten: (x: unknown) => Object.assign({}, ...[x].flat(Infinity as 1).filter(Boolean)), absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
  useWindowDimensions: () => ({ width: 390, height: 800 }),
}));
vi.mock('react-native', () => rn);
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 }) }));
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '../../src/ui/sheet/bottomSheet';

const finishAnimations = () => act(() => { animated.finishAll(); });
type Handle = { snapToIndex(index: number): void; close(): void };
let renderer: TestRenderer.ReactTestRenderer;
let ref: React.RefObject<Handle | null>;
let events: string[];

function mount(props: Record<string, unknown> = {}) {
  ref = React.createRef<Handle>();
  events = [];
  act(() => {
    renderer = TestRenderer.create(React.createElement(BottomSheet as any, {
      ref, index: -1, enableDynamicSizing: true, enablePanDownToClose: true,
      onChange: (index: number) => events.push(`change:${index}`),
      onAnimate: (from: number, to: number) => events.push(`animate:${from}->${to}`),
      backdropComponent: (backdropProps: Record<string, unknown>) => React.createElement(BottomSheetBackdrop as any, { ...backdropProps, pressBehavior: 'close', appearsOnIndex: 0, disappearsOnIndex: -1 }),
      ...props,
    }, React.createElement(BottomSheetView as any, { style: { padding: 8 } }, React.createElement('Content', { testID: 'content' }))));
  });
}
const contentView = () => renderer.root.find((node) => (node.type as unknown) === 'View' && node.props.style?.padding === 8);
const layContent = (height: number) => act(() => contentView().props.onLayout({ nativeEvent: { layout: { height } } }));
const sheet = () => renderer.root.find((node) => node.props.testID === 'lean-bottom-sheet');
const translateY = () => (StyleSheetFlatten(sheet().props.style).transform as Array<{ translateY: { value: number } }>)[0].translateY.value;
function StyleSheetFlatten(style: unknown) { return rn.StyleSheet.flatten(style) as Record<string, unknown>; }
const open = () => { layContent(300); act(() => ref.current!.snapToIndex(0)); finishAnimations(); };

beforeEach(() => { animated.reset(); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

describe('app-owned bottom sheet (stands in for @gorhom/bottom-sheet)', () => {
  it('keeps closed content mounted (pre-warmed) but off screen and untouchable', () => {
    mount();
    expect(renderer.root.findAll((node) => node.props.testID === 'content')).toHaveLength(1);
    expect(sheet().props.pointerEvents).toBe('none');
    expect(translateY()).toBeGreaterThanOrEqual(800);
  });

  it('remembers an open request made before the content height is known and opens once it is', () => {
    mount();
    act(() => ref.current!.snapToIndex(0));
    expect(events).toEqual([]);
    layContent(300);
    expect(events).toEqual(['animate:-1->0']);
    finishAnimations();
    expect(events).toEqual(['animate:-1->0', 'change:0']);
    expect(translateY()).toBe(0);
    expect(sheet().props.pointerEvents).toBe('auto');
  });

  it('closes with animate then change, and a second close while closed does nothing', () => {
    mount();
    open();
    act(() => ref.current!.close());
    finishAnimations();
    expect(events).toEqual(['animate:-1->0', 'change:0', 'animate:0->-1', 'change:-1']);
    act(() => ref.current!.close());
    finishAnimations();
    expect(events).toHaveLength(4);
  });

  it('closes when the backdrop is pressed, and draws no backdrop when the sheet has none', () => {
    mount();
    open();
    const backdrop = renderer.root.find((node) => node.props.testID === 'lean-bottom-sheet-backdrop');
    act(() => backdrop.props.onPress());
    finishAnimations();
    expect(events.slice(-2)).toEqual(['animate:0->-1', 'change:-1']);
    act(() => renderer.unmount());
    mount({ backdropComponent: () => null });
    open();
    expect(renderer.root.findAll((node) => node.props.testID === 'lean-bottom-sheet-backdrop')).toHaveLength(0);
  });

  it('closes when the handle is dragged down past a quarter of the sheet, and springs back otherwise', () => {
    mount();
    open();
    const handle = () => renderer.root.find((node) => node.props.testID === 'lean-bottom-sheet-handle');
    const pan = () => handle().props.panConfig as Record<string, (event: unknown, gesture: { dx: number; dy: number; vy: number }) => unknown>;
    expect(pan().onMoveShouldSetPanResponder({}, { dx: 0, dy: 10, vy: 0 })).toBe(true);
    act(() => { pan().onPanResponderMove({}, { dx: 0, dy: 40, vy: 0 }); });
    expect(translateY()).toBe(40);
    act(() => { pan().onPanResponderRelease({}, { dx: 0, dy: 40, vy: 0.1 }); });
    finishAnimations();
    expect(events).toEqual(['animate:-1->0', 'change:0']);
    expect(translateY()).toBe(0);
    act(() => { pan().onPanResponderMove({}, { dx: 0, dy: 120, vy: 0 }); });
    act(() => { pan().onPanResponderRelease({}, { dx: 0, dy: 120, vy: 0.1 }); });
    finishAnimations();
    expect(events.slice(-2)).toEqual(['animate:0->-1', 'change:-1']);
  });

  it('draws no handle or surface when the SDK passes null for them', () => {
    mount({ handleComponent: null, backgroundComponent: null });
    expect(renderer.root.findAll((node) => node.props.testID === 'lean-bottom-sheet-handle')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.testID === 'lean-bottom-sheet-background')).toHaveLength(0);
  });

  it('applies the SDK surface style and caps the height below the status bar', () => {
    mount({ backgroundStyle: { backgroundColor: '#fafafa' }, handleIndicatorStyle: { backgroundColor: '#aaa' } });
    const background = renderer.root.find((node) => node.props.testID === 'lean-bottom-sheet-background');
    expect(StyleSheetFlatten(background.props.style).backgroundColor).toBe('#fafafa');
    expect(StyleSheetFlatten(sheet().props.style).maxHeight).toBe(800 - 40);
  });

  it('leaves nothing animating after it settles, and only ever uses the native driver', () => {
    mount();
    open();
    act(() => ref.current!.close());
    finishAnimations();
    expect(anim.running).toBe(0);
    expect(anim.configs.length).toBeGreaterThan(0);
    expect(anim.configs.every((config) => config.useNativeDriver === true)).toBe(true);
  });

  it('stops an opening animation when it is closed halfway, so only the close reports', () => {
    mount();
    layContent(300);
    act(() => ref.current!.snapToIndex(0));
    act(() => ref.current!.close());
    finishAnimations();
    expect(events).toEqual(['animate:-1->0', 'animate:0->-1', 'change:-1']);
    expect(anim.running).toBe(0);
  });
});

describe('closed sheets are out of the accessibility tree on every platform', () => {
  const backdropWrapper = () => renderer.root.findAll((node) => node.props.testID === 'lean-bottom-sheet-backdrop')[0].parent!;
  it('hides a closed sheet and its backdrop button, and exposes them once open', () => {
    mount();
    expect(sheet().props.accessibilityElementsHidden).toBe(true);
    expect(sheet().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(backdropWrapper().props.accessibilityElementsHidden).toBe(true);
    act(() => ref.current!.snapToIndex(0));
    layContent(300);
    finishAnimations();
    expect(sheet().props.accessibilityElementsHidden).toBe(false);
    expect(sheet().props.importantForAccessibility).toBe('auto');
    expect(backdropWrapper().props.accessibilityElementsHidden).toBe(false);
  });
});
