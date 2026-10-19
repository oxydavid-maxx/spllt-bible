import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

import { SelectedDayCard } from '../../src/ui/gamification/SelectedDayCard';
import type { CalendarDay } from '../../src/ui/gamification/readingCalendarModel';

/**
 * The first card on the member's own 積分 page (維護者 2026-10-19, mock 2 and 3): the day the calendar
 * picked, its passages and its two buttons. Monday 10/19 is today; 10/17 is the Saturday tapped in
 * the calendar, already read.
 */

const TODAY = '2026-10-19';
const day = (patch: Partial<CalendarDay> = {}): CalendarDay => ({ planId: 'church-2026-10', references: ['2PE.1', '2PE.2', 'PSA.122'], completed: false, canComplete: true, ...patch });

function render(props: Partial<React.ComponentProps<typeof SelectedDayCard>> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(SelectedDayCard, {
      date: TODAY, today: TODAY, day: day(), action: React.createElement('Action'), onBackToToday: () => undefined, ...props,
    }));
  });
  return renderer;
}
const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
const actions = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'Action');
const backToToday = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '回到今天');

describe('the day card', () => {
  it('names today 今天· with its passages on one line, then the buttons; no 補登, no 回到今天', () => {
    const view = render();
    expect(texts(view).slice(0, 2)).toEqual(['今天·10/19 (一)', '彼後1、彼後2、詩122']);
    expect(actions(view)).toHaveLength(1);
    expect(texts(view)).not.toContain('補登');
    expect(backToToday(view)).toHaveLength(0);
  });

  it('puts 補登 before another day, keeps its buttons (a finished day is where its undo lives), and offers 回到今天 ›', () => {
    const onBackToToday = vi.fn();
    const view = render({ date: '2026-10-17', day: day({ references: ['2PE.1', 'PSA.120', 'PSA.121'], completed: true }), onBackToToday });
    expect(texts(view).slice(0, 3)).toEqual(['補登', '10/17 (六)', '彼後1、詩120、詩121']);
    expect(actions(view)).toHaveLength(1);
    expect(texts(view)).toContain('回到今天 ›');
    act(() => { backToToday(view)[0].props.onPress(); });
    expect(onBackToToday).toHaveBeenCalledOnce();
  });

  it('gives an old, a rest or a future day one line instead of the buttons, without 補登', () => {
    for (const [date, value, line] of [
      ['2026-10-09', day(), '10/9 (五) 已超過 7 天，不能補登'],
      ['2026-10-18', undefined, '10/18 (日) 這天沒有讀經'],
      ['2026-10-21', day(), '10/21 (三) 還沒到，當天再來打卡'],
    ] as const) {
      const view = render({ date, day: value });
      expect(texts(view).filter((text) => text === line)).toHaveLength(1);
      expect(actions(view)).toHaveLength(0);
      expect(texts(view)).not.toContain('補登');
      expect(backToToday(view)).toHaveLength(1);
    }
  });

  it('says why today has no button when today has no reading, with nothing to go back to', () => {
    const view = render({ date: '2026-10-18', today: '2026-10-18', day: undefined });
    expect(texts(view)).toEqual(['10/18 (日) 這天沒有讀經']);
    expect(actions(view)).toHaveLength(0);
    expect(backToToday(view)).toHaveLength(0);
  });
});
