import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

import { ReadingCalendarCard } from '../../src/ui/gamification/ReadingCalendarCard';
import { dayHeading, dayMessage, dayState, defaultSelectedDate, monthCells, readingDaysRange, shiftMonth, type CalendarDay } from '../../src/ui/gamification/readingCalendarModel';

/**
 * The 積分 page's own calendar, as the approved mock draws it: today 9/27 is a Sunday with no
 * reading, 9/26 is done, so the day waiting for you is 9/25 and the button under the grid is for it.
 */

const TODAY = '2026-09-27';
const day = (patch: Partial<CalendarDay> = {}): CalendarDay => ({ planId: 'church-2026-09', references: ['TIT.1', 'TIT.2', 'PSA.101'], completed: false, canComplete: true, ...patch });
function september(completed: string[]): Map<string, CalendarDay> {
  const days = new Map<string, CalendarDay>();
  for (let index = 1; index <= 30; index += 1) {
    const date = `2026-09-${String(index).padStart(2, '0')}`;
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) continue; // Sundays have no reading
    days.set(date, day({ completed: completed.includes(date) }));
  }
  return days;
}
const mockDone = ['2026-09-11', '2026-09-12', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-26'];

describe('what the selected day says', () => {
  it('writes the date the way the page does, M/D and the weekday', () => {
    expect(dayHeading('2026-09-25')).toBe('9/25（五）');
    expect(dayHeading('2026-09-20')).toBe('9/20（日）');
  });

  it('tells an old, a rest and a future day apart, each in one line', () => {
    const days = september(mockDone);
    expect(dayState('2026-09-10', TODAY, days.get('2026-09-10'))).toBe('expired');
    expect(dayMessage('2026-09-10', 'expired')).toBe('9/10（四）已超過 7 天，不能補登');
    expect(dayState('2026-09-20', TODAY, days.get('2026-09-20'))).toBe('rest');
    expect(dayMessage('2026-09-20', 'rest')).toBe('9/20（日）這天沒有讀經');
    expect(dayState('2026-09-29', TODAY, days.get('2026-09-29'))).toBe('future');
    expect(dayMessage('2026-09-29', 'future')).toBe('9/29（二）還沒到，當天再來打卡');
    expect(dayState('2026-09-25', TODAY, days.get('2026-09-25'))).toBe('open');
    expect(dayState('2026-09-26', TODAY, days.get('2026-09-26'))).toBe('completed');
    // The window is the existing seven days: 9/21 is the oldest day still open on 9/27.
    expect(dayState('2026-09-21', TODAY, day())).toBe('open');
    expect(dayState('2026-09-20', TODAY, day())).toBe('expired');
  });
});

describe('the day selected when the page opens', () => {
  it('is today when today has a reading', () => {
    expect(defaultSelectedDate('2026-09-25', september([]))).toBe('2026-09-25');
  });
  it('is the most recent unfinished reading day in the window when today has none', () => {
    expect(defaultSelectedDate(TODAY, september(mockDone))).toBe('2026-09-25');
  });
  it('is today when everything in the window is done', () => {
    expect(defaultSelectedDate(TODAY, september(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']))).toBe(TODAY);
  });
});

describe('the month it draws', () => {
  // 光佑 2026-09-27: the week starts on Sunday (日), as church calendars here do.
  it('starts on Sunday, with blanks before the first', () => {
    const cells = monthCells('2026-09');
    expect(cells.slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(monthCells('2026-11')[0]).toBe('2026-11-01');
  });
  it('moves across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('asks for the whole month, reaching back into last month when the window does', () => {
    expect(readingDaysRange('2026-09', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(readingDaysRange('2026-10', '2026-10-03')).toEqual({ from: '2026-09-27', to: '2026-10-31' });
    expect(readingDaysRange('2026-08', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });
});

function render(props: Partial<React.ComponentProps<typeof ReadingCalendarCard>> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(ReadingCalendarCard, {
      month: '2026-09', today: TODAY, selectedDate: '2026-09-25', days: september(mockDone), onSelect: () => undefined,
      action: React.createElement('Action'), ...props,
    }));
  });
  return renderer;
}
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style as unknown[]).filter(Boolean));
const cell = (renderer: TestRenderer.ReactTestRenderer, date: string) => renderer.root.findAll((node) => (node.type as unknown) === 'Pressable' && String(node.props.accessibilityLabel ?? '').startsWith(`${date} `))[0];
const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));

describe('the calendar card', () => {
  it('draws the month Sunday first with ‹ › and one tappable cell per day', () => {
    const view = render({ onPreviousMonth: () => undefined, onNextMonth: () => undefined });
    const shown = texts(view);
    expect(shown).toContain('2026年9月');
    expect(shown.slice(shown.indexOf('日'), shown.indexOf('日') + 7)).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(view.root.findByProps({ accessibilityLabel: '上個月' })).toBeDefined();
    expect(view.root.findByProps({ accessibilityLabel: '下個月' })).toBeDefined();
    expect(view.root.findAll((node) => (node.type as unknown) === 'Pressable' && /^2026-09-\d{2} /.test(String(node.props.accessibilityLabel ?? '')))).toHaveLength(30);
  });

  it('fills finished days, rings today, and marks the selected day in the accent', () => {
    const view = render();
    expect(flat(cell(view, '2026-09-26').props.style).backgroundColor).toBe('#1A5544');
    expect(cell(view, '2026-09-26').props.accessibilityLabel).toContain('已完成');
    expect(flat(cell(view, '2026-09-27').props.style).borderColor).toBe('#123B30');
    expect(flat(cell(view, '2026-09-25').props.style).borderColor).toBe('#8A4A19');
    expect(cell(view, '2026-09-25').props.accessibilityState).toEqual({ selected: true });
  });

  it('puts the selected day, its passages and the action under the grid', () => {
    const view = render();
    expect(texts(view)).toEqual(expect.arrayContaining(['9/25（五）', '多1、多2、詩101']));
    expect(view.root.findAll((node) => (node.type as unknown) === 'Action')).toHaveLength(1);
  });

  it('does not display a correction explanation (reading-plan.md 決定)', () => {
    expect(texts(render()).join('')).not.toContain('讀經表原本');
  });

  it('shows one line and no action for a day that cannot be completed', () => {
    for (const [date, line] of [['2026-09-10', '9/10（四）已超過 7 天，不能補登'], ['2026-09-20', '9/20（日）這天沒有讀經'], ['2026-09-29', '9/29（二）還沒到，當天再來打卡']]) {
      const view = render({ selectedDate: date });
      expect(texts(view)).toContain(line);
      expect(view.root.findAll((node) => (node.type as unknown) === 'Action')).toHaveLength(0);
    }
  });

  it('keeps the action for a finished day, which is where its undo lives', () => {
    const view = render({ selectedDate: '2026-09-26' });
    expect(view.root.findAll((node) => (node.type as unknown) === 'Action')).toHaveLength(1);
  });

  it('reports the tapped day and the month arrows', () => {
    const onSelect = vi.fn(); const onPreviousMonth = vi.fn();
    const view = render({ onSelect, onPreviousMonth });
    act(() => { cell(view, '2026-09-24').props.onPress(); });
    act(() => { view.root.findByProps({ accessibilityLabel: '上個月' }).props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('2026-09-24');
    expect(onPreviousMonth).toHaveBeenCalledOnce();
    expect(view.root.findByProps({ accessibilityLabel: '下個月' }).props.disabled).toBe(true);
  });
});
