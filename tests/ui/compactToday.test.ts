import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the actual Today tree, auth/date stores, cards, and completion repository.
// Only native hosts and external I/O are replaced; no real account or database is used.
const boundary = vi.hoisted(() => ({
  repository: null as any,
  push: vi.fn(),
  getProgress: vi.fn(),
  getReadingDays: vi.fn(),
  saveCompletion: vi.fn(),
}));
vi.mock('react-native', () => ({
  ScrollView: 'ScrollView', Text: 'Text', View: 'View', Pressable: 'Pressable',
  Image: 'Image', TextInput: 'TextInput',
  StyleSheet: { create: (value: unknown) => value },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-router', () => {
  const ReactRuntime = require('react') as typeof React;
  const Screen = (props: Record<string, unknown>) => ReactRuntime.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => ReactRuntime.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return { Tabs, router: { push: boundary.push }, useFocusEffect: (callback: React.EffectCallback) => ReactRuntime.useEffect(callback, [callback]) };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'compact-today-operation' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: () => boundary.repository }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getProgress: boundary.getProgress, getReadingDays: boundary.getReadingDays, saveCompletion: boundary.saveCompletion }) }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: async () => undefined }));
vi.mock('../../src/ui/BibleContentPreloadHome', () => ({ BibleContentPreloadHome: () => null }));

import TodayScreen from '../../app/(tabs)/today';
import TabsLayout from '../../app/(tabs)/_layout';
import { clearAuthSession, markAuthExpired, setAuthSession } from '../../src/services/authSession';
import { createMobileRepository } from '../../src/storage/mobileRepository';
import { setSelectedReadingDate } from '../../src/ui/readingSession';

const all = (renderer: TestRenderer.ReactTestRenderer, type: string) => renderer.root.findAll(node => String(node.type) === type);
function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  const walk = (value: any): string => value == null ? '' : typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(walk).join('') : walk(value.children);
  return walk(renderer.toJSON());
}
function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return all(renderer, 'Pressable').find(node => node.props.accessibilityLabel === label)!;
}
function styleOf(node: TestRenderer.ReactTestInstance) {
  return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
}

describe('compact Today home', () => {
  const renderers: TestRenderer.ReactTestRenderer[] = [];
  let database: DatabaseSync;
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      const message = String(args[0] ?? '');
      if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return;
      originalError(...args);
    };
  });
  afterAll(() => { console.error = originalError; });
  beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_QINGMU_FIXTURE', 'false');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'component-test-client');
    vi.stubEnv('EXPO_PUBLIC_QINGMU_API_BASE_URL', 'https://example.test');
    vi.stubEnv('EXPO_PUBLIC_YOUVERSION_VERSION_ID', '139');
    database = new DatabaseSync(':memory:');
    boundary.repository = createMobileRepository({
      execSync: source => database.exec(source),
      runSync: (source, ...params) => database.prepare(source).run(...params as never[]),
      getFirstSync: <T,>(source: string, ...params: unknown[]) => database.prepare(source).get(...params as never[]) as T | null,
      getAllSync: <T,>(source: string, ...params: unknown[]) => database.prepare(source).all(...params as never[]) as T[],
    });
    boundary.getProgress.mockResolvedValue(null);
    boundary.getReadingDays.mockResolvedValue(null);
    boundary.saveCompletion.mockResolvedValue({ ok: true, revision: 1, status: 'COMPLETED' });
    clearAuthSession();
    setSelectedReadingDate('2026-09-12');
  });
  afterEach(() => {
    act(() => { renderers.splice(0).forEach(renderer => renderer.unmount()); clearAuthSession(); });
    database.close();
    vi.unstubAllEnvs();
  });
  async function render(component = TodayScreen) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(component)); });
    renderers.push(renderer);
    return renderer;
  }
  function signIn() { setAuthSession({ memberId: 'component:test-member', sessionToken: 'component-test-token' }); }

  it('removes the redundant introduction, provider status, signed-in block, and explanatory footnote', async () => {
    signIn();
    const renderer = await render();
    const text = textContent(renderer);
    for (const removed of ['今天一起走', '靈命分數', '經文文字已可讀', 'YouVersion', '照讀經表保留原列', '已登入：', '帳戶入口在右上角', '小組分母', '跨重開App保留']) {
      expect(text, removed).not.toContain(removed);
    }
    expect(text).toContain('9月12日 週六');
    expect(text).toContain('提前1、詩90、詩91');
    expect(text).toContain('開始今日讀經');
    expect(text).toContain('我已完成讀經');
  });

  it('places a 48dp account control beside the date within the top safe area', async () => {
    signIn();
    const renderer = await render();
    expect(all(renderer, 'SafeAreaView')[0]?.props.edges).toEqual(['top', 'left', 'right']);
    const entry = button(renderer, '開啟帳戶');
    expect(entry).toBeDefined();
    expect(styleOf(entry)).toMatchObject({ minWidth: 48, minHeight: 48 });
    const date = all(renderer, 'View').find(node => node.props.accessibilityLabel === '讀經日期2026-09-12')!;
    let sharedParent = date.parent;
    while (sharedParent && !sharedParent.findAll(node => node === entry).length) sharedParent = sharedParent.parent;
    expect(styleOf(sharedParent!)).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
    act(() => { entry.props.onPress(); });
    expect(boundary.push).toHaveBeenCalledWith('/account');
  });

  it('hides only the reading home native header while retaining the two main tabs', async () => {
    const renderer = await render(TabsLayout);
    const screens = all(renderer, 'Screen');
    expect(screens.find(node => node.props.name === 'today')?.props.options).toMatchObject({ headerShown: false, title: '讀經', tabBarAccessibilityLabel: '讀經入口' });
    expect(screens.find(node => node.props.name === 'progress')?.props.options).toMatchObject({ title: '積分', tabBarAccessibilityLabel: '積分' });
    expect(all(renderer, 'Tabs')[0]?.props.screenOptions.headerShown).toBe(true);
  });

  it('keeps scripture as the accessible content heading after the introductory heading is removed', async () => {
    const renderer = await render();
    const headings = all(renderer, 'Text').filter(node => node.props.accessibilityRole === 'header');
    expect(headings.some(node => node.props.children === '提前1、詩90、詩91')).toBe(true);
  });

  it.each(['signed-out', 'expired'] as const)('retains usable Google sign-in and disables completion when %s', async status => {
    if (status === 'expired') { signIn(); markAuthExpired(); }
    const renderer = await render();
    expect(button(renderer, '使用Google登入')?.props.disabled).toBe(false);
    expect(button(renderer, '確認今日已完成讀經')?.props.disabled).toBe(true);
  });

  it('preserves date selection, reader navigation, and completion state', async () => {
    signIn();
    const renderer = await render();
    act(() => { button(renderer, '下一個排定讀經日').props.onPress(); });
    expect(textContent(renderer)).toContain('9月14日 週一');
    act(() => { button(renderer, '開啟今日讀經').props.onPress(); });
    expect(boundary.push).toHaveBeenCalledWith('/reader');
    await act(async () => { button(renderer, '確認今日已完成讀經').props.onPress(); });
    expect(textContent(renderer)).toContain('已完成');
    expect(button(renderer, '撤銷今日讀經完成確認')?.props.disabled).toBe(false);
    expect(boundary.repository.get({ memberId: 'component:test-member', planId: 'church-2026-09', taskDate: '2026-09-14' })).toMatchObject({ status: 'COMPLETED' });
  });

  it('keeps the actionable sync error visible when the progress request fails', async () => {
    signIn();
    boundary.getReadingDays.mockRejectedValue(new Error('offline-test'));
    const renderer = await render();
    expect(textContent(renderer)).toContain('同步遇到問題');
    expect(button(renderer, '開啟今日讀經')?.props.disabled).toBe(false);
  });
});
