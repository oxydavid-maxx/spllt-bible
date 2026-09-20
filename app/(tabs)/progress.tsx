import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { runtimeConfig } from '../../src/config/runtime';
import { isCurrentAuthSession, registerAuthLifecycleListener, useAuthSnapshot } from '../../src/services/authSession';
import { createGamificationApiClient, GamificationApiError, type PersonListItem, type Reward, type NominationBoardView, type ScoreChartQuery, type ScoreChartRange, type CommunityProgressView, type ScoreProfile as ScoreProfileData, type ScoreScope, type ViewerCapabilities } from '../../src/services/gamificationApiClient';
import type { PendingGamificationOperations } from '../../src/services/gamificationPendingStore';
import { createAdminUnlockGuard, createNativeAdminAuthenticator } from '../../src/services/adminUnlockGuard';
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
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [foregroundRevision, setForegroundRevision] = useState(0);
  const guard = useRef(createAdminUnlockGuard({ authenticate: createNativeAdminAuthenticator() }));
  const requestGeneration = useRef(0);
  const appActive = useRef(true);
  const activeScope = useRef<ScoreScope>('me');
  const activeMember = useRef<string | null>(session?.memberId ?? null);
  // Range tabs used to round-trip the server on every tap (~0.5–2 s over the tunnel). Charts are small
  // and immutable for a given day, so keep every chart we have seen and prefetch the other ranges once.
  const chartCache = useRef(new Map<string, NonNullable<ScoreProfileData['chart']>>());
  const chartKey = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery) => `${memberId}|${nextScope}|${query.range}|${query.anchor ?? ''}`;
  const rememberChart = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery | undefined, chart: ScoreProfileData['chart']) => {
    if (!chart) return;
    chartCache.current.set(chartKey(memberId, nextScope, query ?? { range: chart.range }), chart);
    if (chart.anchor !== null) chartCache.current.set(chartKey(memberId, nextScope, { range: chart.range, anchor: chart.anchor }), chart);
  };
  const accountKey = session ? `${session.memberId}:${session.sessionToken}` : null;
  const isLive = (generation: number, expectedScope: ScoreScope, expectedMember?: string | null, requiresUnlock = false) => Boolean(appActive.current && requestGeneration.current === generation && activeScope.current === expectedScope && (expectedMember === undefined || expectedMember === activeMember.current || expectedMember === session?.memberId) && session && isCurrentAuthSession(session) && (!requiresUnlock || guard.current.state === 'unlocked'));

  const clearProtectedState = useCallback(() => { requestGeneration.current += 1; activeScope.current = 'me'; activeMember.current = null; guard.current.clear(); setScope('me'); setPeople([]); setSelected(null); setProfile(null); setRedemptions([]); setPendingOperations(null); setRetryAction(null); setSheet(null); }, []);
  useEffect(() => registerAuthLifecycleListener((change) => { if (!change.current || change.current.memberId !== session?.memberId || change.current.sessionToken !== session?.sessionToken) clearProtectedState(); }), [accountKey, clearProtectedState]);
  useEffect(() => { const subscription = AppState.addEventListener('change', (next) => { appActive.current = next === 'active'; if (next !== 'active') clearProtectedState(); else setForegroundRevision((revision) => revision + 1); }); return () => subscription.remove(); }, [clearProtectedState]);

  useEffect(() => {
    let active = true; const requestSession = session; const generation = ++requestGeneration.current; appActive.current = true; activeScope.current = 'me'; activeMember.current = session?.memberId ?? null; setCapabilities(null); setProfile(null); setPeople([]); setSelected(null); setScope('me'); setError(null);
    if (!client || !requestSession) return undefined;
    void client.getCapabilities().then((value) => { if (active && appActive.current && requestGeneration.current === generation && isCurrentAuthSession(requestSession)) setCapabilities(value); }).catch((reason) => { if (active && appActive.current && requestGeneration.current === generation && isCurrentAuthSession(requestSession)) setError(messageFor(reason)); });
    return () => { active = false; };
  }, [client, accountKey]);

  const loadPeople = useCallback(async (nextScope: Exclude<ScoreScope, 'me'>) => {
    if (!client || !session) return; setBusy(true); setError(null);
    const generation = requestGeneration.current;
    try { const value = await client.getPeople(nextScope); if (appActive.current && requestGeneration.current === generation && activeScope.current === nextScope && isCurrentAuthSession(session) && (nextScope !== 'all' || guard.current.state === 'unlocked')) { setPeople(value); setSelected(null); setProfile(null); } }
    catch (reason) { if (appActive.current && requestGeneration.current === generation && activeScope.current === nextScope && isCurrentAuthSession(session)) setError(messageFor(reason)); }
    finally { setBusy(false); }
  }, [client, session]);

  const loadProfile = useCallback(async (memberId: string, nextScope: ScoreScope, chartQuery?: ScoreChartQuery) => {
    if (!client || !session) return; setBusy(true); setError(null);
    const generation = requestGeneration.current;
    try { const value = chartQuery ? await client.getProfile(memberId, nextScope, monthNow(), chartQuery) : await client.getProfile(memberId, nextScope, monthNow()); rememberChart(memberId, nextScope, chartQuery, value.chart); if (appActive.current && requestGeneration.current === generation && activeScope.current === nextScope && activeMember.current === memberId && isCurrentAuthSession(session) && (nextScope !== 'all' || guard.current.state === 'unlocked')) { setProfile(value); if (!chartQuery) void prefetchCharts(memberId, nextScope, value.chart?.range ?? 'month'); } }
    catch (reason) { if (appActive.current && requestGeneration.current === generation && activeScope.current === nextScope && activeMember.current === memberId && isCurrentAuthSession(session)) { setProfile(null); setError(messageFor(reason)); } }
    finally { setBusy(false); }
  }, [client, session]);
  const prefetchCharts = useCallback(async (memberId: string, nextScope: ScoreScope, currentRange: ScoreChartRange) => {
    if (!client || !session) return;
    const missing = (['week', 'month', 'year', 'all'] as ScoreChartRange[]).filter((range) => range !== currentRange && !chartCache.current.has(chartKey(memberId, nextScope, { range })));
    await Promise.all(missing.map(async (range) => {
      try { const value = await client.getProfile(memberId, nextScope, monthNow(), { range }); if (isCurrentAuthSession(session)) rememberChart(memberId, nextScope, { range }, value.chart); }
      catch { /* prefetch is best effort; the tap path still fetches on a miss */ }
    }));
  }, [client, session]);
  const loadProfileChart = useCallback((chartQuery: ScoreChartQuery) => {
    if (!client || !session) return;
    const memberId = activeMember.current;
    const nextScope = activeScope.current;
    if (!memberId || (nextScope === 'me' && memberId !== session.memberId)) return;
    requestGeneration.current += 1;
    const cached = chartCache.current.get(chartKey(memberId, nextScope, chartQuery));
    if (cached) { setProfile((previous) => previous && previous.memberId === memberId ? { ...previous, chart: cached } : previous); return; }
    void loadProfile(memberId, nextScope, chartQuery);
  }, [client, session, loadProfile]);
  useEffect(() => { if (scope === 'me' && client && session && !profile) void loadProfile(session.memberId, 'me'); }, [client, session, scope, profile, loadProfile]);
  const refreshOwnProfile = useCallback(() => { if (!client || !session || !appActive.current) return; requestGeneration.current += 1; activeScope.current = 'me'; activeMember.current = session.memberId; setScope('me'); setSelected(null); setProfile(null); setRedemptions([]); setPendingOperations(null); setRetryAction(null); setSheet(null); void loadProfile(session.memberId, 'me'); }, [client, session, loadProfile]);
  useEffect(() => { if (foregroundRevision > 0) refreshOwnProfile(); }, [foregroundRevision, refreshOwnProfile]);
  const hasFocused = useRef(false);
  useFocusEffect(useCallback(() => { const shouldRefresh = hasFocused.current; hasFocused.current = true; if (shouldRefresh) refreshOwnProfile(); return () => { clearProtectedState(); }; }, [clearProtectedState, refreshOwnProfile]));

  const chooseScope = async (nextScope: ScoreScope) => {
    if (nextScope === scope && !(nextScope !== 'me' && selected)) return;
    let restoredPending: PendingGamificationOperations | null = null;
    if (nextScope === 'all') {
      if (!capabilities?.canViewAllScores) { setError('此功能僅限管理者。'); return; }
      const unlockGeneration = requestGeneration.current; setBusy(true); const unlocked = await guard.current.unlock(); setBusy(false); if (!unlocked || !appActive.current || requestGeneration.current !== unlockGeneration || !session || !isCurrentAuthSession(session)) { guard.current.clear(); if (appActive.current && requestGeneration.current === unlockGeneration) setError('需要完成身分驗證才能查看全體。'); return; }
      try { if (client) restoredPending = await client.getPendingOperations(); } catch (reason) { setPendingOperations(null); setError(messageFor(reason)); }
      if (!appActive.current || requestGeneration.current !== unlockGeneration || !session || !isCurrentAuthSession(session) || guard.current.state !== 'unlocked') { guard.current.clear(); return; }
    } else if (scope === 'all') guard.current.clear();
    requestGeneration.current += 1; activeScope.current = nextScope; activeMember.current = nextScope === 'me' ? session?.memberId ?? null : null; setScope(nextScope); setSheet(null); setSelected(null); setProfile(null);
    setPendingOperations(nextScope === 'all' ? restoredPending : null);
    if (nextScope !== 'me') void loadPeople(nextScope);
    if (nextScope === 'me' && session) void loadProfile(session.memberId, 'me');
  };

  const openProfile = (person: PersonListItem) => { requestGeneration.current += 1; activeMember.current = person.memberId; setSelected(person); setProfile(null); void loadProfile(person.memberId, scope); };
  const loadRewards = async () => { if (!client || !session) return; const generation = requestGeneration.current; const expectedScope = scope; try { const value = await client.getRewards(); if (isLive(generation, expectedScope)) { setRewards(value); setSheet('rewards'); } } catch (reason) { if (isLive(generation, expectedScope)) setError(messageFor(reason)); } };
  const loadRedemptions = async (admin: boolean, memberId?: string) => { if (!client || !session) return; const generation = requestGeneration.current; const expectedScope = scope; const expectedMember = admin ? memberId ?? selected?.memberId ?? null : session.memberId; const memberStillSelected = expectedMember !== null && (expectedMember === session.memberId || activeMember.current === expectedMember); try { const value = admin ? await client.getAdminRedemptions(memberId) : await client.getMyRedemptions(); if (appActive.current && requestGeneration.current === generation && activeScope.current === expectedScope && memberStillSelected && isCurrentAuthSession(session) && (expectedScope !== 'all' || guard.current.state === 'unlocked')) { setRedemptions(value); setRetryAction(null); setSheet('redemptions'); } } catch (reason) { if (appActive.current && requestGeneration.current === generation && activeScope.current === expectedScope && memberStillSelected && isCurrentAuthSession(session)) setError(messageFor(reason)); } };
  const removeSelectedFriend = async () => { if (!client || !selected || scope !== 'friends') return; const generation = requestGeneration.current; const memberId = selected.memberId; try { await client.removeFriend(memberId); if (isLive(generation, 'friends', memberId)) { setSheet(null); setSelected(null); setProfile(null); await loadPeople('friends'); } } catch (reason) { if (isLive(generation, 'friends', memberId)) setError(messageFor(reason)); } };
  const scanClaimed = (memberId: string) => { requestGeneration.current += 1; activeScope.current = 'friends'; activeMember.current = memberId; setSheet(null); setScope('friends'); setSelected({ memberId, displayName: '好友', earnedTotal: 0 }); setProfile(null); void loadProfile(memberId, 'friends'); };
  const selectedRewardId = profile?.private?.targetReward?.rewardId ?? null;
  const setTarget = async (rewardId: string) => { if (!client || !session) return; try { await client.setRewardTarget(rewardId); setSheet(null); await loadProfile(session.memberId, 'me'); } catch (reason) { setError(messageFor(reason)); } };
  // The shelf on the member's own page needs the active catalogue without opening the picker sheet.
  const [shelfRewards, setShelfRewards] = useState<Reward[] | null>(null);
  useEffect(() => {
    if (!client || !session || scope !== 'me' || !profile?.private || shelfRewards !== null || typeof client.getRewards !== 'function') return;
    let active = true;
    void client.getRewards().then((value) => { if (active && isCurrentAuthSession(session)) setShelfRewards(value); }).catch(() => { if (active) setShelfRewards([]); });
    return () => { active = false; };
  }, [client, session, scope, profile?.private, shelfRewards]);
  useEffect(() => { setShelfRewards(null); }, [session?.memberId]);
  const [nominations, setNominations] = useState<NominationBoardView | null>(null);
  useEffect(() => {
    if (!client || !session || scope !== 'me' || nominations !== null || typeof client.getNominations !== 'function') return;
    let active = true;
    void client.getNominations()
      .then((value) => { if (active && isCurrentAuthSession(session)) setNominations(value); })
      .catch(() => { if (active) setNominations({ round: null, nominations: [] }); });
    return () => { active = false; };
  }, [client, session, scope, nominations]);
  useEffect(() => { setNominations(null); }, [session?.memberId]);
  const [community, setCommunity] = useState<CommunityProgressView | null>(null);
  useEffect(() => {
    if (!client || !session || scope !== 'me' || community !== null || typeof client.getCommunityProgress !== 'function') return;
    let active = true;
    void client.getCommunityProgress()
      .then((value) => { if (active && isCurrentAuthSession(session)) setCommunity(value); })
      .catch(() => { if (active) setCommunity({ books: [], personDays: null, currentBook: null }); });
    return () => { active = false; };
  }, [client, session, scope, community]);
  useEffect(() => { setCommunity(null); }, [session?.memberId]);
  // Every mutation just drops the cache; the effect above refetches, so the board always reflects
  // the server rather than a locally guessed vote count.
  const refreshNominations = () => setNominations(null);
  const nominationError = (reason: unknown) => setError(messageFor(reason));
  const openNominationRound = async (days: number) => {
    if (!client) return;
    try {
      await client.openNominationRound({ title: `${Number(monthNow().slice(5))} 月獎品`, closesAt: Date.now() + days * 24 * 60 * 60 * 1000 });
      refreshNominations();
      setSheet(null);
    } catch (reason) { nominationError(reason); }
  };
  const redeemSelected = async (rewardId: string) => { if (!client || !selected) return; const reward = rewards.find((item) => item.rewardId === rewardId); if (!reward) return; const generation = requestGeneration.current; const memberId = selected.memberId; try { await client.redeem({ memberId, rewardId, expectedRewardRevision: reward.revision }); if (!isLive(generation, 'all', memberId, true)) return; setRetryAction(null); setSheet(null); await loadProfile(memberId, 'all'); } catch (reason) { if (isLive(generation, 'all', memberId, true) && reason instanceof GamificationApiError && reason.retryable) { setRetryAction(() => () => { void redeemSelected(rewardId); }); setError('尚未確認，點此重試。'); } else if (isLive(generation, 'all', memberId, true)) setError(messageFor(reason)); } };
  const openRedeem = async () => { if (!client || !session || !selected) return; const generation = requestGeneration.current; const memberId = selected.memberId; try { const value = await client.getRewards(); if (isLive(generation, 'all', memberId, true)) { setRewards(value); setSheet('redeem'); } } catch (reason) { if (isLive(generation, 'all', memberId, true)) setError(messageFor(reason)); } };
  const reverseSelected = async (redemptionId: string, reason: string) => { if (!client || !session) return; const generation = requestGeneration.current; const expectedScope = scope; const memberId = selected?.memberId; try { await client.reverseRedemption(redemptionId, reason); if (!isLive(generation, expectedScope, memberId, expectedScope === 'all')) return; setRetryAction(null); await loadRedemptions(expectedScope === 'all', memberId); if (expectedScope === 'all' && memberId) await loadProfile(memberId, 'all'); else await loadProfile(session.memberId, 'me'); } catch (errorValue) { if (isLive(generation, expectedScope, memberId, expectedScope === 'all') && errorValue instanceof GamificationApiError && errorValue.retryable) { setRetryAction(() => () => { void reverseSelected(redemptionId, reason); }); setError('尚未確認，點此重試。'); } else if (isLive(generation, expectedScope, memberId, expectedScope === 'all')) setError(messageFor(errorValue)); } };
  const refreshPending = async () => { if (!client || !session || scope !== 'all' || guard.current.state !== 'unlocked') return; const generation = requestGeneration.current; try { const value = await client.getPendingOperations(); if (isLive(generation, 'all', undefined, true)) setPendingOperations(value); } catch (reason) { if (isLive(generation, 'all', undefined, true)) setError(messageFor(reason)); } };
  const retrySavedRedemption = async (operationId: string) => { if (!client || scope !== 'all' || guard.current.state !== 'unlocked') return; try { await client.retryPendingRedemption(operationId); await refreshPending(); } catch (reason) { setError(messageFor(reason)); await refreshPending(); } };
  const retrySavedReversal = async (operationId: string) => { if (!client || scope !== 'all' || guard.current.state !== 'unlocked') return; try { await client.retryPendingReversal(operationId); await refreshPending(); } catch (reason) { setError(messageFor(reason)); await refreshPending(); } };

  if (!session) return <View style={styles.screen}><Text style={styles.title}>積分</Text><Text style={styles.note}>請先登入以查看積分。</Text></View>;
  const showingProfile = scope !== 'me' && selected && profile;
  return <View style={styles.screen}>
    <View style={styles.scopeHeader}><View style={styles.scopes}>{(['me', 'friends', ...(capabilities?.canViewAllScores ? ['all'] : [])] as ScoreScope[]).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: scope === item }} accessibilityLabel={item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體（管理）'} onPress={() => void chooseScope(item)} style={[styles.scope, scope === item && styles.scopeActive]}><Text style={[styles.scopeText, scope === item && styles.scopeTextActive]}>{item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體（管理）'}</Text></Pressable>)}</View><Pressable accessibilityRole="button" accessibilityLabel="開啟積分操作" onPress={() => setSheet('menu')} style={styles.menu}><Text style={styles.menuText}>⋯</Text></Pressable></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{busy ? <Text style={styles.note}>載入中…</Text> : null}
    {scope === 'me' && !profile ? <View style={styles.noteBox}><Text style={styles.note}>正在載入你的積分。</Text></View> : null}
    {scope !== 'me' ? <View style={showingProfile ? styles.hiddenList : styles.listSurface}><PeopleList people={people} showRank={scope === 'all'} onSelect={openProfile} /></View> : null}
    {showingProfile ? <><Pressable accessibilityRole="button" accessibilityLabel="返回積分清單" onPress={() => { setProfile(null); setSelected(null); }} style={styles.back}><Text style={styles.backText}>‹ 返回清單</Text></Pressable><ScoreProfile profile={profile} onChartChange={loadProfileChart} onOpenActions={scope === 'all' && capabilities?.canRedeemRewards ? () => { void openRedeem(); } : undefined} /></> : null}
    {scope === 'me' && nominations?.round ? <NominationBanner
      round={nominations.round}
      nowMs={Date.now()}
      mine={nominations.nominations.some((item) => item.mine && item.status === 'OPEN')}
      onOpen={() => setSheet('nominations')}
    /> : null}
    {scope === 'me' && profile ? <ScoreProfile profile={profile} rewards={shelfRewards ?? undefined} community={community ? <CommunityProgress books={community.books} personDays={community.personDays} currentBook={community.currentBook} /> : undefined} onChooseTarget={(rewardId) => { void setTarget(rewardId).then(() => setShelfRewards(null)); }} onChartChange={loadProfileChart} onChooseReward={() => void loadRewards()} /> : null}
    <ActionSheet visible={sheet === 'menu'} title="積分操作" dismissOnOutsideTap onClose={() => setSheet(null)} actions={[{ label: '我的好友 QR', onPress: () => setSheet('qr') }, { label: '掃描好友 QR', onPress: () => setSheet('scan') }, { label: '我的領取紀錄', onPress: () => { void loadRedemptions(false); } }, ...(scope === 'friends' && selected ? [{ label: '移除好友', destructive: true, onPress: () => { void removeSelectedFriend(); } }] : []), ...(scope === 'all' && selected && capabilities?.canRedeemRewards ? [{ label: '查看領取紀錄', onPress: () => { void loadRedemptions(true, selected.memberId); } }] : []), ...(scope === 'all' && capabilities?.canRedeemRewards && pendingOperations && pendingOperations.redemptions.length + pendingOperations.reversals.length > 0 ? [{ label: `尚未確認操作 (${pendingOperations.redemptions.length + pendingOperations.reversals.length})`, onPress: () => setSheet('pending') }] : []), ...(capabilities?.canManageRewards ? [{ label: '管理獎品', onPress: () => { void loadRewards().then(() => setSheet('admin-rewards')); } }] : []), ...(capabilities?.canManageRewards && !nominations?.round ? [{ label: '開一輪獎品提案', onPress: () => setSheet('open-round') }] : []), ...(nominations?.round ? [{ label: '獎品提案', onPress: () => setSheet('nominations') }] : [])]} />
    <ActionSheet visible={sheet === 'nominations'} title={nominations?.round?.title ?? '獎品提案'} onClose={() => setSheet(null)}>
      <NominationBoard
        round={nominations?.round ?? null}
        nominations={nominations?.nominations ?? []}
        canManage={Boolean(capabilities?.canManageRewards)}
        nowMs={Date.now()}
        onNominate={(name, note) => { void client?.nominateReward({ name, ...(note ? { note } : {}) }).then(refreshNominations).catch(nominationError); }}
        onVote={(nominationId, voting) => { void client?.setNominationVote(nominationId, voting).then(refreshNominations).catch(nominationError); }}
        onWithdraw={(nominationId) => { void client?.withdrawNomination(nominationId).then(refreshNominations).catch(nominationError); }}
        onResolveSuggestion={(nominationId, accept) => { void client?.resolveNoteSuggestion(nominationId, accept).then(refreshNominations).catch(nominationError); }}
        onDecide={(nominationId, decision, revision, costPoints) => { void client?.decideNomination(nominationId, decision, { expectedRevision: revision, ...(costPoints ? { costPoints } : {}) }).then(() => { refreshNominations(); setShelfRewards(null); }).catch(nominationError); }}
        onCloseRound={(roundId) => { void client?.closeNominationRound(roundId).then(() => { refreshNominations(); setSheet(null); }).catch(nominationError); }}
      />
    </ActionSheet>
    <ActionSheet visible={sheet === 'open-round'} title="開一輪獎品提案" dismissOnOutsideTap onClose={() => setSheet(null)}
      actions={[7, 14, 30].map((days) => ({ label: `${days} 天後截止`, onPress: () => { void openNominationRound(days); } }))} />
    <ActionSheet visible={sheet === 'qr'} title="我的好友 QR" dismissOnOutsideTap onClose={() => setSheet(null)}><FriendQrPanel client={client!} mode="show" /></ActionSheet>
    <ActionSheet visible={sheet === 'scan'} title="掃描好友 QR" onClose={() => setSheet(null)}><FriendQrPanel client={client!} mode="scan" onClaimed={scanClaimed} /></ActionSheet>
    <ActionSheet visible={sheet === 'rewards'} title="選擇目標獎品" dismissOnOutsideTap onClose={() => setSheet(null)}><RewardControls rewards={rewards} selectedRewardId={selectedRewardId} canEdit onSelect={(rewardId) => void setTarget(rewardId)} /></ActionSheet>
    <ActionSheet visible={sheet === 'admin-rewards'} title="管理獎品" onClose={() => setSheet(null)}><RewardControls rewards={rewards} selectedRewardId={null} canEdit admin onCreate={async (name, costPoints) => { try { if (client) { await client.createReward({ name, costPoints }); setRewards(await client.getRewards()); } } catch (reason) { setError(messageFor(reason)); } }} onUpdate={async (rewardId, patch) => { try { if (client) { const reward = rewards.find((item) => item.rewardId === rewardId); if (reward) await client.updateReward(rewardId, patch, reward.revision); setRewards(await client.getRewards()); } } catch (reason) { setError(messageFor(reason)); } }} onArchive={async (rewardId) => { try { if (client) { const reward = rewards.find((item) => item.rewardId === rewardId); if (reward) await client.updateReward(rewardId, { active: false }, reward.revision); setRewards(await client.getRewards()); } } catch (reason) { setError(messageFor(reason)); } }} /></ActionSheet>
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
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }, title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' }, scopeHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.md }, menu: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' }, menuText: { color: theme.colors.ink, fontSize: 26 }, scopes: { flex: 1, flexDirection: 'row', gap: theme.spacing.xs }, scope: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }, scopeActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, scopeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, scopeTextActive: { color: theme.colors.white }, note: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line }, noteBox: { padding: theme.spacing.lg, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface }, listSurface: { flex: 1 }, hiddenList: { display: 'none' }, error: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, marginBottom: theme.spacing.sm }, retry: { minHeight: theme.control.tap, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft }, retryText: { color: theme.colors.accent, fontSize: theme.type.label.size, fontWeight: '800' }, back: { minHeight: theme.control.tap, justifyContent: 'center' }, backText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' } });
