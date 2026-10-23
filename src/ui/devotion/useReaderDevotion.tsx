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
  useEffect(() => { setSelected(false); setAtEnd(false); speakWhenReady.current = false; asking.current = null; dropRetry(); speech.stop(); setPost(null); setMarked(null); markRevision.current++; markPendingRef.current = false; setMarkPending(false); setCompletionEvent(null); }, [date, memberId, session?.sessionToken, baseUrl, speech, dropRetry]);
  useEffect(() => () => speech.stop(), [speech]);
  useEffect(() => dropRetry, [dropRetry]);
  useEffect(() => {
    if (!client) { setMarked(null); return; }
    if (!focused) return;
    let active = true;
    const revision = markRevision.current;
    void client.getDevotionDates(date, date).then((dates) => { if (active && revision === markRevision.current) setMarked({ date, done: dates.includes(date) }); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, date, refreshSignal]);

  // `quiet` keeps 還沒有上傳 on screen while asking again, and a failed quiet ask leaves it there.
  // One question at a time (2026-10-19 review): a look while one is on its way waits for that answer, so an older
  // answer never lands after a newer one.
  const load = useCallback((quiet = false) => {
    if (!client || asking.current?.scope === scope) return;
    const forDate = date;
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
      void client.getDevotional(forDate)
        .then((value: DevotionalPost | null) => settle(value ? { kind: 'ready', post: value } : { kind: 'missing', awaiting: awaitsPost(forDate) }))
        .catch((reason: unknown) => {
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
          settle(quiet ? null : { kind: 'error', onRetry: () => load() });
        });
    };
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
    setSelected(true); showTools(); ensureLoaded();
    if (!read) return;
    if (current?.kind === 'ready') speech.start(date, current.post);
    else speakWhenReady.current = true;
  }, [current, date, ensureLoaded, showTools, speech]);

  const onLastChapterNarrated = useCallback(() => { if (client && followRef.current) open(true); }, [client, open]);
  const leave = useCallback(() => {
    setSelected(false); speakWhenReady.current = false;
    if (speech.getSnapshot().status === 'speaking') speech.pause();
  }, [speech]);

  const today = taipeiDate();
  const done = marked?.date === date && marked.done;
  const speaking = spoken.status === 'speaking' && spoken.date === date;
  const toggle = () => {
    if (!client || markPendingRef.current) return;
    markPendingRef.current = true;
    const revision = ++markRevision.current;
    const isCurrent = () => scopeRef.current === scope && revision === markRevision.current;
    const next = !done;
    setMarked({ date, done: next }); setMarkPending(true);
    void client.setDevotion(date, next)
      .then(() => {
        if (isCurrent() && next) setCompletionEvent({ kind: 'devotion', taskDate: date, operationId: `devotion-${++completionSequence.current}` });
      })
      .catch(() => { if (isCurrent()) setMarked((value) => value?.date === date ? { date, done: !next } : value); })
      .finally(() => { if (isCurrent()) { markPendingRef.current = false; setMarkPending(false); } });
  };
  // The CI latency check (src/services/switchLatencyProbe.ts): the 靈修 tab's post, and the leaf's mark for the day.
  useSwitchShown('devotional', selected && current && current.kind !== 'loading' ? date : null);
  useSwitchShown('devotion-mark', marked?.date === date ? date : null);
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
