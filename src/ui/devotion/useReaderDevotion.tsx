import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createDevotionClient, type DevotionalPost } from '../../services/devotionClient';
import { createDevotionSpeech } from '../../services/devotionSpeech';
import { createNativeDevotionEngine } from '../../services/nativeDevotionAudio';
import { createDevotionVoiceStore } from '../../services/devotionVoicePreferences';
import { createDevotionPreferencesStore } from '../../services/devotionPreferences';
import { isWithinCompletionWindow, taipeiDate } from '../../domain/gamificationV1';
import type { DevotionCompletionEvent } from '../CompletionAwardFeedback';
import type { ReaderDevotion } from '../FullscreenReaderLayout';
import { DevotionalView, type DevotionalState } from './DevotionalView';
import { devotionBanner } from './devotionFabModel';

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

export interface ReaderDevotionBinding {
  devotion: ReaderDevotion | undefined;
  completionEvent: DevotionCompletionEvent | null;
  clearCompletionFeedback: (operationId: string) => void;
  /** For YouVersionReader: the last chapter's narration ended. */
  onLastChapterNarrated: () => void;
  /** A chapter chip was chosen: back to the chapter; a 靈修 being read pauses. */
  leave: () => void;
}

export function useReaderDevotion({ session, baseUrl, date, showTools, textSettings, narrationSpeed = 1 }: {
  session: { memberId: string; sessionToken: string } | null; baseUrl: string; date: string; showTools: () => void;
  /** The member's 調整字體 settings for scripture (null: the SDK defaults); the 靈修 words follow them. */
  textSettings?: { fontSize: number; lineSpacing: number } | null;
  narrationSpeed?: number;
}): ReaderDevotionBinding {
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
  const follow = useSyncExternalStore(preferences.subscribe, () => preferences.getSnapshot(memberId), () => preferences.getSnapshot(memberId));
  const followRef = useRef(follow.enabled);
  followRef.current = follow.enabled;
  const [speech] = useState(() => createDevotionSpeech(createNativeDevotionEngine(() => connection.current), () => { if (followRef.current) setSongRequest((value) => value + 1); }));
  const spoken = useSyncExternalStore(speech.subscribe, speech.getSnapshot, speech.getSnapshot);

  useEffect(() => { void preferences.load(memberId); void voices.load(memberId); }, [memberId]);
  useEffect(() => { speech.setRate(narrationSpeed); }, [speech, narrationSpeed]);
  useEffect(() => { speech.setVoice(voice); }, [speech, voice]);
  // A new day, or another member: back to the chapter, nothing read aloud from the old one.
  useEffect(() => { setSelected(false); setAtEnd(false); speakWhenReady.current = false; asking.current = null; speech.stop(); setPost(null); setMarked(null); markRevision.current++; markPendingRef.current = false; setMarkPending(false); setCompletionEvent(null); }, [date, memberId, session?.sessionToken, baseUrl, speech]);
  useEffect(() => () => speech.stop(), [speech]);
  useEffect(() => {
    if (!client) { setMarked(null); return; }
    let active = true;
    const revision = markRevision.current;
    void client.getDevotionDates(date, date).then((dates) => { if (active && revision === markRevision.current) setMarked({ date, done: dates.includes(date) }); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, date]);

  // `quiet` keeps 還沒有上傳 on screen while asking again, and a failed quiet ask leaves it there.
  // One question at a time (2026-10-19 review): a look while one is on its way waits for that answer, so an older
  // answer never lands after a newer one.
  const load = useCallback((quiet = false) => {
    if (!client || asking.current?.scope === scope) return;
    const forDate = date;
    const ask = { scope };
    asking.current = ask;
    if (!quiet) setPost({ date: forDate, state: { kind: 'loading' } });
    const settle = (state: DevotionalState | null) => {
      if (asking.current !== ask || scopeRef.current !== scope) return;
      asking.current = null;
      // ▶ waits only for this answer: when it brings no post, nothing is read aloud later on its behalf.
      if (state?.kind !== 'ready') speakWhenReady.current = false;
      if (state) setPost((current) => current?.date === forDate ? { date: forDate, state } : current);
    };
    void client.getDevotional(forDate)
      .then((value: DevotionalPost | null) => settle(value ? { kind: 'ready', post: value } : { kind: 'missing', awaiting: awaitsPost(forDate) }))
      .catch(() => settle(quiet ? null : { kind: 'error', onRetry: () => load() }));
  }, [client, date, scope]);
  const current = post?.date === date ? post.state : null;
  const currentRef = useRef(current); currentRef.current = current;
  // The pastor posts at no fixed hour (維護者 2026-10-19): 還沒有上傳 is asked again at the next look. The state is
  // read when asked, so an answer never makes a new `prepare` (2026-10-19 review: that asked again at once).
  const ensureLoaded = useCallback(() => { const shown = currentRef.current; if (!shown || shown.kind === 'error') load(); else if (shown.kind === 'missing') load(true); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active' && currentRef.current?.kind === 'missing') load(true); });
    return () => subscription.remove();
  }, [load]);
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
  const devotion: ReaderDevotion | undefined = client ? {
    selected,
    atEnd,
    available: current?.kind === 'ready',
    prepare: ensureLoaded,
    onSelect: () => open(false),
    renderView: (insets) => <DevotionalView
      state={current ?? { kind: 'loading' }}
      activeIndex={spoken.date === date ? spoken.index : -1}
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
  return { devotion, onLastChapterNarrated, leave, completionEvent, clearCompletionFeedback: operationId => setCompletionEvent(current => current?.operationId === operationId ? null : current) };
}
