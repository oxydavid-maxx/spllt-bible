import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { createDevotionClient, type DevotionalPost } from '../../services/devotionClient';
import { createDevotionSpeech, type SpeechEngine } from '../../services/devotionSpeech';
import { createDevotionPreferencesStore } from '../../services/devotionPreferences';
import { isWithinCompletionWindow, taipeiDate } from '../../domain/gamificationV1';
import type { ReaderDevotion } from '../FullscreenReaderLayout';
import { DevotionalView, type DevotionalState } from './DevotionalView';
import { devotionBanner } from './devotionFabModel';

/**
 * Everything the reader needs for the 靈修 tab (維護者 2026-10-14). The post is fetched only when the
 * tab is opened or the reading hands over to it; the day's 靈修 mark is read once per day shown.
 * Order of play: chapters → 靈修 read aloud → the song (screen on only).
 */

const engine: SpeechEngine = {
  // The phone's own voice for now; the pastor's recorded voice waits for his consent.
  speak: (text, callbacks) => Speech.speak(text, { language: 'zh-TW', onDone: callbacks.onDone, onStopped: callbacks.onStopped, onError: callbacks.onError }),
  stop: () => { void Speech.stop().catch(() => undefined); },
};

const preferences = createDevotionPreferencesStore({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

export interface ReaderDevotionBinding {
  devotion: ReaderDevotion | undefined;
  /** For YouVersionReader: the last chapter's narration ended. */
  onLastChapterNarrated: () => void;
  /** A chapter chip was chosen: back to the chapter; a 靈修 being read pauses. */
  leave: () => void;
}

export function useReaderDevotion({ session, baseUrl, date, showTools }: { session: { memberId: string; sessionToken: string } | null; baseUrl: string; date: string; showTools: () => void }): ReaderDevotionBinding {
  const memberId = session?.memberId ?? null;
  const client = useMemo(() => session ? createDevotionClient({ baseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [baseUrl, session?.memberId, session?.sessionToken]);
  const [atEnd, setAtEnd] = useState(false);
  const [selected, setSelected] = useState(false);
  const [post, setPost] = useState<{ date: string; state: DevotionalState } | null>(null);
  const [marked, setMarked] = useState<{ date: string; done: boolean } | null>(null);
  const [markPending, setMarkPending] = useState(false);
  const [songRequest, setSongRequest] = useState(0);
  const speakWhenReady = useRef(false);
  const follow = useSyncExternalStore(preferences.subscribe, () => preferences.getSnapshot(memberId), () => preferences.getSnapshot(memberId));
  const [clockRevision, refreshClock] = useState(0);
  useEffect(() => {
    if (!follow.ready || follow.touched || !follow.firstOfferedOn) return;
    const expires = Date.parse(`${follow.firstOfferedOn}T00:00:00+08:00`) + 7 * 86400000;
    const delay = expires - Date.now();
    if (delay <= 0) return;
    // One deadline, no polling: a visible offer also disappears at the seventh Taipei midnight.
    const timer = setTimeout(() => refreshClock(value => value + 1), delay);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshClock(value => value + 1); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [memberId, follow.ready, follow.touched, follow.firstOfferedOn, clockRevision]);
  const followRef = useRef(follow.enabled);
  followRef.current = follow.enabled;
  const [speech] = useState(() => createDevotionSpeech(engine, () => { if (followRef.current) setSongRequest((value) => value + 1); }));
  const spoken = useSyncExternalStore(speech.subscribe, speech.getSnapshot, speech.getSnapshot);

  useEffect(() => { void preferences.load(memberId); }, [memberId]);
  // A new day, or another member: back to the chapter, nothing read aloud from the old one.
  useEffect(() => { setSelected(false); setAtEnd(false); speakWhenReady.current = false; speech.stop(); }, [date, memberId, speech]);
  useEffect(() => () => speech.stop(), [speech]);
  useEffect(() => {
    if (!client) { setMarked(null); return; }
    let active = true;
    void client.getDevotionDates(date, date).then((dates) => { if (active) setMarked({ date, done: dates.includes(date) }); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, date]);

  const load = useCallback(() => {
    if (!client) return;
    const forDate = date;
    setPost({ date: forDate, state: { kind: 'loading' } });
    void client.getDevotional(forDate)
      .then((value: DevotionalPost | null) => setPost((current) => current?.date === forDate ? { date: forDate, state: value ? { kind: 'ready', post: value } : { kind: 'missing' } } : current))
      .catch(() => setPost((current) => current?.date === forDate ? { date: forDate, state: { kind: 'error', onRetry: load } } : current));
  }, [client, date]);
  const current = post?.date === date ? post.state : null;
  const ensureLoaded = useCallback(() => { if (!current || current.kind === 'error') load(); }, [current, load]);
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
    if (!client || markPending) return;
    const next = !done;
    setMarked({ date, done: next }); setMarkPending(true);
    void client.setDevotion(date, next)
      .catch(() => setMarked((value) => value?.date === date ? { date, done: !next } : value))
      .finally(() => setMarkPending(false));
  };
  const devotion: ReaderDevotion | undefined = client ? {
    selected,
    atEnd,
    followOfferEligible: preferences.canOffer(memberId, today),
    onFollowOfferShown: () => preferences.recordOfferShown(memberId, today),
    onSelect: () => open(false),
    renderView: (insets) => <DevotionalView
      state={current ?? { kind: 'loading' }}
      activeIndex={spoken.date === date ? spoken.index : -1}
      playerUrl={`${baseUrl}/api/devotional/player`}
      songRequest={songRequest}
      songFollows={follow.enabled}
      insets={insets}
      onEndChange={setAtEnd}
    />,
    completed: done,
    disabled: markPending || date > today || !isWithinCompletionWindow(date, today),
    onToggle: toggle,
    onFollow: () => { if (preferences.firstFollow(memberId, taipeiDate())) open(false); },
    speaking,
    onPlayPause: () => {
      if (speaking) { speech.pause(); return; }
      if (spoken.status === 'paused' && spoken.date === date) { speech.resume(); return; }
      if (current?.kind === 'ready') speech.start(date, current.post); else { speakWhenReady.current = true; ensureLoaded(); }
    },
    banner: devotionBanner(speaking, follow.enabled),
    followEnabled: follow.enabled,
    onFollowChange: (enabled) => preferences.setEnabled(memberId, enabled),
  } : undefined;
  return { devotion, onLastChapterNarrated, leave };
}
