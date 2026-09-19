import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ ScrollView: primitive('ScrollView'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

import { ITEM_HEIGHT, TimeWheelPicker, formatTime, indexForOffset, parseTime, snapMinute, stepTime } from '../../src/ui/TimeWheelPicker';

describe('time wheel helpers', () => {
  it('parses, formats, snaps and steps on 5-minute rows with midnight wrap', () => {
    expect(parseTime('06:30')).toEqual({ hour: 6, minute: 30 });
    expect(parseTime('24:00')).toBeNull();
    expect(formatTime(6, 5)).toBe('06:05');
    expect(snapMinute(7)).toBe(5);
    expect(snapMinute(58)).toBe(55);
    expect(stepTime('06:30', 1)).toBe('06:35');
    expect(stepTime('23:55', 1)).toBe('00:00');
    expect(stepTime('00:00', -1)).toBe('23:55');
    expect(indexForOffset(ITEM_HEIGHT * 2.4, 24)).toBe(2);
    expect(indexForOffset(-10, 24)).toBe(0);
    expect(indexForOffset(ITEM_HEIGHT * 99, 12)).toBe(11);
  });
});

describe('TimeWheelPicker', () => {
  it('commits a settled wheel immediately and only when the value changed', () => {
    const onChange = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TimeWheelPicker, { value: '06:30', onChange })); });
    const wheel = (label: string) => renderer.root.findByProps({ testID: `wheel-${label}` });
    act(() => { wheel('minute').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 9 } } }); });
    expect(onChange).toHaveBeenLastCalledWith('06:45');
    act(() => { wheel('hour').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 7 } } }); });
    expect(onChange).toHaveBeenLastCalledWith('07:30');
    // Settling on the row already selected is not a change.
    act(() => { wheel('hour').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 6 } } }); });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('exposes one adjustable control with the current time and 5-minute accessibility steps', () => {
    const onChange = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(TimeWheelPicker, { value: '08:07', onChange })); });
    const control = renderer.root.findByProps({ accessibilityLabel: '每日讀經時間' });
    expect(control.props.accessibilityRole).toBe('adjustable');
    expect(control.props.accessibilityValue.text).toContain('08:05');
    act(() => { control.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); });
    expect(onChange).toHaveBeenLastCalledWith('08:00');
  });
});
