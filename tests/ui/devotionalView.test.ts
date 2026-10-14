import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { primitive, app, injected } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  app: { state: 'active', listeners: [] as Array<(state: string) => void> },
  injected: [] as string[],
}));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
  AppState: { get currentState() { return app.state; }, addEventListener: (_: string, listener: (state: string) => void) => { app.listeners.push(listener); return { remove: () => { app.listeners.splice(app.listeners.indexOf(listener), 1); } }; } },
}));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Path: el('Path'), Rect: el('Rect') }; });
vi.mock('@expo/dom-webview', () => ({ DomWebView: require('react').forwardRef((props: any, ref: any) => { require('react').useImperativeHandle(ref, () => ({ injectJavaScript: (script: string) => injected.push(script) })); return require('react').createElement('DomWebView', props); }) }));

import { DevotionalView, devotionMeta } from '../../src/ui/devotion/DevotionalView';
import type { DevotionalPost } from '../../src/services/devotionClient';

const originalConsoleError = console.error;
beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('not configured to support act')) return; originalConsoleError(...args); }; });
afterAll(() => { console.error = originalConsoleError; });

// Made-up content: the pastor's posts are served by the backend only.
const post: DevotionalPost = {
  date: '2026-10-14', weekday: '三', passages: '彼前5、詩118', title: '測試題目',
  sections: [{ heading: '背誦經文', paragraphs: ['第一段', '第二段'] }, { heading: '默想經文', paragraphs: ['第三段'] }],
  song: { youtubeId: 'abcdefghijk', title: '測試詩歌' },
};
const props = (overrides: Partial<React.ComponentProps<typeof DevotionalView>> = {}): React.ComponentProps<typeof DevotionalView> => ({
  state: { kind: 'ready', post }, activeIndex: -1, playerUrl: 'https://api.test/api/devotional/player', songRequest: 0, songFollows: true, insets: { top: 96, bottom: 200 }, ...overrides,
});
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');

describe('the 靈修 tab', () => {
  it('reports the real scroll bottom, including short content and leaving the bottom (#8)', () => {
    const onEndChange = vi.fn(); let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ onEndChange }))); });
    const scroll = tree.root.findAll(n => String(n.type) === 'ScrollView')[0];
    act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 600 } } }));
    act(() => scroll.props.onContentSizeChange(393, 1400));
    expect(onEndChange).toHaveBeenLastCalledWith(false);
    act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 800 }, layoutMeasurement: { height: 600 }, contentSize: { height: 1400 } } }));
    expect(onEndChange).toHaveBeenLastCalledWith(true);
    act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 200 }, layoutMeasurement: { height: 600 }, contentSize: { height: 1400 } } }));
    expect(onEndChange).toHaveBeenLastCalledWith(false);
    act(() => scroll.props.onContentSizeChange(393, 400));
    expect(onEndChange).toHaveBeenLastCalledWith(true);
    act(() => tree.unmount());
  });
  it('shows the post with its title in 《》, the pastor’s line, the paragraph being read lit, and a song poster that loads nothing', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ activeIndex: 2 }))); });
    const texts = tree.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);
    expect(texts).toEqual(expect.arrayContaining(['《測試題目》', '傳道 · 2026.10.14 (三) 讀經：彼前5、詩118', '背誦經文', '默想經文', '測試詩歌', '朗讀完自動播放 · 螢幕亮著才播']));
    expect(devotionMeta(post)).toBe('傳道 · 2026.10.14 (三) 讀經：彼前5、詩118');
    const lit = tree.root.findAll((node) => (node.type as unknown) === 'Text' && Array.isArray(node.props.style) && Boolean(node.props.style[1]));
    expect(lit.map(textOf)).toEqual(['第三段']);
    expect(tree.root.findAll((node) => (node.type as unknown) === 'DomWebView')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('plays the song after the reading only while the screen is on, and pauses it when the app leaves the screen', () => {
    injected.length = 0; app.state = 'active';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props())); });
    act(() => tree.update(React.createElement(DevotionalView, props({ songRequest: 1 }))));
    const player = tree.root.find((node) => (node.type as unknown) === 'DomWebView');
    expect(player.props.source).toEqual({ uri: 'https://api.test/api/devotional/player?v=abcdefghijk' });
    expect(player.props.mediaPlaybackRequiresUserAction).toBe(false);
    act(() => player.props.onMessage({ nativeEvent: { data: 'ready' } }));
    expect(injected).toEqual(['window.qmPlay&&window.qmPlay();true;']);
    act(() => player.props.onMessage({ nativeEvent: { data: 'playing' } }));
    expect(tree.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf)).toContain('播放中 · 螢幕關掉就停');
    act(() => app.listeners.forEach((listener) => listener('background')));
    expect(injected.at(-1)).toBe('window.qmPause&&window.qmPause();true;');
    act(() => tree.unmount());
  });

  it('leaves the song for a tap when the reading ends with the screen off', () => {
    app.state = 'background';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props())); });
    act(() => tree.update(React.createElement(DevotionalView, props({ songRequest: 1 }))));
    expect(tree.root.findAll((node) => (node.type as unknown) === 'DomWebView')).toHaveLength(0);
    app.state = 'active';
    act(() => tree.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '播放詩歌 測試詩歌').props.onPress());
    expect(tree.root.findAll((node) => (node.type as unknown) === 'DomWebView')).toHaveLength(1);
    act(() => tree.unmount());
  });

  it('says plainly when the day has no post yet', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ state: { kind: 'missing' } }))); });
    expect(tree.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf)).toEqual(['這一天的靈修還沒有上傳']);
    act(() => tree.unmount());
  });
});
