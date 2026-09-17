import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive, api, auth, appListeners, focusCallbacks } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: { getCapabilities: vi.fn(async () => ({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false })), getProfile: vi.fn(), getPeople: vi.fn(async () => []), getMyRedemptions: vi.fn(), getAdminRedemptions: vi.fn(), getPendingOperations: vi.fn(async () => ({ ownerMemberId: 'self', redemptions: [], reversals: [] })) },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  appListeners: [] as Array<(state: string) => void>, focusCallbacks: [] as Array<() => (() => void) | void>,
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { focusCallbacks.push(callback); require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error { userMessage = 'error'; }, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: (props: any) => React.createElement('RewardControls', props) }));

import ProgressScreen from '../../app/(tabs)/progress';

describe('progress protected response lifecycle', () => {
  it('does not apply a deferred private profile response after app background clears unlock scope', async () => {
    let resolveProfile!: (value: any) => void;
    api.getProfile.mockImplementationOnce(() => new Promise((resolve) => { resolveProfile = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { appListeners[0]?.('background'); });
    await act(async () => { resolveProfile({ memberId: 'self', displayName: '私人', earnedTotal: 99, band: 1, months: [{ month: '2026-09', earnedPoints: 99 }], private: { redeemableBalance: 99, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } }); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(0);
  });

  it('does not reopen a redemption sheet when its deferred response resolves after background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let resolveRedemptions!: (value: unknown[]) => void;
    api.getMyRedemptions.mockImplementationOnce(() => new Promise((resolve) => { resolveRedemptions = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const actionSheet = renderer.root.findByType('ActionSheet' as any);
    const recordsAction = actionSheet.props.actions.find((action: any) => action.label === '我的領取紀錄');
    await act(async () => { void recordsAction.onPress(); });
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); });
    await act(async () => { resolveRedemptions([]); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ActionSheet' && node.props.title === '領取紀錄')).toHaveLength(0);
  });

  it('refreshes the signed-in member profile when returning from background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const initialCalls = api.getProfile.mock.calls.length;
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); appListeners[appListeners.length - 1]?.('active'); });
    await act(async () => { await Promise.resolve(); });
    expect(api.getProfile.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(api.getProfile.mock.calls.at(-1)).toEqual(['self', 'me', expect.stringMatching(/^\d{4}-\d{2}$/)]);
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(1);
  });

  it('refreshes the signed-in member profile after blur clears and focus restores the route', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const callback = focusCallbacks[focusCallbacks.length - 1]; const initialCalls = api.getProfile.mock.calls.length;
    await act(async () => { const cleanup = callback?.(); cleanup?.(); callback?.(); await Promise.resolve(); });
    expect(api.getProfile.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(1);
  });

  it('does not enter the admin scope when pending recovery finishes after background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let resolvePending!: (value: any) => void;
    api.getPendingOperations.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); await Promise.resolve(); });
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); resolvePending({ ownerMemberId: 'self', redemptions: [], reversals: [] }); });
    expect(api.getPeople).not.toHaveBeenCalledWith('all');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）' && node.props.accessibilityState?.selected)).toHaveLength(0);
  });

});
