import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

import { ReadingTaskCard } from '../../src/ui/ReadingTaskCard';

const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ');
const button = (renderer: TestRenderer.ReactTestRenderer, label: string) => renderer.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)[0];
const base = { date: '2026-09-17', references: ['1TI.4', '1TI.5', 'PSA.95'], onOpenReader: () => undefined, onComplete: () => undefined, onUndo: () => undefined };

describe('reading task card', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows sync text only while the record still needs the network', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ReadingTaskCard, { ...base, completed: true, syncStatus: 'CONFIRMED' })); });
    expect(texts(renderer)).not.toContain('已與伺服器確認');
    expect(texts(renderer)).not.toContain('尚未送出完成');
    act(() => { renderer.update(React.createElement(ReadingTaskCard, { ...base, completed: true, syncStatus: 'PENDING_SAVE' })); });
    expect(texts(renderer)).toContain('已保留在本機，等待同步');
    act(() => { renderer.update(React.createElement(ReadingTaskCard, { ...base, completed: false, syncStatus: 'SAVE_FAILED' })); });
    expect(texts(renderer)).toContain('同步失敗，保留待重試');
  });

  it('demotes undo to a quiet confirmed link that keeps a 48dp target', () => {
    const onUndo = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ReadingTaskCard, { ...base, onUndo, completed: true, syncStatus: 'CONFIRMED' })); });
    const undo = button(renderer, '撤銷今日讀經完成確認');
    expect(undo).toBeDefined();
    expect(undo.props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(undo.props.style.borderWidth).toBeUndefined();
    expect(texts(renderer)).toContain('撤銷');
    expect(texts(renderer)).not.toContain('撤銷確認');
    // Without a native Alert the confirmation degrades to the direct undo (never to a silent no-op).
    act(() => { undo.props.onPress(); });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(button(renderer, '確認今日已完成讀經')).toBeUndefined();
  });

  it('flashes +1 only when this day flips to completed, then clears it', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ReadingTaskCard, { ...base, completed: false, syncStatus: 'CONFIRMED' })); });
    expect(texts(renderer)).not.toContain('+1');
    act(() => { renderer.update(React.createElement(ReadingTaskCard, { ...base, completed: true, syncStatus: 'PENDING_SAVE' })); });
    expect(texts(renderer)).toContain('+1');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(texts(renderer)).not.toContain('+1');
    // Arriving on an already-completed day (date change) must not celebrate again.
    act(() => { renderer.update(React.createElement(ReadingTaskCard, { ...base, date: '2026-09-16', completed: true, syncStatus: 'CONFIRMED' })); });
    expect(texts(renderer)).not.toContain('+1');
    // First render of a completed day is not a flip either.
    let fresh!: TestRenderer.ReactTestRenderer;
    act(() => { fresh = TestRenderer.create(React.createElement(ReadingTaskCard, { ...base, completed: true, syncStatus: 'CONFIRMED' })); });
    expect(texts(fresh)).not.toContain('+1');
  });
});
