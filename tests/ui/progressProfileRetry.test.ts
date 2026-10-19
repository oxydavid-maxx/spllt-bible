import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// iOS 00-smoke (runs 39009631525, 39181568516 attempt 1, 39182073666 attempts 1 and 2): on a fresh
// install the first own-profile read was answered after 10.9-11.7 s, past the client's fixed 8 s read
// deadline. With nothing cached, the page then stayed on 「目前無法完成操作，請稍後再試。」 and
// 「正在載入你的積分。」 until the member left the tab and came back. These tests drive the real 積分
// screen and the real API client (its 8 s deadline included) with that timing.
const { auth, appListeners, store } = vi.hoisted(() => ({
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  appListeners: [] as Array<(state: string) => void>,
  store: new Map<string, string>(),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (props: any) => props.children, SafeAreaView: (props: any) => props.children }));
// Empty unless a test saves a profile first: 00-smoke runs on a fresh install.
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => store.get(key) ?? null, setItemAsync: async (key: string, value: string) => { store.set(key, value); }, deleteItemAsync: async (key: string) => { store.delete(key); } }));
// Same stand-ins as rewardPickerRefresh.test.ts: the completion controller opens SQLite, which node cannot load.
vi.mock('../../src/services/useCompletionController', () => ({ useCompletionController: (options: { planId: string; taskDate: string }) => ({ record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' }, pending: false, syncError: false, retryable: false, complete: vi.fn(async () => undefined), requestUndo: vi.fn() }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: async () => undefined }) }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getCongregation: async () => 'youth', getDevotionDates: async () => [], setDevotion: async () => undefined, getGroupReading: async () => { throw new Error('not served'); }, getScoreHistory: async () => { throw new Error('not served'); }, getDevotional: async () => null }) }));
vi.mock('react-native', () => {
  const primitive = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children);
  return { AppState: { currentState: 'active', addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } };
});
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
// Focus lasts as long as the screen is mounted; unmounting is leaving the tab.
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('../../src/services/adminUnlockGuard', () => ({ createNativeAdminAuthenticator: () => null, createAdminUnlockGuard: () => ({ state: 'locked', clear() { this.state = 'locked'; }, async unlock() { this.state = 'unlocked'; return true; } }) }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => () => undefined, useAuthSnapshot: () => auth }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => require('react').createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => require('react').createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: () => null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: () => null }));
vi.mock('../../src/ui/gamification/RedemptionList', () => ({ RedemptionList: () => null }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: () => null }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));

import ProgressScreen from '../../app/(tabs)/progress';
import { createProfileCache } from '../../src/services/profileCache';

const ownProfile = { memberId: 'self', displayName: '測試成員甲', earnedTotal: 4, band: null, months: [{ month: '2026-10', earnedPoints: 4 }], permissions: { canEditTarget: true, canRedeem: true }, private: { redeemableBalance: 4, targetReward: null } };
const NEVER = Number.POSITIVE_INFINITY;
// One entry per own-profile read: how long the backend takes to answer it, and with what.
let profileAnswers: Array<{ after: number; status?: number; body?: unknown }> = [];
let profileReads = 0;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const path = new URL(url).pathname;
  if (path.startsWith('/api/points/profiles/')) {
    profileReads += 1;
    const answer = profileAnswers.shift() ?? { after: 0 };
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      if (answer.after !== NEVER) setTimeout(() => resolve(json(answer.status ?? 200, answer.body ?? ownProfile)), answer.after);
    });
  }
  if (path === '/api/me/profile') return Promise.resolve(json(200, { capabilities: { canViewAllScores: false, canManageRewards: false, canRedeemRewards: true } }));
  if (path === '/api/rewards') return Promise.resolve(json(200, { rewards: [] }));
  return Promise.resolve(json(404, { error: 'NOT_FOUND' }));
}

const trees: ReactTestRenderer[] = [];
async function render() { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(ProgressScreen)); }); trees.push(tree); return tree; }
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const texts = (tree: ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children));
const alerts = (tree: ReactTestRenderer) => tree.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'alert').map((node) => String(node.props.children));
const shownName = (tree: ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === 'ScoreProfile').map((node) => node.props.profile.displayName);
let consoleError: ReturnType<typeof vi.spyOn>;
const readErrors = () => consoleError.mock.calls.filter((call) => call[0] === 'CI_GAMIFICATION_READ_ERROR').map((call) => call[1]);

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-19T02:43:56Z'));
  vi.stubEnv('EXPO_PUBLIC_QINGMU_FIXTURE', 'true');
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  profileAnswers = []; profileReads = 0; appListeners.length = 0; store.clear();
});
afterEach(async () => {
  await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); });
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe('積分 page when the first own-profile answer misses the read deadline', () => {
  it('reads again on its own and shows the member, as 00-smoke expects, with no leftover error', async () => {
    profileAnswers = [{ after: 11_718 }, { after: 300 }];
    const screen = await render();
    expect(profileReads).toBe(1);
    await advance(8_000);
    // The client's deadline fired: the same evidence the CI build logs.
    expect(readErrors()).toEqual([{ operation: 'SCORE_PROFILE', code: 'READ_TIMEOUT', status: 0 }]);
    // While the page is still trying, it says it is loading rather than that it failed.
    expect(alerts(screen)).toEqual([]);
    expect(texts(screen)).toContain('載入中…');
    // 00-smoke scrolls for 30 s looking for the name.
    await advance(30_000);
    expect(shownName(screen)).toEqual(['測試成員甲']);
    expect(alerts(screen)).toEqual([]);
    expect(texts(screen)).not.toContain('正在載入你的積分。');
    expect(texts(screen)).not.toContain('載入中…');
    expect(profileReads).toBe(2);
  });

  it('gives up after a bounded number of tries and then shows the error', async () => {
    profileAnswers = [{ after: NEVER }, { after: NEVER }, { after: NEVER }, { after: NEVER }, { after: NEVER }];
    const screen = await render();
    await advance(120_000);
    expect(profileReads).toBe(3);
    expect(readErrors()).toHaveLength(3);
    expect(alerts(screen)).toEqual(['目前無法完成操作，請稍後再試。']);
    expect(texts(screen)).toContain('正在載入你的積分。');
    expect(texts(screen)).not.toContain('載入中…');
    expect(shownName(screen)).toEqual([]);
  });

  it('keeps the last saved points on screen while it tries again, then replaces them', async () => {
    await createProfileCache({ getItem: async (key) => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } }).save('self', { ...ownProfile, earnedTotal: 2 });
    profileAnswers = [{ after: NEVER }, { after: 300 }];
    const screen = await render();
    await advance(8_000);
    // The saved points stay up with the stale note; nothing claims the page is empty or failed.
    expect(screen.root.findAll((node) => String(node.type) === 'ScoreProfile').map((node) => node.props.profile.earnedTotal)).toEqual([2]);
    expect(texts(screen)).toContain('目前顯示上次的積分，還沒連上更新');
    expect(texts(screen)).not.toContain('載入中…');
    expect(alerts(screen)).toEqual([]);
    await advance(3_000);
    expect(screen.root.findAll((node) => String(node.type) === 'ScoreProfile').map((node) => node.props.profile.earnedTotal)).toEqual([4]);
    expect(texts(screen)).not.toContain('目前顯示上次的積分，還沒連上更新');
    expect(profileReads).toBe(2);
  });

  it('does not retry an answer that will not change by asking again', async () => {
    profileAnswers = [{ after: 50, status: 403, body: { error: { code: 'MEMBER_NOT_ACCESSIBLE', retryable: false } } }];
    const screen = await render();
    await advance(60_000);
    expect(profileReads).toBe(1);
    expect(alerts(screen)).toEqual(['目前無法查看這位會員。']);
  });

  it('stops trying once the member leaves the tab', async () => {
    profileAnswers = [{ after: NEVER }, { after: 300 }];
    const screen = await render();
    await advance(8_000);
    await act(async () => { screen.unmount(); }); trees.splice(trees.indexOf(screen), 1);
    await advance(60_000);
    expect(profileReads).toBe(1);
  });
});
