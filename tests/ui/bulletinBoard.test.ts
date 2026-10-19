import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 公告「青少｜主堂」 and the 主堂週刊 (維護者 2026-10-17, mock 2-4).
const state = vi.hoisted(() => ({
  congregation: { status: 'ready', value: null } as { status: string; value: 'youth' | 'main' | null },
  fetchBulletins: vi.fn(),
  focus: [] as Array<() => void>,
}));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({
  Animated: { Value: class { constructor(public value: number) {} setValue(next: number) { this.value = next; } }, Image: primitive('AnimatedImage') },
  FlatList: (props: { data: unknown[]; renderItem: (row: { item: unknown; index: number }) => unknown; keyExtractor: (item: unknown) => string }) =>
    require('react').createElement('FlatList', props, props.data.map((item, index) => require('react').createElement(require('react').Fragment, { key: props.keyExtractor(item) }, props.renderItem({ item, index })))),
  Image: primitive('Image'), Linking: { openURL: vi.fn() }, Modal: primitive('Modal'), PanResponder: { create: () => ({ panHandlers: {} }) },
  Platform: { OS: 'android' }, Pressable: primitive('Pressable'), StyleSheet: { create: (s: unknown) => s }, Text: primitive('Text'), View: primitive('View'),
  useWindowDimensions: () => ({ width: 400, height: 800 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: (props: { children?: unknown }) => require('react').createElement('SafeAreaView', props, props.children), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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
import { BulletinBoard } from '../../src/ui/bulletin/BulletinBoard';
import { bulletinHeading, bulletinPageSource } from '../../src/services/bulletinClient';
import { clampOffset, fitSize, pinchScale } from '../../src/ui/bulletin/zoomMath';
import { androidForwardedHeaders } from '../helpers/androidImageHeaders';

const WEEKS = [
  { date: '2026-10-18', postedAt: '2026-10-17T02:00:00.000Z', pages: [1, 2, 3].map((index) => ({ index, width: 760, height: 1075 })) },
  { date: '2026-10-11', postedAt: '2026-10-10T02:00:00.000Z', pages: [1, 2].map((index) => ({ index, width: 760, height: 1075 })) },
];
let tree: TestRenderer.ReactTestRenderer | null = null;
const texts = () => tree!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
const byLabel = (label: string) => tree!.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

beforeEach(() => { state.fetchBulletins.mockReset().mockResolvedValue(WEEKS); state.congregation = { status: 'ready', value: null }; });
afterEach(() => { act(() => tree?.unmount()); tree = null; });

describe('the 公告 tabs', () => {
  it('opens on 主堂 for a 主堂 member and shows only the 週刊 there', async () => {
    state.congregation = { status: 'ready', value: 'main' };
    await act(async () => { tree = TestRenderer.create(React.createElement(AnnouncementsScreen)); });
    expect(byLabel('主堂').props.accessibilityState).toEqual({ selected: true });
    expect(state.fetchBulletins).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok' }));
    expect(texts()).toEqual(expect.arrayContaining(['10/18 (日) 週刊', '3 張・點圖片放大', '10/11 (日) 週刊']));
    // The screen's own sources (bulletinPageSource): the token has to reach Android's native image request too.
    const pages = tree!.root.findAll((node) => String(node.type) === 'Image');
    expect(pages).toHaveLength(5);
    for (const page of pages) expect(androidForwardedHeaders(page.props.source)).toEqual({ authorization: 'Bearer tok' });
  });

  it('opens on 青少 for everyone else, and either side can be chosen', async () => {
    await act(async () => { tree = TestRenderer.create(React.createElement(AnnouncementsScreen)); });
    expect(byLabel('青少').props.accessibilityState).toEqual({ selected: true });
    expect(state.fetchBulletins).not.toHaveBeenCalled();
    await act(async () => { byLabel('主堂').props.onPress(); });
    expect(state.fetchBulletins).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('10/18 (日) 週刊');
    await act(async () => { byLabel('青少').props.onPress(); });
    expect(texts()).not.toContain('10/18 (日) 週刊');
  });
});

describe('the 週刊 board and viewer', () => {
  const sourceFor = (date: string, index: number) => bulletinPageSource('https://api.test', 'tok', date, index);

  it('shows every page with the member\'s token, and opens a page full screen where it can be closed', async () => {
    await act(async () => { tree = TestRenderer.create(React.createElement(BulletinBoard, { weeks: WEEKS, status: 'ready', sourceFor, onRetry: vi.fn() })); });
    const images = tree!.root.findAll((node) => String(node.type) === 'Image');
    expect(images).toHaveLength(5);
    expect(images[0].props.source).toEqual([{ uri: 'https://api.test/api/bulletins/2026-10-18/1', headers: { authorization: 'Bearer tok' } }]);
    // React Native's Android Image sends headers only from an array source (tests/helpers/androidImageHeaders.ts).
    for (const image of images) expect(androidForwardedHeaders(image.props.source)).toEqual({ authorization: 'Bearer tok' });
    await act(async () => { byLabel('10/18 (日) 週刊第 2 頁，點了放大').props.onPress(); });
    expect(texts()).toEqual(expect.arrayContaining(['10/18 週刊 2 / 3', '兩指放大縮小・左右滑換頁']));
    const zoomable = tree!.root.findAll((node) => String(node.type) === 'AnimatedImage');
    expect(zoomable).toHaveLength(3);
    for (const image of zoomable) expect(androidForwardedHeaders(image.props.source)).toEqual({ authorization: 'Bearer tok' });
    await act(async () => { byLabel('關閉週刊').props.onPress(); });
    expect(tree!.root.findAll((node) => String(node.type) === 'Modal')).toHaveLength(0);
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
