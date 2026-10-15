import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Rect: 'Rect' }));
import { DevotionTodayButton } from '../../src/ui/gamification/DevotionTodayButton';
import { CompletionTodayButton } from '../../src/ui/CompletionTodayButton';
const flatten = (s: unknown): any => Object.assign({}, ...[s].flat(Infinity).filter(Boolean));
describe('mock J completion buttons (#2/#3/#11/#12)', () => {
  it.each([[false, false], [false, true], [true, true]])('same green semantics, devotional left, reading right (%s/%s)', (devotionDone, readingDone) => {
    let tree!: TestRenderer.ReactTestRenderer;
    const toggle = vi.fn();
    act(() => { tree = TestRenderer.create(React.createElement(React.Fragment, null,
      React.createElement(DevotionTodayButton, { date: '2026-10-14', today: '2026-10-14', completed: devotionDone, canMark: true, pending: false, onToggle: toggle }),
      React.createElement(CompletionTodayButton, { record: { taskDate: '2026-10-14', status: readingDone ? 'COMPLETED' : 'NOT_COMPLETED', syncStatus: 'SYNCED' } as any, pending: false, retryable: false, canComplete: true, onComplete: vi.fn(), onUndo: vi.fn() })) ); });
    const buttons = tree.root.findAll(n => String(n.type) === 'Pressable');
    expect(buttons.map(b => b.props.accessibilityLabel)).toEqual([devotionDone ? '今日靈修已完成' : '完成今日靈修', readingDone ? '今日讀經已完成' : '完成今日讀經']);
    buttons.forEach((b, i) => {
      const done = i === 0 ? devotionDone : readingDone;
      expect(flatten(b.props.style)).toMatchObject({ backgroundColor: done ? '#1A5544' : '#FFFFFF', borderWidth: 1.5, borderColor: '#1A5544' });
      const label = b.findAll(n => String(n.type) === 'Text')[0];
      expect(flatten(label.props.style).color).toBe(done ? '#FFFFFF' : '#1A5544');
      const paths = b.findAll(n => String(n.type) === 'Path').map(p => p.props.d);
      expect(paths).toContain(i === 0
        ? done ? 'M9 16c-3.6 0-6-2.2-6-5.6 3.6 0 6 2.2 6 5.6z' : 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14z'
        // 讀經 K1 (維護者 2026-10-14): a closed Bible with a cross; read, it opens and gives light.
        : done ? 'M12 2v4' : 'M11 10.5h6');
    });
    act(() => buttons[0].props.onPress()); expect(toggle).toHaveBeenCalledWith(!devotionDone);
    act(() => tree.unmount());
  });
});
