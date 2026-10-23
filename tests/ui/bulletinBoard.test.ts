import React from 'react';
import { readFileSync } from 'node:fs';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 公告「青少｜主堂」 and the 主堂週刊 (維護者 2026-10-17, mock 2-4).
const state = vi.hoisted(() => ({
  congregation: { status: 'ready', value: null } as { status: string; value: 'youth' | 'main' | null },
  fetchBulletins: vi.fn(),
  focus: [] as Array<() => void>,
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  // Every time an Image is mounted, by its uri: a mounted Image asks for its picture, so a retry has to mount it again.
  mounts: new Map<string, number>(),
}));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
const image = vi.hoisted(() => (props: { source?: unknown }) => {
  const React = require('react');
  const uri = String((props.source as Array<{ uri?: string }> | undefined)?.[0]?.uri);
  React.useEffect(() => { state.mounts.set(uri, (state.mounts.get(uri) ?? 0) + 1); }, []);
  return React.createElement('Image', props);
});
vi.mock('react-native', () => ({
  Animated: { Value: class { constructor(public value: number) {} setValue(next: number) { this.value = next; } }, Image: primitive('AnimatedImage'), View: primitive('AnimatedView') },
  FlatList: (props: { data: unknown[]; renderItem: (row: { item: unknown; index: number }) => unknown; keyExtractor: (item: unknown) => string }) =>
    require('react').createElement('FlatList', props, props.data.map((item, index) => require('react').createElement(require('react').Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))),
  Image: image, Linking: { openURL: vi.fn() }, Modal: primitive('Modal'), PanResponder: { create: () => ({ panHandlers: {} }) },
  // A Pixel 8: 412 × 915 dp at 2.625 (1080 px wide). The test window is 400 dp wide.
  PixelRatio: { get: () => 2.625, getPixelSizeForLayoutSize: (size: number) => Math.round(size * 2.625) },
  Platform: { OS: 'android' }, Pressable: primitive('Pressable'), StyleSheet: { create: (s: unknown) => s, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } }, Text: primitive('Text'), View: primitive('View'),
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: (props: { children?: unknown }) => require('react').createElement('SafeAreaView', props, props.children), useSafeAreaInsets: () => state.insets }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, [callback]); } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));
vi.mock('../../src/services/announcementClient', () => ({ createAnnouncementClient: () => ({ readCached: async () => null, load: async () => ({ announcement: null, stale: false }), cancel: () => undefined }) }));
vi.mock('../../src/ui/AnnouncementBoard', () => ({ AnnouncementBoard: () => null }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => null }));
vi.mock('../../src/ui/UpdateCard', () => ({ UpdateCard: () => null }));
vi.mock('../../src/ui/UpdatePrompt', () => ({ installedVersionCode: () => 1 }));
vi.mock('../../src/services/appUpdate', () => ({ checkAppUpdate: async () => ({ available: false }), startAppUpdate: vi.fn() }));
vi.mock('../../src/services/eventRegistrationClient', () => ({ eventDateFromLabel: () => null, fetchEventRegistrations: async () => null }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'm1', sessionToken: 'tok' } }) }));
vi.mock('../../src/ui/congregation/congregationStore', () => ({ useCongregation: () => state.congregation }));
vi.mock('../../src/services/bulletinClient', async (original) => ({ ...(await original<typeof import('../../src/services/bulletinClient')>()), fetchBulletins: state.fetchBulletins }));
import AnnouncementsScreen from '../../app/(tabs)/announcements';
import { viewCache } from '../../src/services/viewCache';
import { BulletinBoard } from '../../src/ui/bulletin/BulletinBoard';
import { bulletinHeading, bulletinPageSource } from '../../src/services/bulletinClient';
import { BULLETIN_LIST_WIDTHS, bulletinListWidth } from '../../src/domain/bulletinWidths';
import { theme } from '../../src/ui/Theme';
import { PAGE_PLACEHOLDER } from '../../src/ui/bulletin/BulletinPageStatus';
import { clampOffset, fitSize, pinchScale } from '../../src/ui/bulletin/zoomMath';
import { androidForwardedHeaders } from '../helpers/androidImageHeaders';

const WEEKS = [
  { date: '2026-10-18', postedAt: '2026-10-17T02:00:00.000Z', pages: [1, 2, 3].map((index) => ({ index, width: 760, height: 1075 })) },
  { date: '2026-10-11', postedAt: '2026-10-10T02:00:00.000Z', pages: [1, 2].map((index) => ({ index, width: 760, height: 1075 })) },
];
const LOADING = '週刊載入中…';
const FAILED = '這頁載不到，點一下再試';
let tree: TestRenderer.ReactTestRenderer | null = null;
const texts = () => tree!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
const byLabel = (label: string) => tree!.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const images = () => tree!.root.findAll((node) => String(node.type) === 'Image');
const uriOf = (node: TestRenderer.ReactTestInstance) => (node.props.source as Array<{ uri: string }>)[0].uri;
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style as Record<string, unknown>) ?? {});
const modal = () => tree!.root.findAll((node) => String(node.type) === 'Modal')[0];

beforeEach(() => {
  state.fetchBulletins.mockReset().mockResolvedValue(WEEKS);
  viewCache.clear();
  state.congregation = { status: 'ready', value: null };
  state.insets = { top: 0, bottom: 0, left: 0, right: 0 };
  state.mounts.clear();
});
afterEach(() => { act(() => tree?.unmount()); tree = null; });

describe('the 公告 tabs', () => {
  it('opens on 主堂 for a 主堂 member and shows only the 週刊 there', async () => {
    state.congregation = { status: 'ready', value: 'main' };
    await act(async () => { tree = TestRenderer.create(React.createElement(AnnouncementsScreen)); });
    expect(byLabel('主堂').props.accessibilityState).toEqual({ selected: true });
    expect(state.fetchBulletins).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' }));
    expect(texts()).toEqual(expect.arrayContaining(['10/18 (日) 週刊', '3 張・點圖片放大', '10/11 (日) 週刊']));
    // The screen's own sources (bulletinPageSource): the token has to reach Android's native image request too.
    const pages = images();
    expect(pages).toHaveLength(5);
    for (const page of pages) expect(androidForwardedHeaders(page.props.source)).toEqual({ authorization: 'Bearer tok' });
    // And the list asks for the phone-size copy, not the original (2481 × 3509 on 10/18, about 3× what a phone needs).
    for (const page of pages) expect(uriOf(page)).toMatch(/\/api\/bulletins\/\d{4}-\d{2}-\d{2}\/\d\?w=1080$/);
  });

  it('opens on 青少 for everyone else, and either side can be chosen', async () => {
    await act(async () => { tree = TestRenderer.create(React.createElement(AnnouncementsScreen)); });
    expect(byLabel('青少').props.accessibilityState).toEqual({ selected: true });
    // 主堂's list is asked for as the tab opens (2026-10-23), so the tap shows it without asking again.
    expect(state.fetchBulletins).toHaveBeenCalledTimes(1);
    act(() => { byLabel('主堂').props.onPress(); });
    expect(texts()).toContain('10/18 (日) 週刊');
    expect(state.fetchBulletins).toHaveBeenCalledTimes(1);
    await act(async () => { byLabel('青少').props.onPress(); });
    expect(texts()).not.toContain('10/18 (日) 週刊');
  });
});

describe('the 週刊 board and viewer', () => {
  const sourceFor = (date: string, index: number, width?: number) => bulletinPageSource('https://api.test', 'tok', date, index, width);
  const board = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(BulletinBoard, { weeks: WEEKS, status: 'ready', sourceFor, onRetry: vi.fn() })); }); };
  /** A page tile in the list, whatever state it is in: its label says the state. */
  const tile = (heading: string, index: number) => tree!.root.findAll((node) => typeof node.props.onPress === 'function' && String(node.props.accessibilityLabel).startsWith(`${heading}第 ${index} 頁`))[0];
  const loadAll = async () => { await act(async () => { for (const page of images()) page.props.onLoad(); }); };
  const inViewer = () => modal().findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
  const viewerImages = (testID: string) => modal().findAll((node) => String(node.type) === 'Image' && node.props.testID === testID);

  it('shows every page with the member\'s token, and opens a page full screen where it can be closed', async () => {
    await board();
    expect(images()).toHaveLength(5);
    expect(images()[0].props.source).toEqual([{ uri: 'https://api.test/api/bulletins/2026-10-18/1?w=1080', headers: { authorization: 'Bearer tok' } }]);
    // React Native's Android Image sends headers only from an array source (tests/helpers/androidImageHeaders.ts).
    for (const page of images()) expect(androidForwardedHeaders(page.props.source)).toEqual({ authorization: 'Bearer tok' });
    await loadAll();
    await act(async () => { byLabel('10/18 (日) 週刊第 2 頁，點了放大').props.onPress(); });
    expect(texts()).toEqual(expect.arrayContaining(['10/18 週刊 2 / 3', '兩指放大縮小・左右滑換頁']));
    const viewer = modal().findAll((node) => String(node.type) === 'Image');
    expect(viewer).toHaveLength(6);
    for (const page of viewer) expect(androidForwardedHeaders(page.props.source)).toEqual({ authorization: 'Bearer tok' });
    await act(async () => { byLabel('關閉週刊').props.onPress(); });
    expect(tree!.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(0);
  });

  it('downloads a phone-size copy for the list and the original only when a page is opened', async () => {
    await board();
    // 400 dp less the list's side padding, at 2.625 px per dp: 987 px, so the 1080 copy.
    expect(images().map(uriOf)).toEqual([
      ...[1, 2, 3].map((index) => `https://api.test/api/bulletins/2026-10-18/${index}?w=1080`),
      ...[1, 2].map((index) => `https://api.test/api/bulletins/2026-10-11/${index}?w=1080`),
    ]);
    await act(async () => { tile('10/18 (日) 週刊', 1).props.onPress(); });
    expect(viewerImages('bulletin-page-original').map(uriOf)).toEqual([1, 2, 3].map((index) => `https://api.test/api/bulletins/2026-10-18/${index}`));
    // Under each original, the copy the list already has: the page shows at once and sharpens when the original is in.
    expect(viewerImages('bulletin-page-preview').map(uriOf)).toEqual([1, 2, 3].map((index) => `https://api.test/api/bulletins/2026-10-18/${index}?w=1080`));
  });

  it('picks the smallest phone copy that covers the screen, and never asks the list for more than the largest', () => {
    expect(BULLETIN_LIST_WIDTHS).toEqual([720, 1080, 1440]);
    expect(bulletinListWidth(656)).toBe(720); // 360 dp at 2×
    expect(bulletinListWidth(987)).toBe(1080); // Pixel 8
    expect(bulletinListWidth(1134)).toBe(1080); // iPhone 17 (402 pt at 3×): within 5% of 1080
    expect(bulletinListWidth(1330)).toBe(1440); // Pixel 7 Pro
    expect(bulletinListWidth(2400)).toBe(1440); // a tablet: still a phone copy, the original is for zoom
    expect(bulletinListWidth(0)).toBeNull();
    expect(bulletinListWidth(Number.NaN)).toBeNull();
    expect(bulletinPageSource('https://api.test', 't', '2026-10-18', 2)).toEqual([{ uri: 'https://api.test/api/bulletins/2026-10-18/2', headers: { authorization: 'Bearer t' } }]);
    expect(bulletinPageSource('https://api.test', 't', '2026-10-18', 2, 720)).toEqual([{ uri: 'https://api.test/api/bulletins/2026-10-18/2?w=720', headers: { authorization: 'Bearer t' } }]);
  });

  it('shows a grey box the shape of each page with 週刊載入中… until the page arrives', async () => {
    await board();
    expect(texts().filter((text) => text === LOADING)).toHaveLength(5);
    const first = tile('10/18 (日) 週刊', 1);
    // The state is in the label too: VoiceOver, TalkBack and the iOS flow can tell a page that is still coming.
    expect(first.props.accessibilityLabel).toBe('10/18 (日) 週刊第 1 頁，載入中');
    expect(flat(first.props.style).aspectRatio).toBeCloseTo(760 / 1075);
    expect(first.findAll((node) => String(node.type) === 'View' && flat(node.props.style).backgroundColor === PAGE_PLACEHOLDER)).toHaveLength(1);
    expect(PAGE_PLACEHOLDER).not.toBe(theme.colors.surface);
    await act(async () => { images()[0].props.onLoad(); });
    expect(texts().filter((text) => text === LOADING)).toHaveLength(4);
    expect(tile('10/18 (日) 週刊', 1).props.accessibilityLabel).toBe('10/18 (日) 週刊第 1 頁，點了放大');
    expect(tile('10/18 (日) 週刊', 1).findAll((node) => flat(node.props.style).backgroundColor === PAGE_PLACEHOLDER)).toHaveLength(0);
  });

  it('says a page could not be loaded, and a tap asks for it again instead of opening it', async () => {
    await board();
    const uri = 'https://api.test/api/bulletins/2026-10-18/2?w=1080';
    expect(state.mounts.get(uri)).toBe(1);
    await act(async () => { images()[1].props.onError(); });
    expect(texts()).toContain(FAILED);
    const failed = byLabel('10/18 (日) 週刊第 2 頁載不到，點一下再試');
    expect(failed.props.accessibilityRole).toBe('button');
    await act(async () => { failed.props.onPress(); });
    expect(tree!.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(0);
    expect(state.mounts.get(uri)).toBe(2);
    expect(texts()).not.toContain(FAILED);
    expect(texts().filter((text) => text === LOADING)).toHaveLength(5);
    await act(async () => { images()[1].props.onLoad(); });
    expect(byLabel('10/18 (日) 週刊第 2 頁，點了放大')).toBeDefined();
  });

  it('full screen, shows the page box while it loads and offers a retry when the original cannot be loaded', async () => {
    await board();
    await act(async () => { tile('10/18 (日) 週刊', 1).props.onPress(); });
    expect(inViewer().filter((text) => text === LOADING)).toHaveLength(3);
    const uri = 'https://api.test/api/bulletins/2026-10-18/1';
    const original = () => viewerImages('bulletin-page-original').find((node) => uriOf(node) === uri)!;
    const page = () => modal().findAll((node) => node.props.accessible === true && String(node.props.accessibilityLabel).startsWith('10/18 週刊第 1 頁'))[0];
    expect(page().props.accessibilityLabel).toBe('10/18 週刊第 1 頁，載入中');
    // The phone copy is enough to stop showing 載入中: the page is there to read while the original comes in.
    await act(async () => { viewerImages('bulletin-page-preview')[0].props.onLoad(); });
    expect(inViewer().filter((text) => text === LOADING)).toHaveLength(2);
    expect(page().props.accessibilityLabel).toBe('10/18 週刊第 1 頁，載入中');
    expect(state.mounts.get(uri)).toBe(1);
    await act(async () => { original().props.onError(); });
    expect(inViewer()).toContain(FAILED);
    await act(async () => { byLabel('10/18 週刊第 1 頁載不到，點一下再試').props.onPress(); });
    expect(state.mounts.get(uri)).toBe(2);
    expect(inViewer()).not.toContain(FAILED);
    await act(async () => { original().props.onLoad(); });
    expect(inViewer()).not.toContain(FAILED);
    expect(page().props.accessibilityLabel).toBe('10/18 週刊第 1 頁');
  });

  it('keeps the full-screen title bar below the status bar, on both platforms', async () => {
    // The 0.5.35 viewer drew its black bar from the top edge: with the app's dark status bar icons on black, the
    // status bar disappeared under it (Pixel, 2026-10-20). Android lays every Modal out edge to edge (RN 0.85
    // ReactModalHostView) and the iOS full-screen Modal starts at the top edge too, so one layout serves both.
    state.insets = { top: 47, bottom: 34, left: 0, right: 0 };
    await board();
    await act(async () => { tile('10/18 (日) 週刊', 2).props.onPress(); });
    const screen = modal().findAll((node) => String(node.type) === 'View')[0];
    const [statusArea, stage] = screen.children as TestRenderer.ReactTestInstance[];
    expect(statusArea.props.testID).toBe('bulletin-viewer-status-area');
    // The status bar keeps the app's light background, where its dark icons show, as on every other screen.
    expect(flat(statusArea.props.style)).toMatchObject({ height: 47, backgroundColor: theme.colors.background });
    const bar = stage.findAll((node) => node.props.testID === 'bulletin-viewer-bar')[0];
    expect(bar.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''))).toContain('10/18 週刊 2 / 3');
    expect(flat(bar.props.style)).toMatchObject({ position: 'absolute', top: 0 });
    expect(flat(bar.props.style).paddingTop).toBeLessThan(47);
    // Pages are laid out in the space under the status bar, which the stage measures, not in the whole window.
    expect(typeof stage.props.onLayout).toBe('function');
    await act(async () => { stage.props.onLayout({ nativeEvent: { layout: { x: 0, y: 47, width: 400, height: 719 } } }); });
    expect(modal().findAll((node) => node.props.accessible === true && String(node.props.accessibilityLabel).startsWith('10/18 週刊第 1 頁'))[0].parent!.props.style).toMatchObject({ width: 400, height: 719 });
    const source = readFileSync('src/ui/bulletin/BulletinViewer.tsx', 'utf8');
    expect(source, 'one layout for both platforms').not.toMatch(/Platform\.OS/);
  });

  it('says when there is nothing yet, and offers a retry when it could not be read', async () => {
    const onRetry = vi.fn();
    await act(async () => { tree = TestRenderer.create(React.createElement(BulletinBoard, { weeks: [], status: 'ready', sourceFor, onRetry })); });
    expect(texts().join('')).toContain('還沒有週刊');
    act(() => tree!.update(React.createElement(BulletinBoard, { weeks: [], status: 'error', sourceFor, onRetry })));
    byLabel('重新讀取週刊').props.onPress();
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('reading the 週刊 list', () => {
  it('reads an older backend as no 週刊, and refuses a malformed reply', async () => {
    const { fetchBulletins: realFetchBulletins } = await vi.importActual<typeof import('../../src/services/bulletinClient')>('../../src/services/bulletinClient');
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const options = { baseUrl: 'https://api.test', token: 't', memberId: 'm' };
    expect(await realFetchBulletins({ ...options, fetchImpl: reply(200, { weeks: WEEKS }) })).toEqual(WEEKS);
    expect(await realFetchBulletins({ ...options, fetchImpl: reply(404, { error: 'NOT_FOUND' }) })).toEqual([]);
    expect(await realFetchBulletins({ ...options, fetchImpl: reply(200, { weeks: [{ date: 'x', pages: [] }] }) })).toBeNull();
    expect(await realFetchBulletins({ ...options, fetchImpl: reply(500, {}) })).toBeNull();
    expect(bulletinHeading('2026-10-11')).toBe('10/11 (日) 週刊');
  });
});

describe('pinch zoom', () => {
  it('stays between normal size and 4×, and keeps a zoomed page covering the screen', () => {
    expect(pinchScale(1, 100, 250)).toBe(2.5);
    expect(pinchScale(2, 100, 500)).toBe(4);
    expect(pinchScale(1, 100, 50)).toBe(1);
    const view = { width: 400, height: 800 };
    const page = fitSize(view, { width: 760, height: 1075 });
    expect(page.width).toBe(400);
    expect(clampOffset({ x: 999, y: -999 }, 1, view, page)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: 999, y: 0 }, 2, view, page)).toEqual({ x: 200, y: 0 });
  });
});
