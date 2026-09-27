import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { primitive, api, auth } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: {
    getCapabilities: vi.fn(async () => ({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false })),
    getProfile: vi.fn(async (memberId: string, scope: string = 'me') => ({ memberId, displayName: memberId === 'self' ? '光佑' : '小明', earnedTotal: 4, band: null, months: [], permissions: { canEditTarget: memberId === 'self', canRedeem: false }, ...(scope === 'me' ? { private: { redeemableBalance: 4, targetReward: null } } : {}) })),
    getPeople: vi.fn(async (): Promise<Array<{ memberId: string; displayName: string; earnedTotal: number }>> => [{ memberId: 'friend-old', displayName: '小華', earnedTotal: 32 }]),
    getRewards: vi.fn(async () => []),
    getNominations: vi.fn(async () => ({ round: null, nominations: [], votesLeft: 3, votesPerMember: 3 })),
    getCommunityProgress: vi.fn(async () => ({ books: [], personDays: null, currentBook: null })),
  },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline') }; });
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error {}, createGamificationApiClient: () => api }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: async () => null }) }));
vi.mock('../../src/services/useCompletionController', () => ({ useCompletionController: (options: { planId: string; taskDate: string }) => ({ record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' }, pending: false, syncError: false, retryable: false, complete: vi.fn(async () => undefined), requestUndo: vi.fn() }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));

import ProgressScreen from '../../app/(tabs)/progress';
import { consumeOpenFriendsList, publishFriendAdded, requestOpenFriendsList } from '../../src/services/friendPush';

let renderer: TestRenderer.ReactTestRenderer | null = null;
let pushCounter = 0;
afterEach(() => { act(() => { renderer?.unmount(); }); renderer = null; consumeOpenFriendsList(); });

async function mount() {
  await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
  await act(async () => { await Promise.resolve(); });
  return renderer!;
}
const byLabel = (label: string) => renderer!.root.findAll((node) => node.props?.accessibilityLabel === label)[0];
const sheet = (title: string) => renderer!.root.findAll((node) => (node.type as unknown) === 'ActionSheet' && node.props.title === title)[0];
const texts = () => renderer!.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
async function openMenuAction(label: string) {
  await act(async () => { byLabel('開啟積分操作').props.onPress(); });
  await act(async () => { sheet('積分操作').props.actions.find((action: { label: string }) => action.label === label).onPress(); });
}
async function friendAdded(friendName = '小明') {
  pushCounter += 1;
  await act(async () => { publishFriendAdded({ friendMemberId: `friend-new-${pushCounter}`, friendName }); await Promise.resolve(); await Promise.resolve(); });
}

describe('a new friend shows up on the 積分 screen as it happens', () => {
  it('says who added you inside an open 我的好友 QR, and refreshes the friends list behind it', async () => {
    await mount();
    await act(async () => { byLabel('好友').props.onPress(); });
    expect(api.getPeople).toHaveBeenCalledTimes(1);
    await openMenuAction('我的好友 QR');
    expect(texts()).not.toContain('名單已經更新，可以關掉了');

    api.getPeople.mockResolvedValueOnce([{ memberId: 'friend-new', displayName: '小明', earnedTotal: 0 }, { memberId: 'friend-old', displayName: '小華', earnedTotal: 32 }]);
    await friendAdded('小明');
    expect(byLabel('✓ 小明 已加你為好友')).toBeDefined();
    expect(texts()).toContain('名單已經更新，可以關掉了');
    expect(api.getPeople).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByType('PeopleList' as never).props.people.map((person: { displayName: string }) => person.displayName)).toEqual(['小明', '小華']);
  });

  it('refreshes the friends list once when the QR sheet is closed, and starts the next one clean', async () => {
    await mount();
    await act(async () => { byLabel('好友').props.onPress(); });
    await openMenuAction('我的好友 QR');
    await friendAdded('小明');
    const before = api.getPeople.mock.calls.length;
    await act(async () => { sheet('我的好友 QR').props.onClose(); await Promise.resolve(); });
    expect(api.getPeople.mock.calls.length).toBe(before + 1);
    await openMenuAction('我的好友 QR');
    expect(texts()).not.toContain('名單已經更新，可以關掉了');
  });

  it('refreshes your own page when you are on 自己', async () => {
    await mount();
    const before = api.getProfile.mock.calls.filter((call) => call[0] === 'self').length;
    await friendAdded('小明');
    expect(api.getProfile.mock.calls.filter((call) => call[0] === 'self').length).toBe(before + 1);
    expect(api.getPeople).not.toHaveBeenCalled();
  });

  it('refreshes the scanner’s own friends list after a successful claim', async () => {
    await mount();
    await openMenuAction('掃描好友 QR');
    api.getPeople.mockResolvedValueOnce([{ memberId: 'friend-scanned', displayName: '小明', earnedTotal: 0 }]);
    await act(async () => { renderer!.root.findByType('FriendQrPanel' as never).props.onClaimed('friend-scanned'); await Promise.resolve(); await Promise.resolve(); });
    expect(api.getProfile).toHaveBeenCalledWith('friend-scanned', 'friends', expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(api.getPeople).toHaveBeenCalledWith('friends');
    await act(async () => { byLabel('返回積分清單').props.onPress(); });
    expect(renderer!.root.findByType('PeopleList' as never).props.people).toEqual([{ memberId: 'friend-scanned', displayName: '小明', earnedTotal: 0 }]);
  });

  it('opens the friends list when the notification was tapped', async () => {
    await mount();
    await act(async () => { requestOpenFriendsList(); await Promise.resolve(); });
    expect(api.getPeople).toHaveBeenCalledWith('friends');
    expect(byLabel('好友').props.accessibilityState).toEqual({ selected: true });
  });

  it('takes a tap that arrived before the screen was shown when it first opens', async () => {
    requestOpenFriendsList();
    await mount();
    expect(api.getPeople).toHaveBeenCalledWith('friends');
  });
});
