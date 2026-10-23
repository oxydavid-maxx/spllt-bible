import { AppState, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { runtimeConfig } from '../../src/config/runtime';
import { getAuthSnapshot, isCurrentAuthSession, registerAuthLifecycleListener, useAuthSnapshot } from '../../src/services/authSession';
import { createGamificationApiClient, GamificationApiError, type PersonListItem, type Reward, type ScoreChartQuery, type ScoreChartRange, type ScoreProfile as ScoreProfileData, type ScoreScope, type ViewerCapabilities } from '../../src/services/gamificationApiClient';
import { createAdminUnlockGuard, createNativeAdminAuthenticator } from '../../src/services/adminUnlockGuard';
import { createProfileCache } from '../../src/services/profileCache';
import * as SecureStore from 'expo-secure-store';
import { ActionSheet } from '../../src/ui/gamification/ActionSheet';
import { FriendQrPanel } from '../../src/ui/gamification/FriendQrPanel';
import { PeopleList } from '../../src/ui/gamification/PeopleList';
import { RedemptionList } from '../../src/ui/gamification/RedemptionList';
import { GroupSection } from '../../src/ui/gamification/GroupSection';
import { ScoreHistoryCard } from '../../src/ui/gamification/ScoreHistoryCard';
import { DevotionTodayButton } from '../../src/ui/gamification/DevotionTodayButton';
import { createDevotionClient, type Congregation, type ScoreHistory } from '../../src/services/devotionClient';
import { consumeOpenAllScores, subscribeOpenAllScores } from '../../src/services/allScoresRequest';
import { ScoreProfile } from '../../src/ui/gamification/ScoreProfile';
import { RewardPicker } from '../../src/ui/gamification/RewardPicker';
import { useCongregation } from '../../src/ui/congregation/congregationStore';
import { theme } from '../../src/ui/Theme';
import { createApiClient } from '../../src/services/apiClient';
import { readReadingDays } from '../../src/services/readingDaysRead';
import { readViewerCapabilities } from '../../src/services/viewerCapabilities';
import { useCompletionController } from '../../src/services/useCompletionController';
import type { CompletionAwardEvent, CompletionSyncEvent } from '../../src/services/completionController';
import { applyCompletionSyncToProfile } from '../../src/ui/completionProfileSync';
import { CompletionTodayButton } from '../../src/ui/CompletionTodayButton';
import { CompletionAwardFeedback } from '../../src/ui/CompletionAwardFeedback';
import { getReadingPlan, replaceReadingDaysRange, getReadingPlanId, getReadingPlanSpan, getScheduledReading, setSelectedReadingDate } from '../../src/ui/readingSession';
import { ReadingPlanSheet } from '../../src/ui/ReadingPlanSheet';
import { isWithinCompletionWindow, taipeiDate } from '../../src/domain/gamificationV1';
import type { CompletionRecord } from '../../src/domain/completion';
import { ReadingCalendarCard } from '../../src/ui/gamification/ReadingCalendarCard';
import { SelectedDayCard } from '../../src/ui/gamification/SelectedDayCard';
import { ReadingCardExportSheet } from '../../src/ui/gamification/ReadingCardExportSheet';
import { buildReadingCardHtml, readingCardFileName, type ReadingCardScope } from '../../src/domain/readingCard';
import { loadReadingCardSnapshot } from '../../src/services/readingCardSnapshot';
import { shareReadingCard } from '../../src/ui/readingCardShare';
import { dayState, defaultSelectedDate, monthCells, readingDaysRange, shiftMonth, type CalendarDay } from '../../src/ui/gamification/readingCalendarModel';
import { consumeOpenFriendsList, subscribeFriendAdded, subscribeOpenFriendsList, type FriendAddedEvent } from '../../src/services/friendPush';
import { switchStarted, useSwitchShown } from '../../src/services/switchLatencyProbe';
import { afterNextFrame, ASK_AGAIN, devotionDatesKey, invalidateReadingDaysInViewCache, markDevotionInViewCache, useViewCache, viewCache, viewCacheKey, type ViewCacheRequest } from '../../src/services/viewCache';
import type { ReadingDaySnapshot } from '../../src/services/apiClient';

// Prizes and redemptions are kept in the Google Sheet (維護者 2026-10-17): no 管理獎品 or 現場兌換 here.
type Sheet = 'menu' | 'qr' | 'scan' | 'rewards' | 'redemptions' | null;

export default function ProgressScreen() {
  const congregation = useCongregation();
  // Where the member counts (青少/主堂). The 團體 card and the prize picker can look at the other side; each
  // opening starts on this one (維護者 2026-10-20). Null while unknown: the first-run choice is then on screen.
  const ownSide = congregation.value;
  // Each opening of 團體 starts on the member's own side: a new number here (src/ui/gamification/GroupSection.tsx).
  const [groupReset, setGroupReset] = useState(0);
  const [rewardSide, setRewardSide] = useState<Congregation | null>(null);
  const [rewardRetry, setRewardRetry] = useState(0);
  // When this visit began (focus or return to the app). Switches use what was asked since then without asking
  // again; anything older is shown and asked afresh (src/services/viewCache.ts, 光佑 2026-10-23).
  const [visitStartedAt, setVisitStartedAt] = useState(() => viewCache.beginVisit());
  const visitStartedRef = useRef(visitStartedAt);
  const [planOpen, setPlanOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportRequest = useRef<object | null>(null);
  const closeExport = () => { exportRequest.current = null; setExportOpen(false); setExportBusy(false); };
  useEffect(() => () => { exportRequest.current = null; }, []);
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const client = useMemo(() => session ? createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [session?.memberId, session?.sessionToken]);
  const completionClient = useMemo(() => session ? createApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [session?.memberId, session?.sessionToken]);
  const devotionClient = useMemo(() => session ? createDevotionClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [session?.memberId, session?.sessionToken]);
  const today = taipeiDate();
  // The own page's reading calendar. Its days come from the account's reading-days schedule, one
  // month at a time, never from the trend chart's range; the reading tab's local plan stands in
  // until the schedule answers or when it cannot be reached.
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7));
  const [schedule, setSchedule] = useState<{ days: Map<string, CalendarDay>; ranges: Array<{ from: string; to: string }> }>(() => ({ days: new Map(), ranges: [] }));
  // Completion sync events by day: a backfill confirmed while the page is open is painted at once.
  const [confirmedDays, setConfirmedDays] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState(today);
  // Once the member picks a day (or acts on one) the page stops choosing for them until next focus.
  const pickedDate = useRef(false);
  // The own page's scroller: a day tapped in the calendar brings the top, where its buttons are, back into view.
  const pageScroll = useRef<ScrollView>(null);
  // Past Taipei midnight a day the member did not pick moves to the new today at once, so the day card
  // at the top never offers yesterday as 補登 while the schedule is still on its way (or unreachable).
  const shownToday = useRef(today);
  useEffect(() => {
    const previous = shownToday.current;
    if (previous === today) return;
    shownToday.current = today;
    if (pickedDate.current) return;
    setSelectedDate(today);
    setCalendarMonth((month) => month === previous.slice(0, 7) ? today.slice(0, 7) : month);
  }, [today]);
  const [completionAward, setCompletionAward] = useState<CompletionAwardEvent | null>(null);
  const awardRefreshRef = useRef<(memberId: string) => void>(() => undefined);
  const [capabilities, setCapabilities] = useState<ViewerCapabilities | null>(null);
  const [scope, setScope] = useState<ScoreScope>('me');
  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [selected, setSelected] = useState<PersonListItem | null>(null);
  const [profile, setProfile] = useState<Awaited<ReturnType<NonNullable<typeof client>['getProfile']>> | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [redemptions, setRedemptions] = useState<Awaited<ReturnType<NonNullable<typeof client>['getMyRedemptions']>>>([]);
  const [sheet, updateSheet] = useState<Sheet>(null);
  const sheetVersion = useRef(0);
  const activeSheet = useRef<Sheet>(null);
  const setSheet = useCallback((next: Sheet) => { activeSheet.current = next; sheetVersion.current += 1; updateSheet(next); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [primaryReady, setPrimaryReady] = useState(false);
  const [appForeground, setAppForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
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
  const profileRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshOnForeground = useRef<(preserveScanner?: boolean) => void>(() => undefined);
  const scannerActivityRequest = useRef<object | null>(null);
  const resumeScannerAfterActivity = useRef(false);
  const chartCache = useRef(new Map<string, NonNullable<ScoreProfileData['chart']>>());
  // 全體 (管理): everyone's points, asked right after the device unlock so a tap on a name opens at once (光佑
  // 2026-10-23). Held only while unlocked: leaving 全體, the background or another account empties it with the unlock.
  const allProfiles = useRef(new Map<string, ScoreProfileData>());
  const chartKey = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery) => JSON.stringify([memberId, nextScope, query.range, query.anchor ?? '']);
  const rememberChart = (memberId: string, nextScope: ScoreScope, query: ScoreChartQuery | undefined, chart: ScoreProfileData['chart']) => {
    if (!chart) return;
    chartCache.current.set(chartKey(memberId, nextScope, query ?? { range: chart.range }), chart);
    if (chart.anchor !== null) chartCache.current.set(chartKey(memberId, nextScope, { range: chart.range, anchor: chart.anchor }), chart);
  };
  const accountKey = session ? JSON.stringify([session.memberId, session.sessionToken]) : null;
  const [secondaryRefresh, setSecondaryRefresh] = useState(0);
  // What each calendar range last put on screen. The same answer again (a month switched back to, a visit that found
  // nothing new) changes nothing: no re-render, and the reading tab's plan is left alone (2026-10-23).
  const appliedReadingDays = useRef(new Map<string, ReadingDaysAnswer>());
  const appliedDevotionDates = useRef(new Map<string, readonly string[]>());
  useEffect(() => {
    let active = true;
    const expectedAuthEpoch = auth.epoch;
    if (!completionClient || !session || !focused || !appForeground) return () => { active = false; };
    const live = () => isCurrentAuthSession(session) && getAuthSnapshot().epoch === expectedAuthEpoch;
    const range = readingDaysRange(calendarMonth, today);
    const readingDays = (from: string, to: string) => ({ key: viewCacheKey(session, 'reading-days', from, to), load: async () => {
      const value = await readReadingDays(session, from, to, () => completionClient.getReadingDays(from, to));
      if (!value) throw new Error('READING_DAYS_UNAVAILABLE');
      return value;
    } });
    const apply = (applied: { from: string; to: string }, response: ReadingDaysAnswer) => {
      const rangeKey = `${applied.from}:${applied.to}`;
      if (appliedReadingDays.current.get(rangeKey) === response) return;
      appliedReadingDays.current.set(rangeKey, response);
      replaceReadingDaysRange(applied.from, applied.to, response.days);
      completion.reconcileRemoteDays?.(response.days);
      setConfirmedDays(current => Object.fromEntries(Object.entries(current).filter(([date]) => date < applied.from || date > applied.to)));
      const fetched = calendarDaysOf(response);
      setSchedule((current) => {
        const days = new Map([...current.days].filter(([date]) => date < applied.from || date > applied.to));
        for (const [date, day] of fetched) days.set(date, day);
        return { days, ranges: [...current.ranges.filter((item) => item.from !== applied.from || item.to !== applied.to), applied] };
      });
    };
    // The months either side are asked ahead, after the frame that shows this one, and taken in as they come:
    // 上個月/下個月 then shows them from the store in its own render with nothing left to apply (2026-10-23).
    const ahead = afterNextFrame(() => {
      for (const month of adjacentCalendarMonths(calendarMonth, today)) {
        const aheadRange = readingDaysRange(month, today); const request = readingDays(aheadRange.from, aheadRange.to);
        void viewCache.read(request.key, request.load, visitStartedAt).then((response) => { if (live()) apply(aheadRange, response); }).catch(() => undefined);
      }
    });
    const request = readingDays(range.from, range.to);
    void viewCache.read(request.key, request.load, visitStartedAt).then((response) => {
      if (!active || !response || !live()) return;
      apply(range, response);
      if (!pickedDate.current && calendarMonth === today.slice(0, 7)) setSelectedDate(defaultSelectedDate(today, calendarDaysOf(response)));
    }).catch(() => undefined);
    return () => { active = false; ahead.cancel(); };
  }, [completionClient, session?.memberId, session?.sessionToken, calendarMonth, today, auth.epoch, secondaryRefresh, focused, appForeground, visitStartedAt]);
  const loadedDevotionRanges = useRef<Array<{ from: string; to: string }>>([]);
  useEffect(() => {
    let active = true;
    setSchedule({ days: new Map(), ranges: [] }); setConfirmedDays({});
    setDevotionDates(new Set()); loadedDevotionRanges.current = [];
    appliedReadingDays.current.clear(); appliedDevotionDates.current.clear();
    if (session) void import('../../src/services/readingProgressCache').then(async ({ readingProgressCache }) => {
      const cached = await readingProgressCache.read(session.memberId);
      if (!active || !isCurrentAuthSession(session) || getAuthSnapshot().epoch !== auth.epoch) return;
      setSchedule(current => {
        const days = new Map<string, CalendarDay>(Object.values(cached.days)
          .filter(day => !current.ranges.some(range => day.taskDate >= range.from && day.taskDate <= range.to))
          .map(day => [day.taskDate, { planId: day.planId, references: day.references, completed: day.status === 'COMPLETED', revision: day.revision, canComplete: isWithinCompletionWindow(day.taskDate, today) }]));
        for (const [date, day] of current.days) days.set(date, day);
        return { days, ranges: [...(cached.ranges ?? []), ...current.ranges] };
      });
      setDevotionDates(current => new Set([...cached.devotionDates.filter(date => !loadedDevotionRanges.current.some(range => date >= range.from && date <= range.to)), ...current]));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [accountKey, auth.epoch]);
  // 靈修 days for the same range as the reading days. Kept apart from completions: they earn nothing.
  const [devotionDates, setDevotionDates] = useState<ReadonlySet<string>>(() => new Set());
  const [devotionPending, setDevotionPending] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const expectedAuthEpoch = auth.epoch;
    if (!devotionClient || !session || !focused || !appForeground) return () => { active = false; };
    const live = () => isCurrentAuthSession(session) && getAuthSnapshot().epoch === expectedAuthEpoch;
    const range = readingDaysRange(calendarMonth, today);
    const devotionDatesRequest = (from: string, to: string) => ({ key: devotionDatesKey(session, from, to), load: () => devotionClient.getDevotionDates(from, to) });
    const apply = (applied: { from: string; to: string }, dates: readonly string[]) => {
      const rangeKey = `${applied.from}:${applied.to}`;
      if (appliedDevotionDates.current.get(rangeKey) === dates) return;
      appliedDevotionDates.current.set(rangeKey, dates);
      loadedDevotionRanges.current.push(applied);
      setDevotionDates((current) => new Set([...[...current].filter((date) => date < applied.from || date > applied.to), ...dates]));
    };
    const ahead = afterNextFrame(() => {
      for (const month of adjacentCalendarMonths(calendarMonth, today)) {
        const aheadRange = readingDaysRange(month, today); const request = devotionDatesRequest(aheadRange.from, aheadRange.to);
        void viewCache.read(request.key, request.load, visitStartedAt).then((dates) => { if (live()) apply(aheadRange, dates); }).catch(() => undefined);
      }
    });
    const request = devotionDatesRequest(range.from, range.to);
    void viewCache.read(request.key, request.load, visitStartedAt).then((dates) => { if (active && live()) apply(range, dates); }).catch(() => undefined);
    return () => { active = false; ahead.cancel(); };
  }, [devotionClient, session?.memberId, session?.sessionToken, calendarMonth, today, auth.epoch, secondaryRefresh, focused, appForeground, visitStartedAt]);
  const isLive = useCallback((generation: number, expectedScope: ScoreScope, expectedMember?: string | null, requiresUnlock = false) => Boolean(focusedRef.current && appActive.current && requestGeneration.current === generation && activeScope.current === expectedScope && (expectedMember === undefined || expectedMember === activeMember.current) && session && isCurrentAuthSession(session) && (!requiresUnlock || guard.current.state === 'unlocked')), [session]);
  // Account-wide secondary content is independent of the selected chart range/member.
  const isViewLive = useCallback((generation: number) => Boolean(focusedRef.current && appActive.current && viewGeneration.current === generation && session && isCurrentAuthSession(session)), [session]);
  // Also drops a scheduled profile retry: every caller is replacing the view that retry belonged to.
  const stopPrefetch = useCallback(() => {
    if (prefetchTimer.current !== null) clearTimeout(prefetchTimer.current); prefetchTimer.current = null;
    if (profileRetryTimer.current !== null) clearTimeout(profileRetryTimer.current); profileRetryTimer.current = null;
  }, []);
  const clearProtectedState = useCallback((preserveScanner = false, preserveOwnProfile = false, preserveOwnView = false) => {
    setPlanOpen(false);
    exportRequest.current = null; setExportOpen(false); setExportBusy(false); setExportError(null);
    requestGeneration.current += 1; viewGeneration.current += 1; profileRequest.current += 1;
    stopPrefetch(); client?.cancelReads?.();
    const currentProfile = profileRef.current;
    const ownProfile = preserveOwnProfile && session && isCurrentAuthSession(session) && currentProfile?.memberId === session.memberId && currentProfile.private ? currentProfile : null;
    const preserveView = Boolean(preserveOwnView && ownProfile && activeScope.current === 'me' && activeMember.current === session?.memberId);
    activeScope.current = 'me'; activeMember.current = preserveView ? session?.memberId ?? null : null; guard.current.clear(); chartCache.current.clear(); allProfiles.current.clear();
    setScope('me'); setPeople([]); setSelected(null); setProfile(ownProfile); setBusy(false); setError(null);
    setSheet(preserveScanner ? 'scan' : null);
    if (!preserveView) {
      setProfileStale(Boolean(ownProfile)); setRedemptions([]); setPrimaryReady(Boolean(ownProfile));
      setScoreHistory(null);
    }
    if (!preserveScanner) { scannerActivityRequest.current = null; resumeScannerAfterActivity.current = false; }
  }, [client, session, stopPrefetch]);
  useEffect(() => registerAuthLifecycleListener((change) => { if (!change.current || change.current.memberId !== session?.memberId || change.current.sessionToken !== session?.sessionToken) clearProtectedState(); }), [accountKey, clearProtectedState]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = appActive.current;
      appActive.current = next === 'active';
      setAppForeground(appActive.current);
      if (next !== 'active') {
        // Hide the screen while inactive. Preserve only a same-member own view for a smooth
        // foreground refresh; friends/admin data still clears, and auth changes always clear it.
        const preserveScanner = wasActive && focusedRef.current && activeSheet.current === 'scan' && scannerActivityRequest.current !== null;
        resumeScannerAfterActivity.current = preserveScanner;
        clearProtectedState(preserveScanner, true, true);
      } else if (!wasActive && focusedRef.current) {
        const preserveScanner = resumeScannerAfterActivity.current && activeSheet.current === 'scan';
        resumeScannerAfterActivity.current = false;
        refreshOnForeground.current(preserveScanner);
        openRequestedFriends.current();
        openRequestedAll.current();
      }
    });
    return () => subscription.remove();
  }, [clearProtectedState]);
  useEffect(() => {
    setCapabilities(null); setError(null); setCompletionAward(null);
    setSchedule({ days: new Map(), ranges: [] }); setConfirmedDays({}); pickedDate.current = false;
    setDevotionDates(new Set()); setDevotionPending(null);
  }, [accountKey]);

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
  const loadProfile = useCallback(async (memberId: string, nextScope: ScoreScope, chartQuery?: ScoreChartQuery, attempt = 0, shown?: ScoreProfileData): Promise<void> => {
    if (!client || !session || !isLive(requestGeneration.current, nextScope, memberId, nextScope === 'all')) return;
    const generation = requestGeneration.current;
    const requestId = ++profileRequest.current;
    const owns = () => requestId === profileRequest.current && isLive(generation, nextScope, memberId, nextScope === 'all');
    const currentProfile = profileRef.current;
    // `shown`: a profile already on screen for this person (全體's, asked after the unlock) stays while it is asked again.
    const keepVisibleProfile = shown?.memberId === memberId || (nextScope === 'me' && memberId === session.memberId && currentProfile?.memberId === memberId && Boolean(currentProfile.private));
    stopPrefetch(); setBusy(!keepVisibleProfile); setError(null);
    let remoteSettled = false;
    let retrying = false;
    let remembered: ScoreProfileData | null = null;
    // Storage and network start together. A late cache must never replace a fresh response.
    const cached = !chartQuery && nextScope === 'me' && memberId === session.memberId
      ? profileCache.load(memberId).then((value) => {
        remembered = value;
        if (value && !remoteSettled && owns() && !keepVisibleProfile) { setProfile(value); setProfileStale(true); }
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
      if (remembered) { if (!keepVisibleProfile) setProfile(remembered); setProfileStale(true); }
      // A read that timed out or never got an answer is asked again while this view is still on screen
      // (00-smoke, 39182073666: a fresh install's first answer took 11.7 s against the 8 s deadline, and
      // the page kept its error until the member left the tab). Each try keeps the full 8 s deadline.
      // Until the last try settles, a page with nothing to show stays on 載入中… (saved points stay up
      // instead), no error is shown, and the secondary reads keep waiting.
      const retryDelay = PROFILE_RETRY_DELAYS_MS[attempt];
      if (retryDelay !== undefined && isRetryableRead(reason)) {
        retrying = true;
        if (remembered || keepVisibleProfile) setBusy(false);
        profileRetryTimer.current = setTimeout(() => {
          profileRetryTimer.current = null;
          if (owns()) void loadProfile(memberId, nextScope, chartQuery, attempt + 1);
        }, retryDelay);
        return;
      }
      if (!remembered) { if (keepVisibleProfile) setProfileStale(true); setError(messageFor(reason)); }
    } finally {
      if (owns() && !retrying) { setBusy(false); setPrimaryReady(true); }
    }
  }, [client, session, isLive, profileCache, prefetchCharts, stopPrefetch]);
  const friendsRequest = useCallback((): ViewCacheRequest<PersonListItem[]> | null => client && session && typeof client.getPeople === 'function' ? { key: viewCacheKey(session, 'people', 'friends'), load: () => client.getPeople('friends') } : null, [client, session]);
  const loadPeople = useCallback(async (nextScope: Exclude<ScoreScope, 'me'>, fresh = false) => {
    if (!client || !session || !isLive(requestGeneration.current, nextScope, undefined, nextScope === 'all')) return;
    const generation = requestGeneration.current;
    const owns = () => isLive(generation, nextScope, undefined, nextScope === 'all');
    // 好友 opens on the list asked ahead when the page opened; 全體 (管理) still asks after its unlock.
    const request = nextScope === 'friends' ? friendsRequest() : null;
    const kept = request && !fresh ? viewCache.peek<PersonListItem[]>(request.key) : undefined;
    if (kept) setPeople(kept);
    setBusy(!kept); setError(null);
    try {
      const value = request ? await viewCache.read(request.key, request.load, fresh ? ASK_AGAIN : visitStartedRef.current) : await client.getPeople(nextScope);
      if (owns()) {
        setPeople(value); if (!kept) { setSelected(null); setProfile(null); }
        if (nextScope === 'all') prefetchAllProfiles(value, generation);
      }
    }
    catch (reason) { if (owns() && !kept) setError(messageFor(reason)); }
    finally { if (owns()) setBusy(false); }
  }, [client, session, isLive, friendsRequest]);
  // The friends list re-read in place: no spinner, and an open friend profile stays open. Used when a
  // push says somebody added you, when the QR sheet closes, and after this phone's own scan.
  const refreshFriends = useCallback(async () => {
    if (!client || !session || typeof client.getPeople !== 'function') return;
    const generation = viewGeneration.current;
    const request = friendsRequest();
    try {
      const value = request ? await viewCache.read(request.key, request.load, ASK_AGAIN) : await client.getPeople('friends');
      if (!isViewLive(generation) || activeScope.current !== 'friends') return;
      setPeople(value);
    } catch { /* The next focus reloads the list. */ }
  }, [client, session, isViewLive, friendsRequest]);
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
    setSecondaryRefresh((current) => current + 1);
    const visit = viewCache.beginVisit(); visitStartedRef.current = visit; setVisitStartedAt(visit);
    clearProtectedState(preserveScanner, true, true); activeMember.current = session.memberId;
    void loadProfile(session.memberId, 'me');
  }, [client, session, clearProtectedState, loadProfile]);
  refreshOnForeground.current = refreshOwnProfile;
  useFocusEffect(useCallback(() => {
    // Each visit starts on this month and lets the page choose the day again, with 團體 on the member's own side.
    pickedDate.current = false; setCalendarMonth(taipeiDate().slice(0, 7)); setGroupReset((value) => value + 1);
    focusedRef.current = true; setFocused(true); refreshOwnProfile(); openRequestedFriends.current(); openRequestedAll.current();
    return () => { focusedRef.current = false; setFocused(false); clearProtectedState(false, true, true); };
  }, [clearProtectedState, refreshOwnProfile]));
  // Everything secondary waits for the one critical own-profile request to settle.
  useEffect(() => {
    if (!client || !session || !focused || !primaryReady) return;
    let active = true; const generation = viewGeneration.current;
    void readViewerCapabilities(JSON.stringify([session.memberId, session.sessionToken, auth.epoch]), () => client.getCapabilities(), secondaryRefresh).then((value) => { if (active && isViewLive(generation)) setCapabilities(value); }).catch((reason) => { if (active && isViewLive(generation)) setError(messageFor(reason)); });
    return () => { active = false; };
  }, [client, session, focused, primaryReady, secondaryRefresh, isViewLive]);

  const chooseScope = async (nextScope: ScoreScope) => {
    if (!client || !session || !focusedRef.current || !appActive.current || (nextScope === scope && !(nextScope !== 'me' && selected))) return;
    switchStarted('scope', nextScope, 'scope');
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
      } catch (reason) { if (owns()) setError(messageFor(reason)); else return; }
      finally { if (owns()) setBusy(false); }
      if (!owns() || attempt.state !== 'unlocked') return;
    } else if (scope === 'all') { guard.current.clear(); allProfiles.current.clear(); }
    requestGeneration.current += 1; stopPrefetch();
    activeScope.current = nextScope; activeMember.current = nextScope === 'me' ? session.memberId : null;
    setScope(nextScope); setSheet(null); setSelected(null); setProfile(null); setProfileStale(false);
    if (nextScope !== 'me') void loadPeople(nextScope);
    else void loadProfile(session.memberId, 'me');
  };
  // After the unlock and the list: each person's points, one at a time after the frame, while 全體 stays unlocked.
  const prefetchAllProfiles = (people: PersonListItem[], generation: number) => {
    if (!client) return;
    const owns = () => isLive(generation, 'all', undefined, true);
    afterNextFrame(() => {
      void (async () => {
        for (const person of people.slice(0, ALL_PROFILES_AHEAD)) {
          if (!owns()) return;
          if (allProfiles.current.has(person.memberId)) continue;
          try { const value = await client.getProfile(person.memberId, 'all', monthNow()); if (owns()) allProfiles.current.set(person.memberId, value); }
          catch { if (!owns()) return; }
        }
      })();
    });
  };
  const openProfile = (person: PersonListItem) => {
    if (!isLive(requestGeneration.current, scope, undefined, scope === 'all')) return;
    requestGeneration.current += 1; stopPrefetch(); activeMember.current = person.memberId;
    const kept = scope === 'all' ? allProfiles.current.get(person.memberId) : undefined;
    setSelected(person); setProfile(kept ?? null); void loadProfile(person.memberId, scope, undefined, 0, kept);
  };
  const loadRewards = async () => {
    if (!client || !session) return;
    const generation = requestGeneration.current; const expectedScope = activeScope.current;
    if (!isLive(generation, expectedScope, undefined, expectedScope === 'all')) return;
    // Open with the last known list; slow/offline refreshes must not hide the picker. Always on the member's own side.
    setRewardSide(null);
    setSheet('rewards');
    // Every opening asks afresh (a newer ask replaces one still on its way); the list on screen changes only if it differs.
    // The client shares a read already on its way to the same path, so that one is dropped first (the other side's
    // list has its own path and stays).
    client.cancelReads?.('/api/rewards');
    const request = rewardsRequest(null);
    if (request) await viewCache.read(request.key, request.load, ASK_AGAIN).catch(() => undefined);
  };
  const pickerOwn: Congregation = ownSide ?? 'youth';
  // 「主堂獎品｜青少獎品」: the other side's list is read when asked for and shown without any way to pick from it.
  // Asked ahead when the page opens (see the shelf below), so the first tap shows it at once.
  const viewRewards = (side: Congregation) => {
    switchStarted('rewards', side, 'reward-side');
    if (side === pickerOwn) { setRewardSide(null); return; }
    setRewardSide(side); setRewardRetry((value) => value + 1);
  };
  const loadRedemptions = async () => {
    if (!client || !session) return;
    const generation = requestGeneration.current; const expectedScope = activeScope.current;
    const origin = sheetVersion.current;
    const owns = () => sheetVersion.current === origin && isLive(generation, expectedScope, undefined, expectedScope === 'all');
    if (!owns()) return;
    // Asked ahead when the page opened: the sheet opens on that list at once and takes a newer one if it differs.
    const request = redemptionsRequest();
    const kept = request ? viewCache.peek<typeof redemptions>(request.key) : undefined;
    if (kept) { setRedemptions(kept); setSheet('redemptions'); }
    const shown = sheetVersion.current;
    try {
      const value = request ? await viewCache.read(request.key, request.load, visitStartedRef.current) : await client.getMyRedemptions();
      if (!kept && owns()) { setRedemptions(value); setSheet('redemptions'); }
      else if (kept && sheetVersion.current === shown && activeSheet.current === 'redemptions' && isLive(generation, expectedScope, undefined, expectedScope === 'all')) setRedemptions(value);
    }
    catch (reason) { if (!kept && owns()) setError(messageFor(reason)); }
  };
  const removeSelectedFriend = async () => {
    if (!client || !selected || scope !== 'friends') return;
    const generation = requestGeneration.current; const memberId = selected.memberId;
    const owns = () => isLive(generation, 'friends', memberId);
    try { await client.removeFriend(memberId); if (!owns()) return; setSheet(null); setSelected(null); setProfile(null); activeMember.current = null; await loadPeople('friends', true); }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const scannerViewGeneration = viewGeneration.current;
  const scannerSheetVersion = sheetVersion.current;
  const scanClaimed = (memberId: string) => {
    // Captured by the scanner that initiated the claim, not re-read when its response arrives.
    if (activeSheet.current !== 'scan' || sheetVersion.current !== scannerSheetVersion || !isViewLive(scannerViewGeneration)) return;
    requestGeneration.current += 1; stopPrefetch(); activeScope.current = 'friends'; activeMember.current = memberId;
    setSheet(null); setScope('friends'); setSelected({ memberId, displayName: '好友', earnedTotal: 0 }); setProfile(null); void loadProfile(memberId, 'friends');
    // The list behind "返回清單" was never loaded on this path; read it now so the new friend is there.
    void refreshFriends();
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
    try { await client.setRewardTarget(rewardId); if (!owns()) return; if (sheetVersion.current === origin) setSheet(null); await loadProfile(session.memberId, 'me'); }
    catch (reason) { if (owns()) setError(messageFor(reason)); }
  };
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory | null>(null);
  const [scoreHistoryMissing, setScoreHistoryMissing] = useState(false);
  // A 靈修 tap redraws only the chart's gold line: it is not in the group's numbers or the points.
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const hasOwnPrivateProfile = Boolean(session && profile?.memberId === session.memberId && profile.private);
  // Everything a tap on this page can reach is read through the shared store (src/services/viewCache.ts, 光佑
  // 2026-10-23): the shown content comes straight from it in the tap's own render, and the page asks ahead for the
  // other side, the months either side, 好友 and 我的領取紀錄 as soon as the member's own points have settled.
  // 團體 is its own component (GroupSection), so its switches redraw that card only.
  const otherSide = (side: Congregation): Congregation => side === 'main' ? 'youth' : 'main';
  const rewardsRequest = (side: Congregation | null): ViewCacheRequest<Reward[]> | null => client && session && typeof client.getRewards === 'function'
    ? { key: viewCacheKey(session, 'rewards', side ?? `own:${ownSide ?? ''}`), load: () => side ? client.getRewards(side) : client.getRewards() } : null;
  const redemptionsRequest = (): ViewCacheRequest<typeof redemptions> | null => client && session && typeof client.getMyRedemptions === 'function'
    ? { key: viewCacheKey(session, 'redemptions'), load: () => client.getMyRedemptions() } : null;
  const ownView = Boolean(session && focused && primaryReady && scope === 'me');
  const shelf = useViewCache(rewardsRequest(null), {
    active: ownView && hasOwnPrivateProfile,
    freshSince: visitStartedAt,
    ahead: [rewardsRequest(otherSide(ownSide ?? 'youth')), redemptionsRequest(), friendsRequest()].filter((item): item is ViewCacheRequest<any> => item !== null),
  });
  // A list that never came shows as empty, as before; a kept one stays when a later ask fails (no network).
  const shelfRewards = shelf.value ?? (shelf.failed ? [] : null);
  const rewards = shelf.value ?? null;
  const viewedRewards = useViewCache(rewardSide ? rewardsRequest(rewardSide) : null, { active: Boolean(session && focused && rewardSide), freshSince: visitStartedAt, retry: rewardRetry });
  const otherRewards = viewedRewards.value ?? null;
  const otherRewardsFailed = viewedRewards.failed;
  const stepCalendarMonth = (step: number) => { const month = shiftMonth(calendarMonth, step); switchStarted('calendar', month, 'calendar-month'); setCalendarMonth(month); };
  // After a change of side (here, on 我的帳戶, or on another phone) the page reads everything again for the new
  // side: its group numbers, its prizes, and the profile, whose target from the side left behind is gone.
  const seenOwnSide = useRef<Congregation | null>(null);
  useEffect(() => {
    const previous = seenOwnSide.current;
    if (ownSide) seenOwnSide.current = ownSide;
    if (!previous || !ownSide || previous === ownSide) return;
    setGroupReset((value) => value + 1); setRewardSide(null);
    refreshOwnProfile();
  }, [ownSide, refreshOwnProfile]);
  useEffect(() => {
    if (!devotionClient || !session || !focused || !primaryReady || scope !== 'me') return;
    let active = true; const generation = viewGeneration.current;
    void devotionClient.getScoreHistory().then((value) => { if (active && isViewLive(generation)) { setScoreHistory(value); setScoreHistoryMissing(false); } }).catch(() => { if (active && isViewLive(generation)) setScoreHistoryMissing(true); });
    return () => { active = false; };
  }, [devotionClient, session, scope, focused, primaryReady, secondaryRefresh, historyRefresh, isViewLive, profile?.earnedTotal]);

  const [friendNotice, setFriendNotice] = useState<string | null>(null);
  const openQrSheet = () => { setFriendNotice(null); setSheet('qr'); };
  const closeQrSheet = () => {
    setSheet(null); setFriendNotice(null);
    // The push may not have arrived (no token yet, no network): closing the QR is the fallback read.
    if (activeScope.current === 'friends') void refreshFriends();
  };
  const onFriendAdded = useRef<(event: FriendAddedEvent) => void>(() => undefined);
  onFriendAdded.current = (event) => {
    // Off screen, the next focus reloads everything; nothing is kept for later.
    if (!session || !focusedRef.current || !appActive.current) return;
    if (activeSheet.current === 'qr') setFriendNotice(event.friendName);
    if (activeScope.current === 'friends') void refreshFriends();
    else if (activeScope.current === 'me') {
      void loadProfile(session.memberId, 'me');
      // The 好友 list asked ahead no longer has everyone: ask again now, so the tab opens on the new friend too.
      const request = friendsRequest();
      if (request) viewCache.prefetch(request.key, request.load, ASK_AGAIN);
    }
  };
  useEffect(() => subscribeFriendAdded((event) => onFriendAdded.current(event)), []);
  const openRequestedFriends = useRef<() => void>(() => undefined);
  openRequestedFriends.current = () => {
    // A tap on the friend notification; left pending until this screen is focused and in front.
    if (!session || !focusedRef.current || !appActive.current || !consumeOpenFriendsList()) return;
    void chooseScope('friends');
  };
  useEffect(() => subscribeOpenFriendsList(() => openRequestedFriends.current()), []);
  const openRequestedAll = useRef<() => void>(() => undefined);
  openRequestedAll.current = () => {
    // From 我的帳戶; left pending until this screen is in front and knows the viewer is an admin.
    if (!session || !focusedRef.current || !appActive.current || !capabilities || !consumeOpenAllScores()) return;
    void chooseScope('all');
  };
  useEffect(() => subscribeOpenAllScores(() => openRequestedAll.current()), []);
  useEffect(() => { openRequestedAll.current(); }, [capabilities, focused]);
  awardRefreshRef.current = (memberId) => {
    if (session?.memberId === memberId && scope === 'me' && focusedRef.current && appActive.current) void loadProfile(memberId, 'me');
  };
  // What the calendar knows about a day: the schedule's answer once that range has loaded (a date
  // it did not return has no reading), the reading tab's plan until then.
  // The month on screen comes straight from the store, in the same render as 上個月/下個月; the effects above put the
  // same answer into the schedule (asked ahead, it already is).
  const calendarRange = readingDaysRange(calendarMonth, today);
  const keptMonth = session ? viewCache.peek<ReadingDaysAnswer>(viewCacheKey(session, 'reading-days', calendarRange.from, calendarRange.to)) : undefined;
  const keptMonthDays = useMemo(() => keptMonth ? calendarDaysOf(keptMonth) : null, [keptMonth]);
  const keptDevotion = session ? viewCache.peek<string[]>(devotionDatesKey(session, calendarRange.from, calendarRange.to)) : undefined;
  const shownDevotionDates = useMemo<ReadonlySet<string>>(() => keptDevotion
    ? new Set([...[...devotionDates].filter((date) => date < calendarRange.from || date > calendarRange.to), ...keptDevotion])
    : devotionDates, [devotionDates, keptDevotion, calendarRange.from, calendarRange.to]);
  const scheduledDay = (date: string): CalendarDay | undefined => {
    if (keptMonthDays && date >= calendarRange.from && date <= calendarRange.to) return keptMonthDays.get(date);
    if (schedule.ranges.some((range) => date >= range.from && date <= range.to)) return schedule.days.get(date);
    const local = getScheduledReading(date);
    return local ? { ...local, completed: false, canComplete: isWithinCompletionWindow(date, today) } : undefined;
  };
  const selectedBase = scheduledDay(selectedDate);
  const selectedPlanId = selectedBase?.planId ?? getReadingPlanId(selectedDate) ?? monthlyPlanId(selectedDate);
  const selectedCanComplete = dayState(selectedDate, today, selectedBase && { ...selectedBase, completed: false }) === 'open';
  const refreshedCompletionOperations = useRef(new Set<string>());
  const refreshCompletionProfile = useCallback((event: CompletionSyncEvent | CompletionAwardEvent) => {
    if (event.memberId !== session?.memberId || refreshedCompletionOperations.current.has(event.operationId)) return;
    if (refreshedCompletionOperations.current.size >= 64) {
      const oldestOperation = refreshedCompletionOperations.current.values().next().value;
      if (oldestOperation) refreshedCompletionOperations.current.delete(oldestOperation);
    }
    refreshedCompletionOperations.current.add(event.operationId);
    setProfile((current) => applyCompletionSyncToProfile(current, event));
    awardRefreshRef.current(event.memberId);
  }, [session?.memberId]);
  const onCompletionAward = useCallback((event: CompletionAwardEvent) => {
    if (session && event.memberId === session.memberId) invalidateReadingDaysInViewCache(session, event.taskDate);
    setCompletionAward(event);
    if (event.memberId === session?.memberId) setConfirmedDays((current) => ({ ...current, [event.taskDate]: true }));
    refreshCompletionProfile(event);
  }, [refreshCompletionProfile, session]);
  const onCompletionConfirmed = useCallback((event: CompletionSyncEvent) => {
    // The event carries its original taskDate; a cross-month backfill still refreshes this member's profile.
    if (session && event.memberId === session.memberId) invalidateReadingDaysInViewCache(session, event.taskDate);
    if (event.memberId === session?.memberId) setConfirmedDays((current) => ({ ...current, [event.taskDate]: event.status === 'COMPLETED' }));
    refreshCompletionProfile(event);
  }, [refreshCompletionProfile, session]);
  // The same shared controller the reading tab uses, pointed at whichever day the calendar selected.
  const completion = useCompletionController({ planId: selectedPlanId, taskDate: selectedDate, canComplete: selectedCanComplete, refreshRemote: false, onAward: onCompletionAward, onConfirmed: onCompletionConfirmed });
  // The selected day's own record is the freshest word on it (it flips the moment the button is
  // pressed); other days take a confirmed sync event over the schedule.
  const localRecordTouched = (record: CompletionRecord) => record.revision > 0 || record.syncStatus !== 'CONFIRMED' || record.status !== 'UNREPORTED';
  const calendarDay = (date: string): CalendarDay | undefined => {
    const base = scheduledDay(date);
    if (!base) return undefined;
    const local = completion.getCompletionRecord?.(base.planId, date)
      ?? (date === selectedDate && completion.record.taskDate === date ? completion.record : undefined);
    if (local && localRecordTouched(local) && (local.syncStatus !== 'CONFIRMED' || base.revision === undefined || local.revision >= base.revision)) return { ...base, completed: local.status === 'COMPLETED' };
    return date in confirmedDays ? { ...base, completed: confirmedDays[date] } : base;
  };
  // The displayed month, plus the selected day wherever it is: paging months keeps the day card's day.
  const calendarDays = new Map<string, CalendarDay>();
  for (const date of new Set([selectedDate, ...monthCells(calendarMonth).filter((cell): cell is string => cell !== null)])) {
    const day = calendarDay(date);
    if (day) calendarDays.set(date, day);
  }
  const planSpan = getReadingPlanSpan();
  const lastMonth = planSpan && planSpan.last.slice(0, 7) > today.slice(0, 7) ? planSpan.last.slice(0, 7) : today.slice(0, 7);
  const selectedState = dayState(selectedDate, today, calendarDays.get(selectedDate));
  // Finished on another phone: this phone's controller holds no record to undo, so the button says
  // finished and stays still rather than offering an undo that does nothing.
  const finishedElsewhere = selectedState === 'completed' && completion.record.status !== 'COMPLETED';
  const withPick = (run: () => void) => { pickedDate.current = true; run(); };
  const toggleDevotion = (date: string, completed: boolean) => {
    if (!devotionClient || devotionPending) return;
    const apply = (value: boolean) => {
      if (session) markDevotionInViewCache(session, date, value);
      setDevotionDates((current) => { const next = new Set(current); if (value) next.add(date); else next.delete(date); return next; });
    };
    loadedDevotionRanges.current.push({ from: date, to: date });
    apply(completed); setDevotionPending(date);
    void devotionClient.setDevotion(date, completed)
      .then(() => setHistoryRefresh((value) => value + 1))
      .catch((reason) => { apply(!completed); setError(messageFor(reason)); })
      .finally(() => setDevotionPending(null));
  };
  const groupFirstMonth = planSpan ? planSpan.first.slice(0, 7) : today.slice(0, 7);

  const exportReadingCard = async (period: ReadingCardScope) => {
    if (!session || exportRequest.current) return;
    const request = {}; exportRequest.current = request;
    const expectedEpoch = auth.epoch;
    const owns = () => exportRequest.current === request && isCurrentAuthSession(session) && getAuthSnapshot().epoch === expectedEpoch;
    setExportBusy(true); setExportError(null);
    try {
      const days = await loadReadingCardSnapshot(session.memberId, getReadingPlan());
      if (!owns()) return;
      const snapshot = days.flatMap(day => {
        const inLoadedRange = schedule.ranges.some(range => day.date >= range.from && day.date <= range.to);
        const current = calendarDay(day.date);
        if (inLoadedRange && !current) return [];
        const liveCompletion = day.date in confirmedDays || day.date === selectedDate && localRecordTouched(completion.record);
        const liveDevotion = loadedDevotionRanges.current.some(range => day.date >= range.from && day.date <= range.to);
        return [{ ...day, completed: current && liveCompletion ? current.completed : day.completed, devoted: liveDevotion ? devotionDates.has(day.date) : day.devoted }];
      });
      const memberName = auth.profile?.memberId === session.memberId ? auth.profile.displayName : profile?.memberId === session.memberId ? profile.displayName : null;
      if (!memberName) throw new Error('目前沒有你的名字，請稍後重試。');
      const card = { today: taipeiDate(), memberName, scope: period };
      await shareReadingCard(buildReadingCardHtml({ ...card, days: snapshot }), readingCardFileName(card), owns);
      if (owns()) setExportOpen(false);
    } catch (reason) {
      if (owns()) setExportError(reason instanceof Error ? reason.message : '產生讀經卡失敗，請重試。');
    } finally {
      if (owns()) { exportRequest.current = null; setExportBusy(false); }
    }
  };
  // The CI latency check (src/services/switchLatencyProbe.ts): what each switch's content shows now.
  useSwitchShown('calendar', keptMonth || schedule.ranges.some((range) => range.from <= calendarRange.from && range.to >= calendarRange.to) ? calendarMonth : null);
  useSwitchShown('scope', scope === 'me' ? (session && profile?.memberId === session.memberId ? 'me' : null) : (!busy && !selected ? scope : null));
  useSwitchShown('redemptions', sheet === 'redemptions' ? 'open' : null);
  if (!session) return <View style={styles.screen}><Text style={styles.title}>積分</Text><Text style={styles.note}>請先登入以查看積分。</Text></View>;
  const ownProfile = profile?.memberId === session.memberId ? profile : null;
  const showingProfile = scope !== 'me' && selected && profile;
  return <View style={styles.screen} accessibilityElementsHidden={!appForeground} importantForAccessibility={appForeground ? 'auto' : 'no-hide-descendants'}>
    <View style={styles.scopeHeader}><View style={styles.scopes}>{(['me', 'friends', ...(scope === 'all' ? ['all'] : [])] as ScoreScope[]).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: scope === item }} accessibilityLabel={item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體 (管理)'} onPress={() => void chooseScope(item)} style={[styles.scope, scope === item && styles.scopeActive]}><Text style={[styles.scopeText, scope === item && styles.scopeTextActive]}>{item === 'me' ? '自己' : item === 'friends' ? '好友' : '全體 (管理)'}</Text></Pressable>)}</View><Pressable accessibilityRole="button" accessibilityLabel="開啟積分操作" onPress={() => setSheet('menu')} style={styles.menu}><Text style={styles.menuText}>⋯</Text></Pressable></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{busy ? <Text style={styles.note}>載入中…</Text> : null}
    {/* A number with no note beside it claims to be current. This one is not. */}
    {profileStale && ownProfile ? <Text style={styles.stale}>目前顯示上次的積分，還沒連上更新</Text> : null}
    {scope === 'me' && !ownProfile ? <View style={styles.noteBox}><Text style={styles.note}>正在載入你的積分。</Text></View> : null}
    {scope !== 'me' ? <View style={showingProfile ? styles.hiddenList : styles.listSurface}><PeopleList people={people} showRank={scope === 'all'} showCongregation={scope === 'all'} showClient={scope === 'all'} onSelect={openProfile} /></View> : null}
    {showingProfile ? <><Pressable accessibilityRole="button" accessibilityLabel="返回積分清單" onPress={() => { requestGeneration.current += 1; stopPrefetch(); activeMember.current = null; setBusy(false); setProfile(null); setSelected(null); }} style={styles.back}><Text style={styles.backText}>‹ 返回清單</Text></Pressable><ScoreProfile profile={profile} onChartChange={loadProfileChart} /></> : null}
    {scope === 'me' && ownProfile ? <ScoreProfile
      profile={ownProfile}
      scrollRef={pageScroll}
      showChartViewToggle={false}
      lead={<>
        {/* Today's two buttons first (維護者 2026-10-19), then 團體, then 個人. */}
        <SelectedDayCard
          date={selectedDate}
          today={today}
          day={calendarDays.get(selectedDate)}
          onBackToToday={() => withPick(() => { setSelectedDate(today); setCalendarMonth(today.slice(0, 7)); })}
          action={<View style={styles.completionAction}>
            <View style={styles.dayActions}>
            <DevotionTodayButton
              date={selectedDate}
              today={today}
              completed={shownDevotionDates.has(selectedDate)}
              pending={devotionPending === selectedDate}
              canMark={selectedDate <= today && isWithinCompletionWindow(selectedDate, today)}
              onToggle={(completed) => withPick(() => toggleDevotion(selectedDate, completed))}
            />
            <CompletionTodayButton
              record={finishedElsewhere ? { ...completion.record, status: 'COMPLETED' } : completion.record}
              pending={completion.pending}
              retryable={completion.retryable}
              canComplete={selectedCanComplete}
              today={today}
              undoable={!finishedElsewhere}
              onComplete={() => withPick(() => { void completion.complete(); })}
              onUndo={() => withPick(completion.requestUndo)}
            />
            </View>
            {completion.syncError ? <Text accessibilityRole="alert" style={styles.stale}>{completion.record.syncStatus === 'SAVE_FAILED' && !completion.retryable ? '完成記錄無法同步，本機完成狀態仍保留。' : '同步遇到問題，完成狀態已保留，連線後會重試。'}</Text> : null}
          </View>}
        />
        {/* 團體 (維護者 2026-10-14): replaces 一起走過. Absent on a backend that predates it; the section then hides. */}
        <GroupSection
          memberId={session.memberId}
          sessionToken={session.sessionToken}
          client={devotionClient}
          ownSide={ownSide}
          active={ownView}
          freshSince={visitStartedAt}
          resetSignal={groupReset}
          today={today}
          firstMonth={groupFirstMonth}
        />
        <ReadingCalendarCard
          month={calendarMonth}
          today={today}
          selectedDate={selectedDate}
          days={calendarDays}
          // The picked day's buttons are in the card at the top: scroll back up to show them.
          onSelect={(date) => withPick(() => { setSelectedDate(date); pageScroll.current?.scrollTo({ y: 0, animated: true }); })}
          onOpenReadingPlan={() => setPlanOpen(true)}
          onExportReadingCard={() => { setExportError(null); setExportOpen(true); }}
          onPreviousMonth={planSpan && calendarMonth > planSpan.first.slice(0, 7) ? () => stepCalendarMonth(-1) : undefined}
          onNextMonth={calendarMonth < lastMonth ? () => stepCalendarMonth(1) : undefined}
          devotionDates={shownDevotionDates}
        />
      </>}
      rewards={shelfRewards ?? undefined}
      handedOutBy={congregation.value === 'main' ? '同工' : '輔導'}
      chart={scoreHistory ? <ScoreHistoryCard history={scoreHistory} /> : scoreHistoryMissing ? undefined : null}
      onChooseTarget={(rewardId) => { void setTarget(rewardId); }}
      onChartChange={loadProfileChart}
      onChooseReward={() => void loadRewards()}
    /> : null}
    <CompletionAwardFeedback event={completionAward} onFinished={(operationId) => setCompletionAward((current) => current?.operationId === operationId ? null : current)} />
    <ReadingCardExportSheet visible={exportOpen} today={today} busy={exportBusy} error={exportError} onExport={period => { void exportReadingCard(period); }} onClose={closeExport} />
    <ReadingPlanSheet visible={planOpen} onClose={() => setPlanOpen(false)} onSelectDate={date => { setSelectedReadingDate(date); router.replace('/reader'); }} />
    <ActionSheet visible={sheet === 'menu'} title="積分操作" dismissOnOutsideTap onClose={() => setSheet(null)} actions={[{ label: '我的好友 QR', onPress: openQrSheet }, { label: '掃描好友 QR', onPress: () => setSheet('scan') }, { label: '我的領取紀錄', onPress: () => { switchStarted('redemptions', 'open', 'redemptions'); void loadRedemptions(); } }, ...(scope === 'friends' && selected ? [{ label: '移除好友', destructive: true, onPress: () => { void removeSelectedFriend(); } }] : [])]} />
    <ActionSheet visible={sheet === 'qr'} title="我的好友 QR" dismissOnOutsideTap onClose={closeQrSheet}>
      {friendNotice ? <View accessible accessibilityLabel={`✓ ${friendNotice} 已加你為好友`} accessibilityLiveRegion="polite" style={styles.friendNotice}>
        <View style={styles.friendTick}><Text style={styles.friendTickText}>✓</Text></View>
        <Text style={styles.friendNoticeText}>{`${friendNotice} 已加你為好友`}</Text>
      </View> : null}
      <FriendQrPanel client={client!} mode="show" />
      {friendNotice ? <Text style={[styles.note, styles.friendNoticeHint]}>名單已經更新，可以關掉了</Text> : null}
    </ActionSheet>
    <ActionSheet visible={sheet === 'scan'} title="掃描好友 QR" onClose={() => setSheet(null)}><FriendQrPanel client={client!} mode="scan" onClaimed={scanClaimed} onActivityStart={beginScannerActivity} /></ActionSheet>
    <ActionSheet visible={sheet === 'rewards'} title="選擇目標獎品" dismissOnOutsideTap onClose={() => setSheet(null)}><RewardPicker own={pickerOwn} viewing={rewardSide ?? pickerOwn} ownRewards={rewards ?? shelfRewards ?? []} otherRewards={otherRewards} otherFailed={otherRewardsFailed} selectedRewardId={selectedRewardId} onView={(side) => { void viewRewards(side); }} onSelect={(rewardId) => void setTarget(rewardId)} /></ActionSheet>
    <ActionSheet visible={sheet === 'redemptions'} title="領取紀錄" dismissOnOutsideTap onClose={() => setSheet(null)}><RedemptionList redemptions={redemptions} /></ActionSheet>
    {!appForeground ? <View testID="progress-inactive-cover" pointerEvents="auto" style={styles.inactiveCover} /> : null}
  </View>;
}

/** The calendar months a tap on 上個月/下個月 can reach from `month`, inside the plan (or up to this month). */
function adjacentCalendarMonths(month: string, today: string): string[] {
  const span = getReadingPlanSpan();
  const last = span && span.last.slice(0, 7) > today.slice(0, 7) ? span.last.slice(0, 7) : today.slice(0, 7);
  return [span && month > span.first.slice(0, 7) ? shiftMonth(month, -1) : null, month < last ? shiftMonth(month, 1) : null].filter((value): value is string => value !== null);
}
type ReadingDaysAnswer = { today: string; timezone: string; days: ReadingDaySnapshot[] };
function calendarDaysOf(response: ReadingDaysAnswer): Map<string, CalendarDay> {
  return new Map(response.days.map((day) => [day.taskDate, { planId: day.planId, references: day.references, completed: day.status === 'COMPLETED', revision: day.revision, canComplete: day.canComplete }] as const));
}
function monthNow(): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(new Date()); const year = parts.find((part) => part.type === 'year')?.value ?? '1970'; const month = parts.find((part) => part.type === 'month')?.value ?? '01'; return `${year}-${month}`; }
function monthlyPlanId(date: string): string { return `church-${date.slice(0, 7)}`; }
function messageFor(reason: unknown): string { return reason instanceof GamificationApiError ? reason.userMessage : '目前無法載入積分，請稍後再試。'; }
// Waits before the second and third profile tries. Bounded, so a backend that is really off still ends
// on the error (after about 31 s of 載入中… when every try times out) instead of retrying forever.
const PROFILE_RETRY_DELAYS_MS = [2000, 5000];
// 全體 (管理) asks ahead for this many people's points after the unlock, in list order (the church is well under it).
const ALL_PROFILES_AHEAD = 200;
// Timeouts, unreachable networks and 5xx can answer differently next time; a refusal or a malformed
// answer will not. A cancelled read belongs to a view that is already gone.
function isRetryableRead(reason: unknown): boolean { return reason instanceof GamificationApiError && reason.retryable && reason.code !== 'REQUEST_CANCELLED'; }

const styles = StyleSheet.create({ section: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.xs, paddingHorizontal: theme.spacing.xxs }, sectionTitle: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' }, sectionRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: theme.colors.primary }, dayActions: { flexDirection: 'row', gap: theme.spacing.sm }, screen: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }, inactiveCover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.background }, title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' }, scopeHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.md }, menu: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' }, menuText: { color: theme.colors.ink, fontSize: 26 }, scopes: { flex: 1, flexDirection: 'row', gap: theme.spacing.xs }, scope: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }, scopeActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }, scopeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, scopeTextActive: { color: theme.colors.white }, note: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line }, noteBox: { padding: theme.spacing.lg, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface }, completionAction: { gap: theme.spacing.xs }, listSurface: { flex: 1 }, hiddenList: { display: 'none' }, error: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, marginBottom: theme.spacing.sm }, stale: { color: theme.colors.muted, fontSize: theme.type.caption.size, marginBottom: theme.spacing.sm }, back: { minHeight: theme.control.tap, justifyContent: 'center' }, backText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' }, friendNotice: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.sm, borderRadius: theme.radius.card, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }, friendTick: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary }, friendTickText: { color: theme.colors.white, fontSize: theme.type.caption.size, fontWeight: '900' }, friendNoticeText: { flexShrink: 1, color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' }, friendNoticeHint: { textAlign: 'center' } });
