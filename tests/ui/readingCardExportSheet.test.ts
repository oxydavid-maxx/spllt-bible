import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? require('react').createElement('Sheet', props, props.children) : null }));
import { ReadingCardExportSheet } from '../../src/ui/gamification/ReadingCardExportSheet';

describe('export bottom sheet', () => {
  it('uses approved text, current Taipei month/quarter and accessible actions', () => {
    const onExport = vi.fn(), onClose = vi.fn();
    let view!: TestRenderer.ReactTestRenderer;
    act(() => { view = TestRenderer.create(React.createElement(ReadingCardExportSheet, { visible: true, today: '2026-10-18', busy: false, error: null, onExport, onClose })); });
    expect(view.root.findByType('Sheet' as any).props.title).toBe('匯出讀經卡');
    expect(view.root.findByType('Sheet' as any).props.onClose).toBe(onClose);
    expect(JSON.stringify(view.toJSON())).toContain('按下去產生 PDF，接著選列印或分享。');
    act(() => view.root.findAllByProps({ accessibilityLabel: '本月 (10 月)' })[0].props.onPress());
    act(() => view.root.findAllByProps({ accessibilityLabel: '本季 (10–12 月)' })[0].props.onPress());
    expect(onExport.mock.calls).toEqual([['month'], ['quarter']]);
    act(() => { view.update(React.createElement(ReadingCardExportSheet, { visible: true, today: '2027-01-01', busy: true, error: '產生失敗，請重試。', onExport, onClose })); });
    expect(view.root.findAllByProps({ accessibilityLabel: '本季 (1–3 月)' })[0].props.disabled).toBe(true);
    expect(view.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
  });
});
