import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { api, auth, nav, store, appListeners, storageGet } = vi.hoisted(() => ({
  api: Object.fromEntries(['getCapabilities', 'getProfile', 'getPeople', 'getRewards', 'getNominations', 'getCommunityProgress', 'getPendingOperations', 'setNominationVote', 'nominateReward', 'setRewardTarget', 'cancelReads'].map((name) => [name, vi.fn()])),
  auth: { status: 'signed-in', session: { memberId: 'pilot:qa', sessionToken: 'qa' } },
  nav: { focused: true }, store: new Map<string, string>(), appListeners: [] as Array<(state: string) => void>, storageGet: vi.fn(),
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => { appListeners.push(callback); return { remove: () => { appListeners.splice(appListeners.indexOf(callback), 1); } }; } }, Pressable: (p: any) => React.createElement('Pressable', p, p.children), View: (p: any) => React.createElement('View', p, p.children), Text: (p: any) => React.createElement('Text', p, p.children), TextInput: (p: any) => React.createElement('TextInput', p), StyleSheet: { create: (x: any) => x } }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => any) => { React.useEffect(() => nav.focused ? callback() : undefined, [callback, nav.focused]); } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: (key: string) => storageGet(key), setItemAsync: async (key: string, value: string) => { if (!/^[\w.-]+$/.test(key)) throw Error('invalid key'); store.set(key, value); } }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: (p: any) => React.createElement('SafeAreaView', p, p.children) }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => auth, isCurrentAuthSession: (session: any) => session === auth.session, registerAuthLifecycleListener: () => () => undefined }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => api, GamificationApiError: class extends Error {} }));
vi.mock('../../src/services/adminUnlockGuard', () => ({ createNativeAdminAuthenticator: () => null, createAdminUnlockGuard: () => ({ state: 'locked', clear() { this.state = 'locked'; }, async unlock() { this.state = 'unlocked'; return true; } }) }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => null }));
vi.mock('../../src/ui/AnnouncementBoard', () => ({ AnnouncementBoard: (p: any) => React.createElement('AnnouncementBoard', p) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (p: any) => React.createElement('ScoreProfile', p) }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (p: any) => React.createElement('PeopleList', p) }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: () => null }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: () => null }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (p: any) => p.visible ? React.createElement('ActionSheet', p, p.children) : null }));
import ProgressScreen from '../../app/(tabs)/progress';
import AnnouncementsScreen from '../../app/(tabs)/announcements';
import { createProfileCache } from '../../src/services/profileCache';
import { NominationBoard } from '../../src/ui/gamification/NominationBoard';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const profile = (memberId = 'pilot:qa') => ({ memberId, displayName: memberId, earnedTotal: 3, band: null, months: [], permissions: { canEditTarget: true, canRedeem: false }, private: { redeemableBalance: 3, targetReward: null } });
const board = () => ({ round: { roundId: 'r1', title: 'QA輪', phase: 'VOTING', closesAt: Date.now() + 1000000 }, nominations: [{ nominationId: 'n1', name: 'QA獎品', displayName: 'QA', status: 'OPEN', voted: false, voteCount: 0, mine: false, revision: 1 }], votesLeft: 3, votesPerMember: 3 });
const trees: ReactTestRenderer[] = [];
async function render(Component: React.ComponentType) { let tree!: ReactTestRenderer; await act(async () => { tree = create(React.createElement(Component)); }); trees.push(tree); return tree; }
const press = async (tree: ReactTestRenderer, label: string) => { await act(async () => { tree.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label)[0].props.onPress(); }); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); nav.focused = true; store.clear(); storageGet.mockImplementation(async (key) => store.get(key) ?? null);
  api.cancelReads.mockReset();
  api.getCapabilities.mockResolvedValue({ canViewAllScores: true, canManageRewards: true, canRedeemRewards: true }); api.getProfile.mockImplementation(async (id: string) => profile(id)); api.getPeople.mockResolvedValue([{ memberId: 'friend', displayName: 'Friend', earnedTotal: 2 }]); api.getRewards.mockResolvedValue([]); api.getNominations.mockImplementation(async () => board()); api.getCommunityProgress.mockResolvedValue({ books: [], personDays: null, currentBook: null }); api.getPendingOperations.mockResolvedValue({ redemptions: [], reversals: [] }); api.setNominationVote.mockResolvedValue(undefined); api.nominateReward.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('focused progress loading', () => {
  it('shows native-safe own cache before remote answers, with just one critical profile read', async () => {
    await createProfileCache({ getItem: async (key) => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } }).save('pilot:qa', profile());
    const remote = deferred<any>(); api.getProfile.mockReturnValue(remote.promise);
    const tree = await render(ProgressScreen);
    expect(tree.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(3);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(api.getNominations).not.toHaveBeenCalled();
    await act(async () => remote.resolve({ ...profile(), earnedTotal: 5 }));
    expect(tree.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(5);
  });
  it('does not refetch after blur and discards a cache result arriving after background', async () => {
    const cached = deferred<string | null>(); const remote = deferred<any>(); storageGet.mockReturnValue(cached.promise); api.getProfile.mockReturnValue(remote.promise);
    const tree = await render(ProgressScreen); const before = api.getProfile.mock.calls.length;
    nav.focused = false; await act(async () => tree.update(React.createElement(ProgressScreen)));
    expect(api.getProfile).toHaveBeenCalledTimes(before);
    await act(async () => { appListeners.at(-1)?.('background'); remote.reject(Error('offline')); cached.resolve(JSON.stringify(profile())); });
    expect(tree.root.findAllByType('ScoreProfile' as any)).toHaveLength(0);
    expect(api.cancelReads).toHaveBeenCalled();
  });
  it('does not let a late cache overwrite a fresh profile', async () => {
    const cached = deferred<string | null>(); storageGet.mockReturnValue(cached.promise);
    const tree = await render(ProgressScreen);
    await act(async () => cached.resolve(JSON.stringify({ ...profile(), earnedTotal: 99 })));
    expect(tree.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(3);
  });
  it('does not reload a previously visible profile while the tab is blurred or the app resumes elsewhere', async () => {
    const tree = await render(ProgressScreen); const before = api.getProfile.mock.calls.length;
    nav.focused = false; await act(async () => tree.update(React.createElement(ProgressScreen)));
    await act(async () => { appListeners.at(-1)?.('background'); appListeners.at(-1)?.('active'); });
    expect(api.getProfile).toHaveBeenCalledTimes(before);
  });
  it('does not reopen the admin rewards sheet from a request completed after blur', async () => {
    const tree = await render(ProgressScreen); const rewards = deferred<any>(); api.getRewards.mockReturnValueOnce(rewards.promise);
    await press(tree, '開啟積分操作');
    await act(async () => { tree.root.findByType('ActionSheet' as any).props.actions.find((a: any) => a.label === '管理獎品').onPress(); });
    nav.focused = false; await act(async () => tree.update(React.createElement(ProgressScreen)));
    await act(async () => rewards.resolve([]));
    expect(tree.root.findAllByType('ActionSheet' as any)).toHaveLength(0);
  });
  it('does not reopen a menu request after the user closes that menu', async () => {
    const tree = await render(ProgressScreen); const rewards = deferred<any>(); api.getRewards.mockReturnValueOnce(rewards.promise);
    await press(tree, '開啟積分操作');
    await act(async () => { const sheet = tree.root.findByType('ActionSheet' as any); sheet.props.actions.find((a: any) => a.label === '管理獎品').onPress(); sheet.props.onClose(); });
    await act(async () => rewards.resolve([]));
    expect(tree.root.findAllByType('ActionSheet' as any)).toHaveLength(0);
  });
  it('does not apply a target mutation failure after its screen has blurred', async () => {
    const tree = await render(ProgressScreen); const change = deferred<void>(); api.setRewardTarget.mockReturnValueOnce(change.promise);
    await act(async () => { tree.root.findByType('ScoreProfile' as any).props.onChooseTarget('r'); });
    nav.focused = false; await act(async () => tree.update(React.createElement(ProgressScreen)));
    await act(async () => change.reject(Error('late')));
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'alert')).toHaveLength(0);
  });
  it('defers chart warming, reads ranges sequentially, and stops on blur', async () => {
    vi.useFakeTimers(); const chart = { range: 'month', anchor: '2026-09', buckets: [], periodStart: null, periodEnd: null, earnedPoints: 0, previousAnchor: null, nextAnchor: null };
    const warm = deferred<any>(); api.getProfile.mockImplementation((_: string, __: string, ___: string, query: unknown) => query ? warm.promise : Promise.resolve({ ...profile(), chart }));
    const tree = await render(ProgressScreen); expect(api.getProfile).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    nav.focused = false; await act(async () => tree.update(React.createElement(ProgressScreen)));
    await act(async () => warm.resolve({ ...profile(), chart: { ...chart, range: 'week' } }));
    expect(api.getProfile).toHaveBeenCalledTimes(2);
  });
  it('does not lose the initial nomination board when a chart range changes during its read', async () => {
    const pendingBoard = deferred<any>(); api.getNominations.mockReturnValue(pendingBoard.promise);
    const tree = await render(ProgressScreen);
    await act(async () => tree.root.findByType('ScoreProfile' as any).props.onChartChange({ range: 'week' }));
    await act(async () => pendingBoard.resolve(board()));
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'QA輪，我要提案').length).toBeGreaterThan(0);
  });
  it('keeps the pending account capabilities read alive through an early scope change', async () => {
    const capabilities = deferred<any>(); let started = false;
    api.getCapabilities.mockImplementationOnce(() => { started = true; return capabilities.promise; });
    api.cancelReads.mockImplementation((path?: string) => { if (started && path === undefined) capabilities.reject(Error('cancelled')); });
    const tree = await render(ProgressScreen);
    expect(api.getCapabilities).toHaveBeenCalledTimes(1);
    await press(tree, '好友');
    await act(async () => capabilities.resolve({ canViewAllScores: true, canManageRewards: true, canRedeemRewards: true }));
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '全體（管理）')).toHaveLength(1);
  });
});

describe('nomination action feedback', () => {
  async function openBoard(scope = 'me') {
    const tree = await render(ProgressScreen);
    if (scope === 'all') await press(tree, '全體（管理）');
    await press(tree, '開啟積分操作');
    await act(async () => tree.root.findByType('ActionSheet' as any).props.actions.find((a: any) => a.label === '獎品提案').onPress());
    return tree;
  }
  it('refreshes in all scope without blanking the current board and ignores duplicate active actions', async () => {
    const tree = await openBoard('all'); const mutation = deferred<void>(); api.setNominationVote.mockReturnValue(mutation.promise);
    const before = api.getNominations.mock.calls.length;
    await act(async () => { const fn = tree.root.findByType(NominationBoard).props.onVote; void fn('n1', true); void fn('n1', true); });
    expect(api.setNominationVote).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType(NominationBoard).props.nominations).toHaveLength(1);
    await act(async () => mutation.resolve());
    expect(api.getNominations.mock.calls.length).toBeGreaterThan(before);
    expect(tree.root.findByType(NominationBoard).props.round?.roundId).toBe('r1');
  });
  it.each(['chart', 'scope'])('finishes one nomination mutation after the sheet closes and the %s changes', async (change) => {
    const tree = await openBoard(); const mutation = deferred<void>(); api.setNominationVote.mockReturnValueOnce(mutation.promise);
    await act(async () => { void tree.root.findByType(NominationBoard).props.onVote('n1', true); });
    await act(async () => tree.root.findByType('ActionSheet' as any).props.onClose());
    if (change === 'chart') await act(async () => tree.root.findByType('ScoreProfile' as any).props.onChartChange({ range: 'week' }));
    else await press(tree, '好友');
    await press(tree, '開啟積分操作');
    await act(async () => tree.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '獎品提案').onPress());
    await act(async () => { void tree.root.findByType(NominationBoard).props.onVote('n1', true); });
    expect(api.setNominationVote).toHaveBeenCalledTimes(1);
    api.getNominations.mockResolvedValue({ ...board(), votesLeft: 2, nominations: [{ ...board().nominations[0], voted: true }] });
    await act(async () => mutation.resolve());
    expect(tree.root.findByType(NominationBoard).props.busy).toBe(false);
    expect(tree.root.findByType(NominationBoard).props.nominations[0].voted).toBe(true);
  });
  it('shows rejected mutation feedback inside the sheet and preserves the submitted draft', async () => {
    const tree = await openBoard(); api.nominateReward.mockRejectedValueOnce(Error('offline'));
    await act(async () => tree.root.findAll((n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === '獎品名稱')[0].props.onChangeText('保留文字'));
    await press(tree, '提名獎品');
    const sheet = tree.root.findByType('ActionSheet' as any);
    expect(sheet.findAll((n) => String(n.type) === 'Text' && n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === '獎品名稱')[0].props.value).toBe('保留文字');
    const beforeRetry = api.getNominations.mock.calls.length;
    await press(tree, '重新載入獎品提案');
    expect(api.getNominations.mock.calls.length).toBeGreaterThan(beforeRetry);
    expect(api.nominateReward).toHaveBeenCalledTimes(1); // Refresh never replays an ambiguous mutation.
    await press(tree, '提名獎品');
    expect(tree.root.findAll((n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === '獎品名稱')[0].props.value).toBe('');
  });
});

describe('announcement focus', () => {
  it('starts exactly one request and draws cached content while it waits', async () => {
    store.set('qingmu.announcement.latest', JSON.stringify({ week: '2026-09-20', past: [] }));
    const remote = deferred<Response>(); const fetchImpl = vi.fn(() => remote.promise); vi.stubGlobal('fetch', fetchImpl);
    const tree = await render(AnnouncementsScreen);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType('AnnouncementBoard' as any).props.announcement.week).toBe('2026-09-20');
    await act(async () => remote.resolve(new Response(JSON.stringify({ week: '2026-09-27', past: [] }))));
    expect(tree.root.findByType('AnnouncementBoard' as any).props.announcement.week).toBe('2026-09-27');
  });
});
