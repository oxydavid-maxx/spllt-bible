import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { primitive, app, injected, scrolls, opened } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  app: { state: 'active', listeners: [] as Array<(state: string) => void> },
  injected: [] as string[],
  opened: [] as string[],
  scrolls: [] as Array<{ y: number }>,
}));
vi.mock('react-native', () => ({
  Linking: { openURL: async (url: string) => { opened.push(url); injected.push('openURL'); } },
  ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'),
  ScrollView: require('react').forwardRef((props: any, ref: any) => { require('react').useImperativeHandle(ref, () => ({ scrollTo: (to: { y: number }) => scrolls.push(to) })); return require('react').createElement('ScrollView', props, props.children); }),
  StyleSheet: { create: (value: unknown) => value },
  AppState: { get currentState() { return app.state; }, addEventListener: (_: string, listener: (state: string) => void) => { app.listeners.push(listener); return { remove: () => { app.listeners.splice(app.listeners.indexOf(listener), 1); } }; } },
}));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Path: el('Path'), Rect: el('Rect') }; });
vi.mock('@expo/dom-webview', () => ({ DomWebView: require('react').forwardRef((props: any, ref: any) => { require('react').useImperativeHandle(ref, () => ({ injectJavaScript: (script: string) => injected.push(script) })); return require('react').createElement('DomWebView', props); }) }));

import { DevotionalView, devotionMeta } from '../../src/ui/devotion/DevotionalView';
import { READ_ALONG_HIGHLIGHT } from '../../src/ui/readAlongBridge';
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
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const textNamed = (tree: TestRenderer.ReactTestRenderer, text: string) => tree.root.find((node) => (node.type as unknown) === 'Text' && textOf(node) === text);

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
    const lit = tree.root.findAll((node) => (node.type as unknown) === 'Text' && flat(node.props.style).backgroundColor !== undefined);
    expect(lit.map(textOf)).toEqual(['第三段']);
    expect(tree.root.findAll((node) => (node.type as unknown) === 'DomWebView')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('sets its words in the reader\'s own 調整字體 size and spacing, and lights the paragraph in the scripture read-along grey (光佑 2026-10-14)', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ activeIndex: 0 }))); });
    // Never changed: the SDK's own defaults, so nothing moves for members who left 調整字體 alone.
    expect(flat(textNamed(tree, '第二段').props.style)).toMatchObject({ fontSize: 16, lineHeight: 27 });
    act(() => tree.update(React.createElement(DevotionalView, props({ activeIndex: 0, fontSize: 20, lineSpacing: 2 }))));
    expect(flat(textNamed(tree, '第二段').props.style)).toMatchObject({ fontSize: 20, lineHeight: 40 });
    // Headings and the title grow by the same ratio, so the page keeps its order.
    expect(flat(textNamed(tree, '背誦經文').props.style).fontSize).toBe(19);
    expect(flat(textNamed(tree, '《測試題目》').props.style).fontSize).toBe(24);
    const lit = flat(textNamed(tree, '第一段').props.style);
    expect(String(lit.backgroundColor).toLowerCase()).toBe(`#${READ_ALONG_HIGHLIGHT}`.toLowerCase());
    expect(lit.fontSize).toBe(20);
    expect(flat(textNamed(tree, '第二段').props.style).backgroundColor).toBeUndefined();
    act(() => tree.unmount());
  });

  it('moves to the paragraph being read when the reading starts or resumes, and to the title for the first one (光佑 2026-10-14)', () => {
    scrolls.length = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ activeIndex: 2, speaking: false }))); });
    const sections = tree.root.findAll((node) => (node.type as unknown) === 'View' && typeof node.props.onLayout === 'function');
    act(() => { sections[1].props.onLayout({ nativeEvent: { layout: { y: 500 } } }); textNamed(tree, '第三段').props.onLayout({ nativeEvent: { layout: { y: 40 } } }); });
    // Paused on 第三段 after the member scrolled away: nothing pulls the page back until ▶.
    expect(scrolls).toEqual([]);
    act(() => tree.update(React.createElement(DevotionalView, props({ activeIndex: 2, speaking: true }))));
    // The date row and chapter chips lie over the top of the page (insets.top 96): the paragraph
    // starts just under them, where the title sits on an unscrolled page, not hidden beneath them.
    expect(scrolls.at(-1)).toMatchObject({ y: 500 + 40 - (96 + 14) });
    act(() => tree.update(React.createElement(DevotionalView, props({ activeIndex: 0, speaking: true }))));
    expect(scrolls.at(-1)).toMatchObject({ y: 0 });
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

it('renders leading citations as smaller grey text without changing a single displayed character', () => {
  const paragraphs = ['彼得前書 5:2 測試甲。', '5:7 測試乙。', '5:8-9 測試丙。', '詩篇 118:15 測試丁。', '正文中的 5:7 不縮小。'];
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ state: { kind: 'ready', post: { ...post, sections: [{ heading: '背誦經文', paragraphs }] } }, fontSize: 20 }))); });
  for (const paragraph of paragraphs) expect(textOf(textNamed(tree, paragraph))).toBe(paragraph);
  const refs = tree.root.findAll(n => String(n.type) === 'Text' && n.props.testID === 'devotion-reference');
  expect(refs.map(textOf)).toEqual(['彼得前書 5:2 ', '5:7 ', '5:8-9 ', '詩篇 118:15 ']);
  refs.forEach(n => { expect(flat(n.props.style).fontSize).toBeLessThan(20); expect(flat(n.props.style).color).toBe('#636161'); });
  act(() => tree.unmount());
});


describe('song attribution and the original YouTube video', () => {
  it.each([
    ['測試詩歌', '測試《官方頻道 》', '測試詩歌 · 測試《官方頻道 》'],
    ['測試詩歌', null, '測試詩歌'],
    [null, null, null],
  ])('shows attribution for title=%s channel=%s before playback', (title, channel, expected) => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ state: { kind: 'ready', post: { ...post, song: { ...post.song, title, channel } } } }))); });
    const attribution = tree.root.findAll(n => String(n.type) === 'Text' && n.props.testID === 'song-attribution');
    expect(attribution.map(textOf)).toEqual(expected ? [expected] : []);
    if (expected) {
      expect(attribution[0].props.numberOfLines).toBe(2);
      expect(attribution[0].props.ellipsizeMode).toBe('tail');
      expect(flat(attribution[0].props.style)).toMatchObject({ color: '#4C5F57', fontSize: 13, lineHeight: 18 });
    }
    const link = tree.root.find(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === `在 YouTube 開啟 ${title ?? '今天的詩歌'}`);
    expect(textOf(link)).toBe('在 YouTube 開啟 ›');
    expect(flat(link.props.style)).toMatchObject({ marginLeft: 'auto', minHeight: 48 });
    expect(flat(textNamed(tree, '在 YouTube 開啟 ›').props.style)).toMatchObject({ color: '#1A5544', fontSize: 13, fontWeight: '800' });
    expect(tree.root.findAll(n => String(n.type) === 'DomWebView')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('shows no song card, attribution or YouTube link without a song', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props({ state: { kind: 'ready', post: { ...post, song: { youtubeId: '', title: null } } } }))); });
    expect(tree.root.findAll(n => String(n.type) === 'Pressable')).toHaveLength(0);
    act(() => tree.unmount());
  });

  it.each(['poster', 'loading', 'playing'])('opens the exact original URL from %s, pausing first when active', async (status) => {
    app.state = 'active'; injected.length = 0; opened.length = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props())); });
    if (status !== 'poster') {
      act(() => tree.root.find(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === '播放詩歌 測試詩歌').props.onPress());
      if (status === 'playing') act(() => tree.root.find(n => String(n.type) === 'DomWebView').props.onMessage({ nativeEvent: { data: 'playing' } }));
    }
    injected.length = 0;
    await act(async () => tree.root.find(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === '在 YouTube 開啟 測試詩歌').props.onPress());
    expect(opened).toEqual(['https://www.youtube.com/watch?v=abcdefghijk']);
    expect(injected).toEqual(status === 'poster' ? ['openURL'] : ['window.qmPause&&window.qmPause();true;', 'openURL']);
    if (status !== 'poster') {
      expect(tree.root.findAll(n => String(n.type) === 'Text').map(textOf)).toContain('已暫停 · 螢幕亮著才播');
      act(() => tree.root.find(n => String(n.type) === 'DomWebView').props.onMessage({ nativeEvent: { data: 'ready' } }));
      expect(injected.join('')).not.toContain('qmPlay');
    }
    act(() => tree.unmount());
  });
});


it.each(['loading', 'playing'])('keeps native manual playback available after a YouTube handoff from %s', async status => {
  app.state = 'active'; injected.length = 0; opened.length = 0;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(React.createElement(DevotionalView, props())); });
  try {
    act(() => tree.root.find(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === '播放詩歌 測試詩歌').props.onPress());
    const message = (data: string) => act(() => tree.root.find(n => String(n.type) === 'DomWebView').props.onMessage({ nativeEvent: { data } }));
    if (status === 'playing') message('playing');
    await act(async () => tree.root.find(n => String(n.type) === 'Pressable' && n.props.accessibilityLabel === '在 YouTube 開啟 測試詩歌').props.onPress());
    message('ready'); // Late initialization must not auto-start after handoff.
    expect(injected.join('')).not.toContain('qmPlay');
    message('paused');
    injected.length = 0;
    // The existing embedded player's own play control reports playing when the member resumes.
    message('playing');
    expect(injected).toEqual([]);
    expect(tree.root.findAll(n => String(n.type) === 'Text').map(textOf)).toContain('播放中 · 螢幕關掉就停');
  } finally { act(() => tree.unmount()); }
});
