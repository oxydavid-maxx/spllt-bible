import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { runtimeConfig } from '../../src/config/runtime';
import { isCurrentAuthSession, registerAuthLifecycleListener, useAuthSnapshot } from '../../src/services/authSession';
import { createGamificationApiClient, GamificationApiError, type PersonListItem, type Reward, type NominationBoardView, type ScoreChartQuery, type ScoreChartRange, type CommunityProgressView, type ScoreProfile as ScoreProfileData, type ScoreScope, type ViewerCapabilities } from '../../src/services/gamificationApiClient';
import type { PendingGamificationOperations } from '../../src/services/gamificationPendingStore';
import { createAdminUnlockGuard, createNativeAdminAuthenticator } from '../../src/services/adminUnlockGuard';
import { createProfileCache } from '../../src/services/profileCache';
import * as SecureStore from 'expo-secure-store';
import { ActionSheet } from '../../src/ui/gamification/ActionSheet';
import { FriendQrPanel } from '../../src/ui/gamification/FriendQrPanel';
import { PeopleList } from '../../src/ui/gamification/PeopleList';
import { RewardControls } from '../../src/ui/gamification/RewardControls';
import { RedemptionList } from '../../src/ui/gamification/RedemptionList';
import { CommunityProgress } from '../../src/ui/gamification/CommunityProgress';
import { NominationBoard } from '../../src/ui/gamification/NominationBoard';
import { NominationBanner } from '../../src/ui/gamification/NominationBanner';
import { ScoreProfile } from '../../src/ui/gamification/ScoreProfile';
import { theme } from '../../src/ui/Theme';

type Sheet = 'menu' | 'qr' | 'scan' | 'rewards' | 'admin-rewards' | 'redeem' | 'redemptions' | 'pending' | 'nominations' | 'open-round' | null;

export default function ProgressScreen() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const client = useMemo(() => session ? createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [session?.memberId, session?.sessionToken]);
  const [capabilities, setCapabilities] = useState<ViewerCapabilities | null>(null);
  const [scope, setScope] = useState<ScoreScope>('me');
  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [selected, setSelected] = useState<PersonListItem | null>(null);
  const [profile, setProfile] = useState<Awaited<ReturnType<NonNullable<typeof client>['getProfile']>> | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Awaited<ReturnType<NonNullable<typeof client>['getMyRedemptions']>>>([]);
  const [pendingOperations, setPendingOperations] = useState<PendingGamificationOperations | null>(null);
  const [sheet, updateSheet] = useState<Sheet>(null);
  const sheetVersion = useRef(0);
  const activeSheet = useRef<Sheet>(null);
  const setSheet = useCallback((next: Sheet) => { activeSheet.current = next; sheetVersion.current += 1; updateSheet(next); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [focused, setFocused] = useState(false);
  const [primaryReady, setPrimaryReady] = useState(false);
  const guard = useRef(createAdminUnlockGuard({ authenticate: createNativeAdminAuthenticator() }));
  // The member's own points, kept on the device so a backend that is off does not blank this page.
  // Only their own: see profileCache for why a friend's totals must not land here.
  const [profileCache] = useState(() => createProfileCache({
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  const [profileStale, setProfileStale] = useState(false);
  const requestGeneration = useRef(0);
  const viewGeneration = useRef(0);
  const profileRequest = useRef(0);
  const focusedRef = useRef(false);
  const appActive = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const activeScope = useRef<ScoreScope>('me');
  const activeMember = useRef<string | null>(session?.memberId ?? null);
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshOnForeground = useRef<(preserveScanner?: boolean) => void>(() => undefined);
  const scannerActivityRequest = useRef<object | null>(null);
  const resumeScannerAfterActivity = useRef(false);
  const nominationRead = useRef(0);
  const nominationPending = useRef<object | null>(null);
  const [nominationBusy, setNominationBusy] = useState(false);
  const [nominationError, setNominationError] = useState<string | null>(null);
  const chartCache = useRef(new Map<string, NonNullable<ScoreProfileData['chart']>>());
  const chartKey = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery) => JSON.stringify([memberId, nextScope, query.range, query.anchor ?? '']);
  const rememberChart = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery | undefined, chart: ScoreProfileData['chart']) => {
    if (!chart) return;
    chartCache.current.set(chartKey(memberId, nextScope, query ?? { range: chart.range }), chart);
    if (chart.anchor !== null) chartCache.current.set(chartKey(memberId, nextScope, { range: chart.range, anchor: chart.anchor }), chart);
  };
  const accountKey = session ? JSON.stringify([session.memberId, session.sessionToken]) : null;
  const isLive = useCallback((generation: number, expectedScope: ScoreScope, expectedMember?: string | null, requiresUnlock = false) => Boolean(focusedRef.current && appActive.current && requestGeneration.current === generation && activeScope.current === expectedScope && (expectedMember === undefined || expectedMember === activeMember.current) && session && isCurrentAuthSession(session) && (!requiresUnlock || guard.current.state === 'unlocked')), [session]);
  // Account-wide secondary content is independent of the selected chart range/member.
  const isViewLive = useCallback((generation: number) => Boolean(focusedRef.current && appActive.current && viewGeneration.current === generation && session && isCurrentAuthSession(session)), [session]);
  const stopPrefetch = useCallback(() => { if (prefetchTimer.current !== null) clearTimeout(prefetchTimer.current); prefetchTimer.current = null; }, []);
  const clearProtectedState = useCallback((preserveScanner = false) => {
    requestGeneration.current += 1; viewGeneration.current += 1; profileRequest.current += 1; nominationRead.current += 1;
    nominationPending.current = null; stopPrefetch(); client?.cancelReads?.();
    activeScope.current = 'me'; activeMember.current = null; guard.current.clear(); chartCache.current.clear();
    setScope('me'); setPeople([]); setSelected(null); setProfile(null); setProfileStale(false); setBusy(false); setError(null); setRewards([]);
    setRedemptions([]); setPendingOperations(null); setRetryAction(null); setSheet(preserveScanner ? 'scan' : null); setPrimaryReady(false);
    if (!preserveScanner) { scannerActivityRequest.current = null; resumeScannerAfterActivity.current = false; }
    setNominationBusy(false); setNominationError(null); setShelfRewards(null); setNominations(null); setCommunity(null);
  }, [client, stopPrefetch]);
  useEffect(() => registerAuthLifecycleListener((change) => { if (!change.current || change.current.memberId !== session?.memberId || change.current.sessionToken !== session?.sessionToken) clearProtectedState(); }), [accountKey, clearProtectedState]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = appActive.current;
      appActive.current = next === 'active';
      if (next !== 'active') {
        // Native permission/scanner activities can pause Android while the scan pane is in use.
        // Preserve only the pending scanner pane; protected data still clears.
        const preserveScanner = wasActive && focusedRef.current && activeSheet.current === 'scan' && scannerActivityRequest.current !== null;
        resumeScannerAfterActivity.current = preserveScanner;
        clearProtectedState(preserveScanner);
      } else if (focusedRef.current) {
        const preserveScanner = resumeScannerAfterActivity.current && activeSheet.current === 'scan';
        resumeScannerAfterActivity.current = false;
        refreshOnForeground.current(preserveScanner);
      }
    });
    return () => subscription.remove();
  }, [clearProtectedState]);
  useEffect(() => { setCapabilities(null); setError(null); }, [accountKey]);

  const prefetchCharts = useCallback(async (memberId: string, nextScope: ScoreScope, currentRange: ScoreChartRange, generation: number, requestId: number) => {
    if (!client) return;
    const owns = () => profileRequest.current === requestId && isLive(generation, nextScope, memberId, nextScope === 'all');
    for (const range of ['week', 'month', 'year', 'all'] as ScoreChartRange[]) {
      if (!owns()) return;
      if (range === currentRange || chartCache.current.has(chartKey(memberId, nextScope, { range }))) continue;
      try {
        const value = await client.getProfile(memberId, nextScope, monthNow(), { range });
        if (!owns()) return;
        rememberChart(memberId, nextScope, { range }, value.chart);
      } catch { if (!owns()) return; }
    }
  }, [client, isLive]);
  const loadProfile = useCallback(async (memberId: string, nextScope: ScoreScope, chartQuery?: ScoreChartQuery) => {
    if (!client || !session || !isLive(requestGeneration.current, nextScope, memberId, nextScope === 'all')) return;
    const generation = requestGeneration.current;
    const requestId = ++profileRequest.current;
    const owns = () => requestId === profileRequest.current && isLive(generation, nextScope, memberId, nextScope === 'all');
    stopPrefetch(); setBusy(true); setError(null);
    let remoteSettled = false;
    let remembered: ScoreProfileData | null = null;
    // Storage and network start together. A late cache must never replace a fresh response.
    const cached = !chartQuery && nextScope === 'me' && memberId === session.memberId
      ? profileCache.load(memberId).then((value) => {
        remembered = value;
        if (value && !remoteSettled && owns()) { setProfile(value); setProfileStale(true); }
      }) : Promise.resolve();
    try {
      const value = chartQuery ? await client.getProfile(memberId, nextScope, monthNow(), chartQuery) : await client.getProfile(memberId, nextScope, monthNow());
      remoteSettled = true;
      if (!owns()) return;
      rememberChart(memberId, nextScope, chartQuery, value.chart);
      setProfile(value); setProfileStale(false);
      if (nextScope === 'me' && memberId === session.memberId) void profileCache.save(memberId, value);
      if (!chartQuery && value.chart) prefetchTimer.current = setTimeout(() => {
        prefetchTimer.current = null;
        if (owns()) void prefetchCharts(memberId, nextScope, value.chart!.range, generation, requestId);
      }, 300);
    } catch (reason) {
      remoteSettled = true;
      await cached;
      if (!owns()) return;
      if (remembered) { setProfile(remembered); setProfileStale(true); }
      else setError(messageFor(reason));
    } finally {
      if (owns()) { setBusy(false); setPrimaryReady(true); }
    }
  }, [client, session, isLive, profileCache, prefetchCharts, stopPrefetch]);
  const loadPeople = useCallback(async (nextScope: Exclude<ScoreScope, 'me'>) => {
    if (!client || !session || !isLive(requestGeneration.current, nextScope, undefined, nextScope === 'all')) return;
    const generation = requestGeneration.current;
    const owns = () => isLive(generation, nextScope, undefined, nextScope === 'all');
    setBusy(true); setError(null);
    try { const value = await client.getPeople(nextScope); if (owns()) { setPeople(value); setSelected(null); setProfile(null); } }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
    finally { if (owns()) setBusy(false); }
  }, [client, session, isLive]);
  const loadProfileChart = useCallback((chartQuery: ScoreChartQuery) => {
    if (!client || !session || !focusedRef.current || !appActive.current) return;
    const memberId = activeMember.current;
    const nextScope = activeScope.current;
    if (!memberId || (nextScope === 'me' && memberId !== session.memberId) || (nextScope === 'all' && guard.current.state !== 'unlocked')) return;
    requestGeneration.current += 1; stopPrefetch();
    const cached = chartCache.current.get(chartKey(memberId, nextScope, chartQuery));
    if (cached) { setBusy(false); setProfile((previous) => previous && previous.memberId === memberId ? { ...previous, chart: cached } : previous); return; }
    void loadProfile(memberId, nextScope, chartQuery);
  }, [client, session, loadProfile, stopPrefetch]);
  const refreshOwnProfile = useCallback((preserveScanner = false) => {
    if (!client || !session || !focusedRef.current || !appActive.current) return;
    clearProtectedState(preserveScanner); activeMember.current = session.memberId;
    void loadProfile(session.memberId, 'me');
  }, [client, session, clearProtectedState, loadProfile]);
  refreshOnForeground.current = refreshOwnProfile;
  useFocusEffect(useCallback(() => {
    focusedRef.current = true; setFocused(true); refreshOwnProfile();
    return () => { focusedRef.current = false; setFocused(false); clearProtectedState(); };
  }, [clearProtectedState, refreshOwnProfile]));
  // Everything secondary waits for the one critical own-profile request to settle.
  useEffect(() => {
    if (!client || !session || !focused || !primaryReady || capabilities) return;
    let active = true; const generation = viewGeneration.current;
    void client.getCapabilities().then((value) => { if (active && isViewLive(generation)) setCapabilities(value); }).catch((reason) => { if (active && isViewLive(generation)) setError(messageFor(reason)); });
    return () => { active = false; };
  }, [client, session, focused, primaryReady, capabilities, isViewLive]);

  const chooseScope = async (nextScope: ScoreScope) => {
    if (!client || !session || !focusedRef.current || !appActive.current || (nextScope === scope && !(nextScope !== 'me' && selected))) return;
    let restoredPending: PendingGamificationOperations | null = null;
    if (nextScope === 'all') {
      if (!capabilities?.canViewAllScores) { setError('此功能僅限管理者。'); return; }
      const generation = ++requestGeneration.current; const expectedScope = activeScope.current;
      const attempt = createAdminUnlockGuard({ authenticate: createNativeAdminAuthenticator() }); guard.current = attempt;
      const owns = () => guard.current === attempt && isLive(generation, expectedScope);
      setBusy(true);
      try {
        const unlocked = await attempt.unlock();
        if (!owns()) { attempt.clear(); return; }
        if (!unlocked) { setError('需要完成身分驗證才能查看全體。'); return; }
        restoredPending = await client.getPendingOperations();
        if (!owns()) { attempt.clear(); return; }
      } catch (reason) { if (owns()) { setPendingOperations(null); setError(messageFor(reason)); } else return; }
      finally { if (owns()) setBusy(false); }
      if (!owns() || attempt.state !== 'unlocked') return;
    } else if (scope === 'all') guard.current.clear();
    requestGeneration.current += 1; stopPrefetch();
    activeScope.current = nextScope; activeMember.current = nextScope === 'me' ? session.memberId : null;
    setScope(nextScope); setSheet(null); setSelected(null); setProfile(null); setProfileStale(false);
    setPendingOperations(nextScope === 'all' ? restoredPending : null);
    if (nextScope !== 'me') void loadPeople(nextScope);
    else void loadProfile(session.memberId, 'me');
  };
  const openProfile = (person: PersonListItem) => {
    if (!isLive(requestGeneration.current, scope, undefined, scope === 'all')) return;
    requestGeneration.current += 1; stopPrefetch(); activeMember.current = person.memberId;
    setSelected(person); setProfile(null); void loadProfile(person.memberId, scope);
  };
  const loadRewards = async (destination: 'rewards' | 'admin-rewards' = 'rewards') => {
    if (!client || !session) return;
    const generation = requestGeneration.current; const expectedScope = activeScope.current;
    const origin = sheetVersion.current;
    const owns = () => sheetVersion.current === origin && isLive(generation, expectedScope, undefined, expectedScope === 'all');
    if (!owns()) return;
    try { const value = await client.getRewards(); if (owns()) { setRewards(value); setSheet(destination); } }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const loadRedemptions = async (admin: boolean, memberId?: string) => {
    if (!client || !session) return;
    const generation = requestGeneration.current; const expectedScope = activeScope.current;
    const expectedMember = admin ? memberId ?? selected?.memberId ?? null : undefined;
    const origin = sheetVersion.current;
    const owns = () => sheetVersion.current === origin && isLive(generation, expectedScope, expectedMember, expectedScope === 'all');
    if (!owns()) return;
    try { const value = admin ? await client.getAdminRedemptions(memberId) : await client.getMyRedemptions(); if (owns()) { setRedemptions(value); setRetryAction(null); setSheet('redemptions'); } }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const removeSelectedFriend = async () => {
    if (!client || !selected || scope !== 'friends') return;
    const generation = requestGeneration.current; const memberId = selected.memberId;
    const owns = () => isLive(generation, 'friends', memberId);
    try { await client.removeFriend(memberId); if (!owns()) return; setSheet(null); setSelected(null); setProfile(null); activeMember.current = null; await loadPeople('friends'); }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const scannerViewGeneration = viewGeneration.current;
  const scannerSheetVersion = sheetVersion.current;
  const scanClaimed = (memberId: string) => {
    // Captured by the scanner that initiated the claim, not re-read when its response arrives.
    if (activeSheet.current !== 'scan' || sheetVersion.current !== scannerSheetVersion || !isViewLive(scannerViewGeneration)) return;
    requestGeneration.current += 1; stopPrefetch(); activeScope.current = 'friends'; activeMember.current = memberId;
    setSheet(null); setScope('friends'); setSelected({ memberId, displayName: '好友', earnedTotal: 0 }); setProfile(null); void loadProfile(memberId, 'friends');
  };
  const beginScannerActivity = () => {
    const request = {}; const requestSession = session;
    scannerActivityRequest.current = request;
    return () => {
      if (scannerActivityRequest.current !== request) return false;
      scannerActivityRequest.current = null;
      const current = Boolean(requestSession && isCurrentAuthSession(requestSession) && focusedRef.current && appActive.current && activeSheet.current === 'scan');
      if (!current) {
        resumeScannerAfterActivity.current = false;
        if (activeSheet.current === 'scan') setSheet(null);
      }
      return current;
    };
  };
  const selectedRewardId = profile?.private?.targetReward?.rewardId ?? null;
  const setTarget = async (rewardId: string) => {
    if (!client || !session) return;
    const generation = requestGeneration.current;
    const origin = sheetVersion.current;
    const owns = () => isLive(generation, 'me', session.memberId);
    if (!owns()) return;
    try { await client.setRewardTarget(rewardId); if (!owns()) return; if (sheetVersion.current === origin) setSheet(null); setShelfRewards(null); await loadProfile(session.memberId, 'me'); }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const mutateRewards = async (action: () => Promise<unknown>) => {
    if (!client || !session) return;
    const generation = requestGeneration.current; const expectedScope = activeScope.current;
    const owns = () => isLive(generation, expectedScope, undefined, expectedScope === 'all');
    if (!owns()) return;
    try { await action(); if (!owns()) return; const value = await client.getRewards(); if (owns()) { setRewards(value); setShelfRewards(null); } }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const [shelfRewards, setShelfRewards] = useState<Reward[] | null>(null);
  const [nominations, setNominations] = useState<NominationBoardView | null>(null);
  const [community, setCommunity] = useState<CommunityProgressView | null>(null);
  useEffect(() => {
    if (!client || !session || !focused || !primaryReady || scope !== 'me' || !profile?.private || shelfRewards !== null || typeof client.getRewards !== 'function') return;
    let active = true; const generation = viewGeneration.current;
    void client.getRewards().then((value) => { if (active && isViewLive(generation)) setShelfRewards(value); }).catch(() => { if (active && isViewLive(generation)) setShelfRewards([]); });
    return () => { active = false; };
  }, [client, session, scope, profile?.private, shelfRewards, focused, primaryReady, isViewLive]);
  const reloadNominations = useCallback(async (reportError = false, afterMutation = false): Promise<boolean> => {
    if (!client || !session || !focusedRef.current || !appActive.current || typeof client.getNominations !== 'function' || (nominationPending.current && !afterMutation)) return false;
    const generation = viewGeneration.current;
    const readId = ++nominationRead.current;
    const owns = () => nominationRead.current === readId && isViewLive(generation);
    try {
      const value = await client.getNominations();
      if (!owns()) return false;
      setNominations(value); if (reportError) setNominationError(null);
      return true;
    } catch (reason) { if (owns() && reportError) setNominationError(messageFor(reason)); return false; }
  }, [client, session, isViewLive]);
  useEffect(() => {
    if (!focused || !primaryReady || scope !== 'me' || nominations !== null) return;
    void reloadNominations();
  }, [focused, primaryReady, scope, nominations, reloadNominations]);
  useEffect(() => {
    if (!client || !session || !focused || !primaryReady || scope !== 'me' || community !== null || typeof client.getCommunityProgress !== 'function') return;
    let active = true; const generation = viewGeneration.current;
    void client.getCommunityProgress().then((value) => { if (active && isViewLive(generation)) setCommunity(value); }).catch(() => { if (active && isViewLive(generation)) setCommunity({ books: [], personDays: null, currentBook: null }); });
    return () => { active = false; };
  }, [client, session, scope, community, focused, primaryReady, isViewLive]);
  useEffect(() => {
    if (!focused || sheet !== 'nominations') return;
    void reloadNominations(true);
    const timer = setInterval(() => { void reloadNominations(); }, 20000);
    return () => clearInterval(timer);
  }, [focused, sheet, reloadNominations]);
  const runNomination = async (action: () => Promise<void>, options: { close?: boolean; rewards?: boolean } = {}): Promise<boolean> => {
    if (!client || !session || nominationPending.current) return false;
    // The same account's board survives chart/scope navigation while a write settles.
    const generation = viewGeneration.current;
    const owns = () => isViewLive(generation);
    if (!owns()) return false;
    const pending = {}; nominationPending.current = pending; nominationRead.current += 1;
    const originatingSheet = sheetVersion.current;
    client.cancelReads?.('/api/rewards/nominations');
    setNominationBusy(true); setNominationError(null);
    try {
      await action();
      if (!owns()) return false;
      // A pre-mutation GET must not be reused as the post-mutation refresh.
      client.cancelReads?.('/api/rewards/nominations');
      const refreshed = await reloadNominations(true, true);
      if (!owns()) return false;
      if (options.rewards) setShelfRewards(null);
      if (options.close && refreshed && sheetVersion.current === originatingSheet) setSheet(null);
      return true;
    } catch (reason) { if (owns()) setNominationError(messageFor(reason)); return false; }
    finally { if (nominationPending.current === pending) { nominationPending.current = null; setNominationBusy(false); } }
  };
  const openNominationRound = (days: number) => runNomination(() => client!.openNominationRound({ title: Number(monthNow().slice(5)) + ' 月獎品', closesAt: Date.now() + days * 24 * 60 * 60 * 1000 }), { close: true });

  const redeemSelected = async (rewardId: string) => { if (!client || !selected) return; const reward = rewards.find((item) => item.rewardId === rewardId); if (!reward) return; const generation = requestGeneration.current; const memberId = selected.memberId; try { await client.redeem({ memberId, rewardId, expectedRewardRevision: reward.revision }); if (!isLive(generation, 'all', memberId, true)) return; setRetryAction(null); setSheet(null); await loadProfile(memberId, 'all'); } catch (reason) { if (isLive(generation, 'all', memberId, true) && reason instanceof GamificationApiError && reason.retryable) { setRetryAction(() => () => { void redeemSelected(rewardId); }); setError('尚未確認，點此重試。'); } else if (isLive(generation, 'all', memberId, true)) setError(messageFor(reason)); } };
  const openRedeem = async () => { if (!client || !session || !selected) return; const generation = requestGeneration.current; const memberId = selected.memberId; try { const value = await client.getRewards(); if (isLive(generation, 'all', memberId, true)) { setRewards(value); setSheet('redeem'); } } catch (reason) { if (isLive(generation, 'all', memberId, true)) setError(messageFor(reason)); } };
  const reverseSelected = async (redemptionId: string, reason: string) => { if (!client || !session) return; const generation = requestGeneration.current; const expectedScope = scope; const memberId = selected?.memberId; try { await client.reverseRedemption(redemptionId, reason); if (!isLive(generation, expectedScope, memberId, expectedScope === 'all')) return; setRetryAction(null); await loadRedemptions(expectedScope === 'all', memberId); if (!isLive(generation, expectedScope, memberId, expectedScope === 'all')) return; if (expectedScope === 'all' && memberId) await loadProfile(memberId, 'all'); else await loadProfile(session.memberId, 'me'); } catch (errorValue) { if (isLive(generation, expectedScope, memberId, expectedScope === 'all') && errorValue instanceof GamificationApiError && errorValue.retryable) { setRetryAction(() => () => { void reverseSelected(redemptionId, reason); }); setError('尚未確認，點此重試。'); } else if (isLive(generation, expectedScope, memberId, expectedScope === 'all')) setError(messageFor(errorValue)); } };
  const refreshPending = async () => { if (!client || !session || scope !== 'all' || guard.current.state !== 'unlocked') return; const generation = requestGeneration.current; try { const value = await client.getPendingOperations(); if (isLive(generation, 'all', undefined, true)) setPendingOperations(value); } catch (reason) { if (isLive(generation, 'all', undefined, true)) setError(messageFor(reason)); } };
  const retrySaved = async (operationId: string, reversal: boolean) => {
    if (!client || !isLive(requestGeneration.current, 'all', undefined, true)) return;
    const generation = requestGeneration.current;
    try { if (reversal) await client.retryPendingReversal(operationId); else await client.retryPendingRedemption(operationId); }
    catch (reason) { if (isLive(generation, 'all', undefined, true)) setError(messageFor(reason)); }
    if (isLive(generation, 'all', undefined, true)) await refreshPending();
  };
  const retrySavedRedemption = (operationId: string) => retrySaved(operationId, false);
  const retrySavedReversal = (operationId: string) => retrySaved(operationId, true);

  if (!session) return <View style={styles.screen}><Text style={styles.title}>積分</Text><Text style={styles.note}>請先登入以查看積分。</Text></View>;
  const showingProfile = scope !== 'me' && selected && profile;
  return <View style={styles.screen}>
    <View style={styles.scopeHeader}><View style={styles.scopes}>{(['me', 'friends', ...(capabilities?.canViewAllScores ? ['all'] : [])] as ScoreScope[]).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: scope === item }} accessibilityLabel={item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體（管理）'} onPress={() => void chooseScope(item)} style={[styles.scope, scope === item && styles.scopeActive]}><Text style={[styles.scopeText, scope === item && styles.scopeTextActive]}>{item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體（管理）'}</Text></Pressable>)}</View><Pressable accessibilityRole="button" accessibilityLabel="開啟積分操作" onPress={() => setSheet('menu')} style={styles.menu}><Text style={styles.menuText}>⋯</Text></Pressable></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{busy ? <Text style={styles.note}>載入中…</Text> : null}
    {/* A number with no note beside it claims to be current. This one is not. */}
    {profileStale && scope === 'me' ? <Text style={styles.stale}>目前顯示上次的積分，還沒連上更新</Text> : null}
    {scope === 'me' && !profile ? <View style={styles.noteBox}><Text style={styles.note}>正在載入你的積分。</Text></View> : null}
    {scope !== 'me' ? <View style={showingProfile ? styles.hiddenList : styles.listSurface}><PeopleList people={people} showRank={scope === 'all'} onSelect={openProfile} /></View> : null}
    {showingProfile ? <><Pressable accessibilityRole="button" accessibilityLabel="返回積分清單" onPress={() => { requestGeneration.current += 1; stopPrefetch(); activeMember.current = null; setBusy(false); setProfile(null); setSelected(null); }} style={styles.back}><Text style={styles.backText}>‹ 返回清單</Text></Pressable><ScoreProfile profile={profile} onChartChange={loadProfileChart} onOpenActions={scope === 'all' && capabilities?.canRedeemRewards ? () => { void openRedeem(); } : undefined} /></> : null}
    {scope === 'me' && nominations?.round ? <NominationBanner
      round={nominations.round}
      nowMs={Date.now()}
      mine={nominations.nominations.some((item) => item.mine && item.status === 'OPEN')}
      onOpen={() => setSheet('nominations')}
    /> : null}
    {scope === 'me' && profile ? <ScoreProfile profile={profile} rewards={shelfRewards ?? undefined} community={community ? <CommunityProgress books={community.books} personDays={community.personDays} currentBook={community.currentBook} /> : undefined} onChooseTarget={(rewardId) => { void setTarget(rewardId); }} onChartChange={loadProfileChart} onChooseReward={() => void loadRewards()} /> : null}
    <ActionSheet visible={sheet === 'menu'} title="積分操作" dismissOnOutsideTap onClose={() => setSheet(null)} actions={[{ label: '我的好友 QR', onPress: () => setSheet('qr') }, { label: '掃描好友 QR', onPress: () => setSheet('scan') }, { label: '我的領取紀錄', onPress: () => { void loadRedemptions(false); } }, ...(scope === 'friends' && selected ? [{ label: '移除好友', destructive: true, onPress: () => { void removeSelectedFriend(); } }] : []), ...(scope === 'all' && selected && capabilities?.canRedeemRewards ? [{ label: '查看領取紀錄', onPress: () => { void loadRedemptions(true, selected.memberId); } }] : []), ...(scope === 'all' && capabilities?.canRedeemRewards && pendingOperations && pendingOperations.redemptions.length + pendingOperations.reversals.length > 0 ? [{ label: `尚未確認操作 (${pendingOperations.redemptions.length + pendingOperations.reversals.length})`, onPress: () => setSheet('pending') }] : []), ...(capabilities?.canManageRewards ? [{ label: '管理獎品', onPress: () => { void loadRewards('admin-rewards'); } }] : []), ...(capabilities?.canManageRewards && !nominations?.round ? [{ label: '開一輪獎品提案', onPress: () => setSheet('open-round') }] : []), ...(nominations?.round ? [{ label: '獎品提案', onPress: () => setSheet('nominations') }] : [])]} />
    <ActionSheet visible={sheet === 'nominations'} title={nominations?.round?.title ?? '獎品提案'} onClose={() => setSheet(null)}>
      {nominationBusy ? <Text accessibilityLiveRegion="polite" style={styles.note}>處理中…</Text> : null}
      {nominationError ? <><Text accessibilityRole="alert" style={styles.error}>{nominationError}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新載入獎品提案" disabled={nominationBusy} onPress={() => { void reloadNominations(true); }} style={styles.retry}><Text style={styles.retryText}>重新載入</Text></Pressable></> : null}
      <NominationBoard
        round={nominations?.round ?? null}
        nominations={nominations?.nominations ?? []}
        canManage={Boolean(capabilities?.canManageRewards)}
        nowMs={Date.now()}
        votesLeft={nominations?.votesLeft}
        votesPerMember={nominations?.votesPerMember}
        busy={nominationBusy}
        onNominate={(name, note) => runNomination(() => client!.nominateReward({ name, ...(note ? { note } : {}) }))}
        onVote={(nominationId, voting) => { void runNomination(() => client!.setNominationVote(nominationId, voting)); }}
        onWithdraw={(nominationId) => { void runNomination(() => client!.withdrawNomination(nominationId)); }}
        onResolveSuggestion={(nominationId, accept) => { void runNomination(() => client!.resolveNoteSuggestion(nominationId, accept)); }}
        onDecide={(nominationId, decision, revision, costPoints) => { void runNomination(() => client!.decideNomination(nominationId, decision, { expectedRevision: revision, ...(costPoints ? { costPoints } : {}) }), { rewards: true }); }}
        onCloseRound={(roundId) => { void runNomination(() => client!.closeNominationRound(roundId), { close: true }); }}
      />
    </ActionSheet>
    <ActionSheet visible={sheet === 'open-round'} title="開一輪獎品提案" dismissOnOutsideTap onClose={() => setSheet(null)}
      actions={[7, 14, 30].map((days) => ({ label: `${days} 天後截止`, disabled: nominationBusy, onPress: () => { void openNominationRound(days); } }))}>{nominationBusy ? <Text accessibilityLiveRegion="polite" style={styles.note}>處理中…</Text> : null}
      {nominationError ? <><Text accessibilityRole="alert" style={styles.error}>{nominationError}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新載入獎品提案" disabled={nominationBusy} onPress={() => { void reloadNominations(true); }} style={styles.retry}><Text style={styles.retryText}>重新載入</Text></Pressable></> : null}</ActionSheet>
    <ActionSheet visible={sheet === 'qr'} title="我的好友 QR" dismissOnOutsideTap onClose={() => setSheet(null)}><FriendQrPanel client={client!} mode="show" /></ActionSheet>
    <ActionSheet visible={sheet === 'scan'} title="掃描好友 QR" onClose={() => setSheet(null)}><FriendQrPanel client={client!} mode="scan" onClaimed={scanClaimed} onActivityStart={beginScannerActivity} /></ActionSheet>
    <ActionSheet visible={sheet === 'rewards'} title="選擇目標獎品" dismissOnOutsideTap onClose={() => setSheet(null)}><RewardControls rewards={rewards} selectedRewardId={selectedRewardId} canEdit onSelect={(rewardId) => void setTarget(rewardId)} /></ActionSheet>
    <ActionSheet visible={sheet === 'admin-rewards'} title="管理獎品" onClose={() => setSheet(null)}><RewardControls rewards={rewards} selectedRewardId={null} canEdit admin
      onCreate={(name, costPoints) => mutateRewards(() => client!.createReward({ name, costPoints }))}
      onUpdate={(rewardId, patch) => mutateRewards(async () => { const reward = rewards.find((item) => item.rewardId === rewardId); if (reward) await client!.updateReward(rewardId, patch, reward.revision); })}
      onArchive={(rewardId) => mutateRewards(async () => { const reward = rewards.find((item) => item.rewardId === rewardId); if (reward) await client!.updateReward(rewardId, { active: false }, reward.revision); })} /></ActionSheet>
    <ActionSheet visible={sheet === 'redeem'} title="現場兌換" onClose={() => setSheet(null)} actions={[{ label: '關閉', onPress: () => setSheet(null) }]}><Text style={styles.note}>請選擇獎品並確認交付。</Text><RewardControls rewards={rewards} selectedRewardId={null} canEdit={false} redeemableBalance={profile?.private?.redeemableBalance} onRedeem={(rewardId) => { void redeemSelected(rewardId); }} />{retryAction ? <Pressable accessibilityRole="button" accessibilityLabel="重試尚未確認兌換" onPress={() => { const retry = retryAction; setRetryAction(null); retry(); }} style={styles.retry}><Text style={styles.retryText}>重試尚未確認兌換</Text></Pressable> : null}</ActionSheet>
    <ActionSheet visible={sheet === 'redemptions'} title="領取紀錄" onClose={() => setSheet(null)}><RedemptionList redemptions={redemptions} canReverse={scope === 'all' && Boolean(capabilities?.canRedeemRewards)} onReverse={(redemptionId, reason) => { void reverseSelected(redemptionId, reason); }} />{retryAction ? <Pressable accessibilityRole="button" accessibilityLabel="重試尚未確認操作" onPress={() => { const retry = retryAction; setRetryAction(null); retry(); }} style={styles.retry}><Text style={styles.retryText}>重試尚未確認操作</Text></Pressable> : null}</ActionSheet>
    <ActionSheet visible={sheet === 'pending' && scope === 'all' && guard.current.state === 'unlocked'} title="尚未確認操作" onClose={() => setSheet(null)}>
      <Text style={styles.note}>這些操作將使用首次送出時保存的內容重新確認。</Text>
      {pendingOperations?.redemptions.map((item) => <Pressable key={item.operationId} accessibilityRole="button" accessibilityLabel={`重試尚未確認兌換 ${item.rewardId}`} onPress={() => { void retrySavedRedemption(item.operationId); }} style={styles.retry}><Text style={styles.retryText}>重試兌換：{item.memberId}/{item.rewardId}</Text></Pressable>)}
      {pendingOperations?.reversals.map((item) => <Pressable key={item.operationId} accessibilityRole="button" accessibilityLabel={`重試尚未確認撤銷 ${item.redemptionId}`} onPress={() => { void retrySavedReversal(item.operationId); }} style={styles.retry}><Text style={styles.retryText}>重試撤銷：{item.redemptionId}</Text></Pressable>)}
    </ActionSheet>
  </View>;
}

function monthNow(): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(new Date()); const year = parts.find((part) => part.type === 'year')?.value ?? '1970'; const month = parts.find((part) => part.type === 'month')?.value ?? '01'; return `${year}-${month}`; }
function messageFor(reason: unknown): string { return reason instanceof GamificationApiError ? reason.userMessage : '目前無法載入積分，請稍後再試。'; }
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }, title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' }, scopeHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.md }, menu: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' }, menuText: { color: theme.colors.ink, fontSize: 26 }, scopes: { flex: 1, flexDirection: 'row', gap: theme.spacing.xs }, scope: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }, scopeActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, scopeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, scopeTextActive: { color: theme.colors.white }, note: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line }, noteBox: { padding: theme.spacing.lg, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface }, listSurface: { flex: 1 }, hiddenList: { display: 'none' }, error: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, marginBottom: theme.spacing.sm }, retry: { minHeight: theme.control.tap, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft }, stale: { color: theme.colors.muted, fontSize: theme.type.caption.size, marginBottom: theme.spacing.sm }, retryText: { color: theme.colors.accent, fontSize: theme.type.label.size, fontWeight: '800' }, back: { minHeight: theme.control.tap, justifyContent: 'center' }, backText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' } });
