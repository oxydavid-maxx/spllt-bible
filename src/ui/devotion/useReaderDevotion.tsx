import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createDevotionClient, type DevotionalPost } from '../../services/devotionClient';
import { GamificationApiError } from '../../services/gamificationApiClient';
import { createDevotionSpeech } from '../../services/devotionSpeech';
import { createNativeDevotionEngine } from '../../services/nativeDevotionAudio';
import { createDevotionVoiceStore } from '../../services/devotionVoicePreferences';
import { createDevotionPreferencesStore } from '../../services/devotionPreferences';
import { devotionVolume } from '../../domain/devotionVoice';
import { isWithinCompletionWindow, taipeiDate } from '../../domain/gamificationV1';
import type { DevotionCompletionEvent } from '../CompletionAwardFeedback';
import type { ReaderDevotion } from '../FullscreenReaderLayout';
import { DevotionalView, type DevotionalState } from './DevotionalView';
import { useReaderRetrySignal } from '../readerRetrySignal';
import { devotionBanner } from './devotionFabModel';
import { switchStarted, useSwitchShown } from '../../services/switchLatencyProbe';
import { ASK_AGAIN, devotionDatesKey, markDevotionInViewCache, viewCache, viewCacheKey } from '../../services/viewCache';
import { readingDaysRange, shiftMonth } from '../gamification/readingCalendarModel';

/**
 * Everything the reader needs for the 靈修 tab (維護者 2026-10-14). The post is fetched only when the
 * tab is opened or the reading hands over to it; the day's 靈修 mark is read once per day shown.
 * Order of play: chapters → 靈修 read aloud → the song (screen on only).
 */

const voices = createDevotionVoiceStore({ getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync });

const preferences = createDevotionPreferencesStore({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

/**
 * An empty day that may still get its 靈修 (靈修請待發佈): today or later, Monday to Saturday. No 靈修 is posted on
 * Sundays (server/routes.ts answers a plain 404 for them), so a Sunday reads 這一天的靈修還沒有上傳 (2026-10-19 review).
 */
function awaitsPost(day: string): boolean {
  return day >= taipeiDate() && new Date(`${day}T12:00:00Z`).getUTCDay() !== 0;
}

/**
 * A load that met a network error, a timeout or a 5xx is asked once more after this wait, with 載入中 still on
 * (2026-10-20: the 07:08 backend deploy dropped requests for about 3 s and the page opened on its error).
 * Long enough to outlast such a restart; the second failure shows the error and 重試.
 */
export const DEVOTIONAL_RETRY_DELAY_MS = 4000;

/** Can the same question get another answer shortly? A refusal or malformed data will not; a cancelled read has no screen left. */
function retryableLoadError(reason: unknown): boolean {
  return reason instanceof GamificationApiError && reason.retryable && reason.code !== 'REQUEST_CANCELLED';
}

export interface ReaderDevotionBinding {
  devotion: ReaderDevotion | undefined;
  completionEvent: DevotionCompletionEvent | null;
  /** Includes a paused narration, so midnight cannot discard its remaining text. */
  narrationActive: boolean;
  clearCompletionFeedback: (operationId: string) => void;
  /** For YouVersionReader: the last chapter's narration ended. */
  onLastChapterNarrated: () => void;
  /** A chapter chip was chosen: back to the chapter; a 靈修 being read pauses. */
  leave: () => void;
}

export function useReaderDevotion({ session, baseUrl, date, showTools, textSettings, narrationSpeed = 1, focused = true, bibleVersionId }: {
  session: { memberId: string; sessionToken: string } | null; baseUrl: string; date: string; showTools: () => void;
  /** The member's 調整字體 settings for scripture (null: the SDK defaults); the 靈修 words follow them. */
  textSettings?: { fontSize: number; lineSpacing: number } | null;
  narrationSpeed?: number;
  focused?: boolean;
  /** The version whose recording was just heard: the 靈修 plays as loud as it (devotionVolume). */
  bibleVersionId?: number | null;
}): ReaderDevotionBinding {
  const refreshSignal = useReaderRetrySignal(focused);
  // One visit of the reader per retry signal (its focus, or the app's return while it shows): the day's post and 靈修
  // marks asked ahead are used without asking again (src/services/viewCache.ts, 光佑 2026-10-23); the next visit asks
  // afresh. The render that just gained focus waits for the signal it is about to bump, so one focus is one visit.
  const visitStartedAt = useMemo(() => viewCache.beginVisit(), [refreshSignal]);
  const visitRef = useRef(visitStartedAt); visitRef.current = visitStartedAt;
  const lastFocused = useRef(focused);
  const signalComing = focused && !lastFocused.current;
  useEffect(() => { lastFocused.current = focused; });
  const memberId = session?.memberId ?? null;
  const client = useMemo(() => session ? createDevotionClient({ baseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [baseUrl, session?.memberId, session?.sessionToken]);
  const connection = useRef(session ? { baseUrl, token: session.sessionToken, memberId: session.memberId } : null);
  connection.current = session ? { baseUrl, token: session.sessionToken, memberId: session.memberId } : null;
  const voice = useSyncExternalStore(voices.subscribe, () => voices.getVoice(memberId), () => voices.getVoice(memberId));
  const [atEnd, setAtEnd] = useState(false);
  const [selected, setSelected] = useState(false);
  const [post, setPost] = useState<{ date: string; state: DevotionalState } | null>(null);
  const [marked, setMarked] = useState<{ date: string; done: boolean } | null>(null);
  const [markPending, setMarkPending] = useState(false);
  const markPendingRef = useRef(false);
  const markRevision = useRef(0);
  const [completionEvent, setCompletionEvent] = useState<DevotionCompletionEvent | null>(null);
  const completionSequence = useRef(0);
  const scope = `${baseUrl}:${memberId}:${session?.sessionToken}:${date}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [songRequest, setSongRequest] = useState(0);
  const speakWhenReady = useRef(false);
  // The one 靈修 question on its way, if any. A new day or member drops it, so its answer is ignored.
  const asking = useRef<{ scope: string } | null>(null);
  // That question's one automatic ask again, while it waits (DEVOTIONAL_RETRY_DELAY_MS). Dropped with the question.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropRetry = useCallback(() => { if (retryTimer.current !== null) clearTimeout(retryTimer.current); retryTimer.current = null; }, []);
  // A failed ask made ahead counts as the first ask of one load only; a later look asks again.
  const usedFailure = useRef<unknown>(null);
  const follow =useSyncExternalStore(preferences.subscribe, () => preferences.getSnapshot(memberId), () => preferences.getSnapshot(memberId));
  const followRef = useRef(follow.enabled);
  followRef.current = follow.enabled;
  const [speech] = useState(() => createDevotionSpeech(createNativeDevotionEngine(() => connection.current), () => { if (followRef.current) setSongRequest((value) => value + 1); }));
  const spoken = useSyncExternalStore(speech.subscribe, speech.getSnapshot, speech.getSnapshot);

  useEffect(() => { void preferences.load(memberId); void voices.load(memberId); }, [memberId]);
  useEffect(() => { speech.setRate(narrationSpeed); }, [speech, narrationSpeed]);
  useEffect(() => { speech.setVoice(voice); }, [speech, voice]);
  useEffect(() => { speech.setVolume(devotionVolume(voice, bibleVersionId)); }, [speech, voice, bibleVersionId]);
  // A new day, or another member: back to the chapter, nothing read aloud from the old one.
  const shownDay = useRef<string | null>(null);
  // The month of 靈修 marks the last render drew the leaf from.
  const drawnMonth = useRef<readonly string[] | undefined>(undefined);
  useEffect(() => {
    // The question still out for the day left is dropped with it, in the shared store too: its answer is not kept.
    if (shownDay.current && session) viewCache.dropInflight(viewCacheKey(session, 'devotional', shownDay.current));
    shownDay.current = date;
  }, [date, memberId, session?.sessionToken]);
  // What the screen shows goes back in the same render as the new day (2026-10-23, switches within 100 ms): reset in an
  // effect, it drew the whole reader a second time right after ‹ ›. What is not on screen is let go in the effect.
  const shownFor = `${date}|${memberId ?? ''}|${session?.sessionToken ?? ''}|${baseUrl}`;
  const [resetFor, setResetFor] = useState(shownFor);
  if (resetFor !== shownFor) { setResetFor(shownFor); setSelected(false); setAtEnd(false); setPost(null); setMarked(null); setMarkPending(false); setCompletionEvent(null); }
  useEffect(() => { speakWhenReady.current = false; asking.current = null; dropRetry(); speech.stop(); markRevision.current++; markPendingRef.current = false; }, [date, memberId, session?.sessionToken, baseUrl, speech, dropRetry]);
  useEffect(() => () => speech.stop(), [speech]);
  useEffect(() => dropRetry, [dropRetry]);
  // The leaf's mark comes from the whole month's 靈修 days, the same ranges the 積分 calendar asks for, so the next or
  // previous day shows its mark at once; near a month's edge the month across it is asked ahead too.
  useEffect(() => {
    if (!client || !session) { setMarked(null); return; }
    if (!focused || signalComing) return;
    let active = true;
    const revision = markRevision.current;
    const today = taipeiDate();
    const month = date.slice(0, 7);
    const monthDates = (value: string) => { const range = readingDaysRange(value, today); return { key: devotionDatesKey(session, range.from, range.to), load: () => client.getDevotionDates(range.from, range.to) }; };
    const day = Number(date.slice(8, 10));
    for (const ahead of [day <= 7 ? shiftMonth(month, -1) : null, day >= 22 ? shiftMonth(month, 1) : null]) {
      if (ahead) { const request = monthDates(ahead); viewCache.prefetch(request.key, request.load, visitStartedAt); }
    }
    const request = monthDates(month);
    void viewCache.read(request.key, request.load, visitStartedAt).then((dates) => {
      // The month already drawn from the store (keptMonth below) is this answer: nothing to draw again.
      if (!active || revision !== markRevision.current || drawnMonth.current === dates) return;
      setMarked({ date, done: dates.includes(date) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [client, date, visitStartedAt, signalComing]);
  // A day the reader has not asked about yet is asked for as it shows, so 靈修 opens on it at once. A day already kept is
  // shown from the store when 靈修 opens and asked again then (load below), as every look always did; one question at a time.
  useEffect(() => {
    if (!client || !session || !focused || signalComing) return;
    const key = viewCacheKey(session, 'devotional', date);
    if (viewCache.peek(key) !== undefined || viewCache.failed(key)) return;
    viewCache.prefetch(key, () => client.getDevotional(date), visitStartedAt, { joinAnyInflight: true });
  }, [client, date, focused, visitStartedAt, signalComing]);

  // `quiet` keeps 還沒有上傳 on screen while asking again, and a failed quiet ask leaves it there.
  // One question at a time (2026-10-19 review): a look while one is on its way waits for that answer, so an older
  // answer never lands after a newer one.
  const load = useCallback((quiet = false, again = false) => {
    if (!client || asking.current?.scope === scope) return;
    const key = viewCacheKey({ memberId: memberId ?? '', sessionToken: session?.sessionToken ?? '' }, 'devotional', date);
    const forDate = date;
    // A post kept for the day shows at once (2026-10-23): an answer from this visit is this look's own answer; an older
    // one stays on screen while it is asked again without a spinner.
    if (!quiet && !again) {
      const kept = viewCache.peek<DevotionalPost | null>(key);
      if (kept !== undefined) {
        setPost({ date: forDate, state: kept ? { kind: 'ready', post: kept } : { kind: 'missing', awaiting: awaitsPost(forDate) } });
        // As with any answer: when it brings no post, nothing is read aloud later on this look's behalf.
        if (!kept) speakWhenReady.current = false;
        if (viewCache.fresh(key, visitRef.current)) return;
        quiet = true;
      }
    }
    const question = { scope };
    asking.current = question;
    if (!quiet) setPost({ date: forDate, state: { kind: 'loading' } });
    const settle = (state: DevotionalState | null) => {
      if (asking.current !== question || scopeRef.current !== scope) return;
      asking.current = null;
      // ▶ waits only for this answer: when it brings no post, nothing is read aloud later on its behalf.
      if (state?.kind !== 'ready') speakWhenReady.current = false;
      if (state) setPost((current) => current?.date === forDate ? { date: forDate, state } : current);
    };
    const ask = (retried: boolean) => {
      // The post asked ahead for this visit is used as it is; asking again after 還沒有上傳, 重試 or a failure goes out now.
      void viewCache.read(key, () => client.getDevotional(forDate), retried || again ? ASK_AGAIN : visitRef.current, { reuseValue: !quiet, joinAnyInflight: !retried && !again })
        .then((value: DevotionalPost | null) => settle(value ? { kind: 'ready', post: value } : { kind: 'missing', awaiting: awaitsPost(forDate) }))
        .catch((reason: unknown) => {
          usedFailure.current = viewCache.failure(key) ?? usedFailure.current; // This load's own failure, not one made ahead.
          // 2026-10-20: a shown load that met a network error or a 5xx is asked once more after a short wait, still
          // 載入中 and still the one question on its way, so other looks send nothing meanwhile. Only that second
          // failure shows the error: never a chain of asks (the 0.5.34 loop, #68/#74). A quiet ask keeps 還沒有上傳 and
          // waits for the next look, as before.
          if (!quiet && !retried && retryableLoadError(reason) && asking.current === question && scopeRef.current === scope) {
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null;
              if (asking.current === question && scopeRef.current === scope) ask(true);
            }, DEVOTIONAL_RETRY_DELAY_MS);
            return;
          }
          settle(quiet ? null : { kind: 'error', onRetry: () => load(false, true) });
        });
    };
    // The ask made ahead for this visit already failed: it was this load's first ask, so the budget above still holds
    // (one automatic ask again for a network error or a 5xx, otherwise the error and 重試 at once).
    const failedAhead = quiet || again ? undefined : viewCache.failure(key);
    if (failedAhead && failedAhead.at >= visitRef.current && usedFailure.current !== failedAhead) {
      usedFailure.current = failedAhead;
      if (retryableLoadError(failedAhead.reason)) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          if (asking.current === question && scopeRef.current === scope) ask(true);
        }, DEVOTIONAL_RETRY_DELAY_MS);
      } else settle({ kind: 'error', onRetry: () => load(false, true) });
      return;
    }
    ask(false);
  }, [client, date, scope]);
  const current = post?.date === date ? post.state : null;
  const currentRef = useRef(current); currentRef.current = current;
  // The pastor posts at no fixed hour (維護者 2026-10-19): 還沒有上傳 is asked again at the next look. The state is
  // read when asked, so an answer never makes a new `prepare` (2026-10-19 review: that asked again at once).
  const ensureLoaded = useCallback(() => { const shown = currentRef.current; if (!shown || shown.kind === 'error') load(); else if (shown.kind === 'missing') load(true); }, [load]);
  // Coming back to the reader is another look: its tab regains focus, or the app returns while it shows (#73's
  // signal, the same rule as the leaf). Once per return, never while the reader is out of sight.
  const seenRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (seenRefresh.current === refreshSignal) return;
    seenRefresh.current = refreshSignal;
    if (currentRef.current?.kind === 'missing') load(true);
  }, [refreshSignal, load]);
  // Asked to read before the post arrived: start once it has.
  useEffect(() => {
    if (!speakWhenReady.current || current?.kind !== 'ready') return;
    speakWhenReady.current = false;
    speech.start(date, current.post);
  }, [current, date, speech]);

  const open = useCallback((read: boolean) => {
    setSelected(true); showTools();
    // ▶ waits for the answer to this look (set before asking: a post kept from this visit answers at once).
    if (read && current?.kind !== 'ready') speakWhenReady.current = true;
    ensureLoaded();
    if (read && current?.kind === 'ready') speech.start(date, current.post);
  }, [current, date, ensureLoaded, showTools, speech]);

  const onLastChapterNarrated = useCallback(() => { if (client && followRef.current) open(true); }, [client, open]);
  const leave = useCallback(() => {
    setSelected(false); speakWhenReady.current = false;
    if (speech.getSnapshot().status === 'speaking') speech.pause();
  }, [speech]);

  const today = taipeiDate();
  // A day just shown takes its mark from the month kept in the store in this same render (no second render of the
  // reader for it); the read below confirms it. A mark set here on the phone (`marked`) wins.
  const keptMonth = session ? (() => { const range = readingDaysRange(date.slice(0, 7), today); return viewCache.peek<string[]>(devotionDatesKey(session, range.from, range.to)); })() : undefined;
  drawnMonth.current = keptMonth;
  const markKnown = marked?.date === date || keptMonth !== undefined;
  const done = marked?.date === date ? marked.done : Boolean(keptMonth?.includes(date));
  const speaking = spoken.status === 'speaking' && spoken.date === date;
  const toggle = () => {
    if (!client || markPendingRef.current) return;
    markPendingRef.current = true;
    const revision = ++markRevision.current;
    const isCurrent = () => scopeRef.current === scope && revision === markRevision.current;
    const next = !done;
    const keep = (value: boolean) => { if (session) markDevotionInViewCache(session, date, value); };
    setMarked({ date, done: next }); setMarkPending(true); keep(next);
    void client.setDevotion(date, next)
      .then(() => {
        if (isCurrent() && next) setCompletionEvent({ kind: 'devotion', taskDate: date, operationId: `devotion-${++completionSequence.current}` });
      })
      .catch(() => { keep(!next); if (isCurrent()) setMarked((value) => value?.date === date ? { date, done: !next } : value); })
      .finally(() => { if (isCurrent()) { markPendingRef.current = false; setMarkPending(false); } });
  };
  // The CI latency check (src/services/switchLatencyProbe.ts): the 靈修 tab's post. The leaf's mark for the day is
  // reported by the page that draws it (FullscreenReaderLayout, from `markKnown`).
  useSwitchShown('devotional', selected && current && current.kind !== 'loading' ? date : null);
  const devotion: ReaderDevotion | undefined = client ? {
    selected,
    atEnd,
    available: current?.kind === 'ready',
    prepare: ensureLoaded,
    onSelect: () => { if (!selected) switchStarted('devotional', date, 'devotional-tab'); open(false); },
    renderView: (insets) => <DevotionalView
      state={current ?? { kind: 'loading' }}
      activeIndex={spoken.date === date ? spoken.index : -1}
      activePart={spoken.date === date ? spoken.part : -1}
      playerUrl={`${baseUrl}/api/devotional/player`}
      songRequest={songRequest}
      songFollows={follow.enabled}
      insets={insets}
      onEndChange={setAtEnd}
      fontSize={textSettings?.fontSize}
      lineSpacing={textSettings?.lineSpacing}
      speaking={speaking}
    />,
    completed: done,
    markKnown,
    disabled: markPending || date > today || !isWithinCompletionWindow(date, today),
    onToggle: toggle,
    speaking,
    onPlayPause: () => {
      if (speaking) { speech.pause(); return; }
      if (spoken.status === 'paused' && spoken.date === date) { speech.resume(); return; }
      if (current?.kind === 'ready') speech.start(date, current.post); else { speakWhenReady.current = true; ensureLoaded(); }
    },
    banner: devotionBanner(speaking, follow.enabled),
    voice,
    onVoiceChange: value => { void voices.update(memberId, value); },
    followEnabled: follow.enabled,
    onFollowChange: (enabled) => preferences.setEnabled(memberId, enabled),
  } : undefined;
  return { devotion, onLastChapterNarrated, leave, completionEvent, narrationActive: spoken.date === date && (spoken.status === 'speaking' || spoken.status === 'paused'), clearCompletionFeedback: operationId => setCompletionEvent(current => current?.operationId === operationId ? null : current) };
}
