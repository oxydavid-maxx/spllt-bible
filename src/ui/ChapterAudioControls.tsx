// ChapterAudioControls.tsx
// Real main-App reader audio controls for the chapter the reader is ACTUALLY on.
//
// Seam, unchanged in shape:
//   contentCapabilityClient    -> ask the service about THIS (version, chapter)   (review 119 R1)
//   resolveChapterAudioSession -> AudioAvailability + chapter source
//   createChapterBoundPlayback -> AudioPlaybackImplementation
//   createAudioSession         -> the seam that was already waiting
//
// Review 119 corrections implemented here:
//   R1  the component now really CALLS the capability client for the current selection and feeds the
//       result to the resolver. Previously the client would have been an exported function nobody ran,
//       and the resolver was driven by a hardcoded chapter.
//   R2  every selection change cancels the previous request and bumps a generation, so a slow earlier
//       response can never be applied to the chapter now on screen. Results are additionally keyed by
//       the selection they belong to before they are used.
//   R4  the per-chapter binding no longer destroys the hook-owned native player, and a rejected action
//       from an OLD binding neither disposes the new one nor shows its error on the new chapter.
//   R5  the surface shows chapter, publisher and edition. No internal approval terminology, and no raw
//       HTTP status or exception text.

import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAudioPlayer, type AudioStatus } from 'expo-audio';
import { theme } from './Theme';
import { isAuthorizedAudioEnabled, isQaTestAudioEnabled, resolveChapterAudioSession, verseAtPosition } from '../services/audioChapterResolver';
import { createCapabilityCoordinator, type CapabilityCoordinator, type CapabilityOutcome } from '../services/contentCapabilityClient';
import { getAuthSnapshot, useAuthSnapshot, type AuthSession } from '../services/authSession';
import { validateCapability } from '../domain/chapterAudioContract';
import { createChapterBoundPlayback, type ChapterBoundPlayback } from '../services/expoAudioPlayback';
import { createAudioSession } from '../services/audioSession';
import { formatReferenceZhTw } from '../domain/scriptureReference';
import type { AutoplayIntent } from '../services/readerAutoplayController';
import type { ResolutionStatus } from '../domain/chapterAudioContract';

// STATIC reads, and they must stay static. Expo's babel transform replaces only literal
// process.env.EXPO_PUBLIC_* MEMBER EXPRESSIONS at build time. RC14m shipped this component reading a
// passed-in process.env object and indexing it dynamically, so at runtime the value was undefined, the
// QA source never armed, and the reader correctly showed the pending branch instead of a player. The
// component had shipped and rendered; only the flag read was wrong. Do not reintroduce a dynamic lookup.
const QA_TEST_AUDIO_FLAG = process.env.EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO;
const FIXTURE_FLAG = process.env.EXPO_PUBLIC_QINGMU_FIXTURE;
const AUDIO_AUTHORIZED_FLAG = process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED;
const API_BASE_URL_FLAG = process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL;
const BUILD_TIME_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: QA_TEST_AUDIO_FLAG,
  EXPO_PUBLIC_QINGMU_FIXTURE: FIXTURE_FLAG,
  EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: AUDIO_AUTHORIZED_FLAG,
};

// Expo AudioPlayer extends SharedObject<AudioEvents>, whose inherited declaration is not resolved
// in this dependency layout. Keep the exact public event contract without weakening payload types.
interface PlaybackStatusEmitter {
  addListener(event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void): { remove(): void };
}

export interface ChapterAudioAutoplayContextValue {
  /** Provider presence is explicit so standalone chapter controls keep their old shape. */
  available: boolean;
  enabled: boolean;
  intent: AutoplayIntent | null;
  notice: string | null;
  cancel(): void;
  toggle(): void;
  onPlaybackStarted(chapterUsfm: string): void;
  onPlaybackPaused(chapterUsfm: string): void;
  onPlaybackEnded(chapterUsfm: string): void;
  onPlaybackError(chapterUsfm: string): void;
  onAutoplayUnavailable(chapterUsfm: string, status: ResolutionStatus): void;
  /** Verse currently narrated in `chapterUsfm` (null = none). Emitted only when it changes. */
  onPlayingVerse?(chapterUsfm: string, verse: number | null): void;
  /** Narration speed, applied to the live player and remembered per member. */
  speed?: number;
}

const noAutoplay: ChapterAudioAutoplayContextValue = {
  available: false,
  enabled: false,
  intent: null,
  notice: null,
  cancel: () => {},
  toggle: () => {},
  onPlaybackStarted: () => {},
  onPlaybackPaused: () => {},
  onPlaybackEnded: () => {},
  onPlaybackError: () => {},
  onAutoplayUnavailable: () => {},
};

export const ChapterAudioAutoplayContext = createContext<ChapterAudioAutoplayContextValue>(noAutoplay);
export const useChapterAudioAutoplay = (): ChapterAudioAutoplayContextValue => useContext(ChapterAudioAutoplayContext);

/** Compact toolbar switch kept outside the fixed 48dp audio slot. Looks like the system
 * settings switch (green track, knob right = on; grey track, knob left = off) so the state
 * is readable without decoding a colour convention. Tapping only changes the setting. */
export function ChapterAudioAutoplayToggle({ active = true }: { active?: boolean }) {
  const autoplay = useChapterAudioAutoplay();
  if (!active || !autoplay.available) return null;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="連讀"
      accessibilityHint={autoplay.enabled ? '目前開啟，點一下關閉連讀' : '目前關閉，點一下開啟連讀；按播放才開始朗讀'}
      accessibilityState={{ checked: autoplay.enabled }}
      onPress={autoplay.toggle}
      style={styles.autoplayToggle}
    >
      <View testID="autoplay-track" style={[styles.autoplayTrack, autoplay.enabled ? styles.autoplayTrackOn : styles.autoplayTrackOff]}>
        <View testID="autoplay-knob" style={[styles.autoplayKnob, autoplay.enabled ? styles.autoplayKnobOn : styles.autoplayKnobOff]} />
      </View>
      <Text style={[styles.autoplayToggleText, autoplay.enabled ? styles.autoplayToggleTextOn : styles.autoplayToggleTextOff]}>連讀</Text>
    </Pressable>
  );
}

/** Stop/error notice rendered outside the interactive toolbar so it cannot cover controls. */
export function ChapterAudioAutoplayNotice({ active = true }: { active?: boolean }) {
  const autoplay = useChapterAudioAutoplay();
  if (!active || !autoplay.available || !autoplay.notice) return null;
  return (
    <View style={styles.autoplayNoticeRow}>
      <Text accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.autoplayNoticeText}>
        {autoplay.notice}
      </Text>
    </View>
  );
}

/** The selection this component answers for. Identity, not a loose pair of strings. */
/** Diagnostics stay off the product surface (R5) but reach logcat: a first-open failure the retry then clears is otherwise invisible to support. */
function logUnavailable(chapterUsfm: string, versionId: number | null, outcome: CapabilityOutcome): void {
  if (outcome.kind === 'unavailable') console.warn(`[chapter-audio] ${chapterUsfm} v${versionId ?? 'none'} ${outcome.status} retryable=${outcome.retryable} ${outcome.diagnostic ?? ''}`);
}

export function selectionKey(versionId: number | null, chapterUsfm: string): string {
  return `${versionId ?? 'none'}::${chapterUsfm.trim().toUpperCase()}`;
}

export interface ChapterAudioControlsHandle {
  /** Pause the currently bound source before yielding audio focus to an external reader. */
  pause(): Promise<void>;
}

export interface ChapterAudioControlsProps {
  chapterUsfm: string;
  versionId: number | null;
  /** @deprecated Attribution belongs to the Reader's More/version information. */
  translationName?: string;
  env?: Record<string, string | undefined>;
  baseUrl?: string;
  coordinator?: CapabilityCoordinator;
  fetchImpl?: typeof fetch;
  compact?: boolean;
  active?: boolean;
  bottomCell?: boolean;
  detailsVisible?: boolean;
  onDetailsClose?: () => void;
  onPlaybackStarted?: (chapterUsfm: string) => void;
  onPlaybackPaused?: (chapterUsfm: string) => void;
  onPlaybackEnded?: (chapterUsfm: string) => void;
  onPlaybackError?: (chapterUsfm: string) => void;
}

export const ChapterAudioControls = forwardRef<ChapterAudioControlsHandle, ChapterAudioControlsProps>(function ChapterAudioControls({
  chapterUsfm,
  versionId,
  env = BUILD_TIME_ENV,
  baseUrl = API_BASE_URL_FLAG ?? '',
  coordinator,
  fetchImpl,
  active = true,
  bottomCell = false,
  onPlaybackStarted,
  onPlaybackPaused,
  onPlaybackEnded,
  onPlaybackError,
}, ref) {
  const autoplay = useChapterAudioAutoplay();
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const callbacksRef = useRef({ onPlaybackStarted, onPlaybackPaused, onPlaybackEnded, onPlaybackError });
  callbacksRef.current = { onPlaybackStarted, onPlaybackPaused, onPlaybackEnded, onPlaybackError };
  const qaEnabled = isQaTestAudioEnabled(env);
  const audioAuthorized = isAuthorizedAudioEnabled(env);
  const key = selectionKey(versionId, chapterUsfm);

  // Review 121 C6. The chapter route is authenticated, so this request must carry the signed-in
  // identity through the SAME boundary the rest of the App uses. The session is held in a ref that the
  // coordinator reads at request time and re-reads at response time, so a sign-in, sign-out, account
  // switch or token refresh mid-flight discards the answer instead of applying someone else's result.
  // Review 121 follow-up. Reading only .session was wrong: authSession keeps the SAME session object
  // when it marks a session 'expired', so an expiry changed nothing here - the key stayed identical and
  // a stale answer, and the player it drove, survived. Validity is decided by the whole auth state, and
  // the key carries the auth epoch so that signing back in with the SAME token is still a new identity
  // rather than a resumption of the old one.
  const auth = useAuthSnapshot();
  const authValid = auth.status === 'signed-in' && auth.session !== null
    && (auth.expiresAt === null || auth.expiresAt > Math.floor(Date.now() / 1000));
  const activeSession = authValid ? auth.session : null;
  const sessionRef = useRef<AuthSession | null>(activeSession);
  sessionRef.current = activeSession;
  const sessionKey = activeSession
    ? `${auth.epoch ?? 0}::${activeSession.memberId}::${activeSession.sessionToken}`
    : `signed-out::${auth.epoch ?? 0}`;

  const coordinatorRef = useRef<CapabilityCoordinator | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = coordinator
      ?? createCapabilityCoordinator({ baseUrl, fetchImpl, getSession: () => sessionRef.current });
  }

  // Results are stored WITH the selection they belong to. Comparing that key at read time is the last
  // defence against showing one chapter's answer under another chapter's heading (R2).
  const [answer, setAnswer] = useState<{ key: string; sessionKey: string; outcome: CapabilityOutcome } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const replayRequest = useRef<{ key: string; sessionKey: string; attempt: number } | null>(null);
  const playRequest = useRef<object | null>(null);
  const liveScope = useRef({ key, sessionKey, active });
  liveScope.current = { key, sessionKey, active };

  const scopeIsCurrent = () => liveScope.current.active && liveScope.current.key === key
    && liveScope.current.sessionKey === sessionKey;
  const authIsCurrent = () => {
    if (!audioAuthorized) return true; // preserve the separately gated QA source path
    const latest = getAuthSnapshot();
    return latest.status === 'signed-in' && latest.session !== null
      && (latest.expiresAt === null || latest.expiresAt > Math.floor(Date.now() / 1000))
      && `${latest.epoch}::${latest.session.memberId}::${latest.session.sessionToken}` === sessionKey;
  };

  useEffect(() => {
    replayRequest.current = null;
    playRequest.current = null;
    return () => { playRequest.current = null; };
  }, [key, sessionKey, active]);

  useEffect(() => {
    const coord = coordinatorRef.current;
    if (!coord || !active || !audioAuthorized || !chapterUsfm || versionId === null) {
      setAnswer(null);
      return undefined;
    }
    let applied = false;
    // clear immediately: while the new chapter is resolving, the previous chapter's answer must not
    // remain on screen even for one frame
    setAnswer(null);
    void coord.request({ versionId, usfm: chapterUsfm }).then((outcome) => {
      if (outcome.kind === 'stale') return; // superseded; never applied
      if (applied) return;
      if (outcome.kind !== 'playable') replayRequest.current = null;
      logUnavailable(chapterUsfm, versionId, outcome); setAnswer({ key: selectionKey(versionId, chapterUsfm), sessionKey, outcome });
    });
    return () => {
      applied = true;
      // leaving this selection - chapter change, version change, or unmount - abandons the request so a
      // late response cannot revive playback for a chapter the reader already left
      coord.cancel();
    };
  }, [key, sessionKey, active, audioAuthorized, chapterUsfm, versionId, retryNonce]);

  const current = active && answer && answer.key === key && answer.sessionKey === sessionKey ? answer.outcome : null;
  const capability = current && current.kind === 'playable' ? current.capability : null;

  const resolved = useMemo(
    () => resolveChapterAudioSession({ chapterUsfm, versionId, qaTestAudioEnabled: qaEnabled, audioAuthorized, capability }),
    [chapterUsfm, versionId, qaEnabled, audioAuthorized, capability],
  );

  // ONE player for the component's lifetime, driven by replace(). expo-audio releases the player it
  // owns on UNMOUNT, and this component stays mounted across chapter changes.
  const player = useAudioPlayer(null, { updateInterval: 500 });

  // Applied to the live player rather than only at prepare time, so changing speed mid-chapter
  // takes effect on the sentence being read instead of the next one. Pitch correction stays on:
  // scripture read aloud at 1.5x should still sound like a person.
  const requestedSpeed = autoplay.speed ?? 1;
  useEffect(() => {
    try {
      player.shouldCorrectPitch = true;
      player.playbackRate = requestedSpeed;
    } catch { /* a player that has not prepared yet picks the rate up on the next binding */ }
  }, [player, requestedSpeed, resolved.source?.uri]);
  const playbackRef = useRef<ChapterBoundPlayback | null>(null);
  // Expo's didJustFinish is emitted once; currentStatus does not retain it.
  const finishedBinding = useRef<ChapterBoundPlayback | null>(null);
  const eofNotifiedBinding = useRef<ChapterBoundPlayback | null>(null);
  const playbackSelectionRef = useRef('');
  // bumped whenever the binding changes, so an action that started under an older binding can tell
  const bindingGeneration = useRef(0);
  const [progress, setProgress] = useState({ positionSeconds: 0, durationSeconds: 0, playing: false, loaded: false, buffering: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [needsRetry, setNeedsRetry] = useState(false);
  const autoPlayClaimed = useRef<number | null>(null);
  // Reading highlight: last verse we told the reader about, per chapter binding, so the reader hears
  // one message per verse change instead of one per 500 ms status tick.
  const playingVerseRef = useRef<{ chapter: string; verse: number | null } | null>(null);
  const notifyPlayingVerse = (chapter: string, verse: number | null) => {
    const last = playingVerseRef.current;
    if (last && last.chapter === chapter && last.verse === verse) return;
    playingVerseRef.current = { chapter, verse };
    autoplayRef.current.onPlayingVerse?.(chapter, verse);
  };

  const notifyPlaybackStarted = (chapter: string) => {
    autoplayRef.current.onPlaybackStarted(chapter);
    callbacksRef.current.onPlaybackStarted?.(chapter);
  };
  const notifyPlaybackPaused = (chapter: string) => {
    autoplayRef.current.onPlaybackPaused(chapter);
    callbacksRef.current.onPlaybackPaused?.(chapter);
  };
  const notifyPlaybackEnded = (chapter: string) => {
    autoplayRef.current.onPlaybackEnded(chapter);
    callbacksRef.current.onPlaybackEnded?.(chapter);
  };
  const notifyPlaybackError = (chapter: string) => {
    autoplayRef.current.onPlaybackError(chapter);
    callbacksRef.current.onPlaybackError?.(chapter);
  };

  // Stop the exact player instance when it is replaced or the component goes away. Deliberately
  // belt-and-braces with the binding effect below: a player that outlives its chapter is the worst
  // failure this component can have.
  useEffect(() => {
    const instance = player as unknown as { pause?: () => void };
    return () => {
      try { instance?.pause?.(); } catch { /* a player already released by the platform is fine */ }
    };
  }, [player]);

  // bind one playback per chapter; DETACH on chapter change, never destroy the shared player (R4)
  useEffect(() => {
    const p = player as unknown as { pause?: () => void; replace?: (s: unknown) => void };
    bindingGeneration.current += 1;
    finishedBinding.current = null;
    eofNotifiedBinding.current = null;
    const generation = bindingGeneration.current;
    setFailure(null);
    setNeedsRetry(false);
    setProgress(previous => ({ ...previous, positionSeconds: 0, durationSeconds: 0, playing: false, buffering: Boolean(resolved.source) }));
    if (!resolved.source) {
      try { p?.pause?.(); } catch { /* already released */ }
      playbackRef.current?.dispose();
      playbackRef.current = null;
      playbackSelectionRef.current = '';
      return undefined;
    }
    // ownsPlayer is deliberately NOT set: the hook owns this player and releases it on unmount.
    const bound = createChapterBoundPlayback(player as never, resolved.source.chapterUsfm);
    playbackRef.current = bound;
    playbackSelectionRef.current = `${key}::${resolved.source.uri}`;
    const bindingIsCurrent = () => bindingGeneration.current === generation && playbackRef.current === bound
      && !bound.disposed && scopeIsCurrent() && authIsCurrent();
    const reportPlaybackError = () => {
      if (!bindingIsCurrent()) return;
      try { p.pause?.(); } catch { /* the error path must still show the retry state */ }
      setProgress(previous => ({ ...previous, playing: false, buffering: false, loaded: false }));
      setFailure('朗讀暫時無法播放，請重試。');
      setNeedsRetry(true);
      notifyPlaybackError(chapterUsfm);
    };
    // Expo reports decoder/network failures after play() has returned. Polling currentStatus loses
    // these one-shot errors; subscribe per binding and retire the exact listener with that binding.
    const subscription = (player as unknown as PlaybackStatusEmitter).addListener('playbackStatusUpdate', status => {
      if (!bindingIsCurrent()) return;
      if (status.error) { reportPlaybackError(); return; }
      if (typeof status.currentTime === 'number') notifyPlayingVerse(chapterUsfm, verseAtPosition(resolved.source?.verseTiming, status.currentTime));
      if (status.didJustFinish) {
        notifyPlayingVerse(chapterUsfm, null);
        finishedBinding.current = bound;
        if (eofNotifiedBinding.current !== bound) {
          eofNotifiedBinding.current = bound;
          notifyPlaybackEnded(chapterUsfm);
        }
      }
      setProgress(bound.getProgress());
    });
    const freshSource = !audioAuthorized || (capability !== null && versionId !== null
      && validateCapability(capability, { versionId, usfm: chapterUsfm }, Date.now()).ok);
    const replay = replayRequest.current;
    const shouldReplay = replay?.key === key && replay.sessionKey === sessionKey && replay.attempt === retryNonce;
    let prepared = false;
    try {
      if (freshSource) { p.replace?.({ uri: resolved.source.uri }); prepared = true; }
    } catch { reportPlaybackError(); }
    if (shouldReplay) {
      replayRequest.current = null;
      if (prepared && bindingIsCurrent()) {
        // replace() calls the platform's prepare; play queues playback until loading completes.
        void playBoundWhenCurrent(bound, resolved.availability, capability)
          .then(started => { if (started) notifyPlaybackStarted(chapterUsfm); })
          .catch(reportPlaybackError);
      }
    }
    return () => {
      subscription.remove();
      notifyPlayingVerse(chapterUsfm, null);
      try { p?.pause?.(); } catch { /* already released */ }
      bound.dispose();
      if (playbackRef.current === bound) {
        playbackRef.current = null;
        playbackSelectionRef.current = '';
      }
    };
  }, [player, key, sessionKey, active, resolved.source?.chapterUsfm, resolved.source?.uri, retryNonce]);

  // Progress is polled from the REAL player, never simulated. A paused or idle player reports the
  // same numbers on every tick, and returning a fresh object each time made React repaint the whole
  // reader twice a second whether or not anything was playing. Returning the PREVIOUS state object
  // when nothing moved lets React bail out of the render: measured on a Pixel, an open but silent
  // reader went from 15.1% of a core to roughly what the home screen costs.
  useEffect(() => {
    if (!resolved.source) return undefined;
    const id = setInterval(() => {
      const bound = playbackRef.current;
      if (!bound || bound.disposed) return;
      const next = bound.getProgress();
      setProgress((previous) => previous.positionSeconds === next.positionSeconds
        && previous.durationSeconds === next.durationSeconds && previous.playing === next.playing
        && previous.loaded === next.loaded && previous.buffering === next.buffering ? previous : next);
    }, 500);
    return () => clearInterval(id);
  }, [resolved.source?.uri]);

  // Effects replace the binding after render. Never memoize that ref snapshot:
  // two loaded chapters can keep loaded=true and leave a cached session stale.
  const currentPlaybackBinding = () => {
    if (!scopeIsCurrent()) return undefined;
    const bound = playbackRef.current;
    const expectedSelection = resolved.source ? `${key}::${resolved.source.uri}` : '';
    return bound && !bound.disposed && expectedSelection
      && playbackSelectionRef.current === expectedSelection ? bound : undefined;
  };
  const playBoundWhenCurrent = async (bound: ChapterBoundPlayback | undefined, availability: typeof resolved.availability, confirmed: typeof capability, canContinue?: () => boolean): Promise<boolean> => {
    const generation = bindingGeneration.current;
    const mayPlay = () => Boolean(bound && !bound.disposed && playbackRef.current === bound
      && bindingGeneration.current === generation && scopeIsCurrent() && authIsCurrent()
      && (canContinue?.() ?? true)
      && (!audioAuthorized || (confirmed !== null && versionId !== null
        && validateCapability(confirmed, { versionId, usfm: chapterUsfm }, Date.now()).ok)));
    if (!mayPlay() || !bound) return false;
    const nativeProgress = bound.getProgress();
    if (finishedBinding.current === bound || (nativeProgress.durationSeconds > 0
      && nativeProgress.positionSeconds >= nativeProgress.durationSeconds && !nativeProgress.playing)) {
      // Native EOF can have isLoaded=false. That is not a failed stream and does
      // not require replace(): rewind, then recheck the exact binding after await.
      await player.seekTo(0);
      if (!mayPlay()) return false;
      finishedBinding.current = null;
      eofNotifiedBinding.current = null;
    }
    await createAudioSession(availability, bound).play();
    return mayPlay();
  };
  // Autoplay intent is an action request, not a source-binding identity. Keep it in this separate
  // effect so consuming the intent after play starts cannot tear down a live native player.
  useEffect(() => {
    const token = autoplay.intent?.token ?? null;
    const requestedChapter = autoplay.intent?.usfm?.trim().toUpperCase() ?? null;
    if (!autoplay.available || !autoplay.enabled || token === null || requestedChapter !== chapterUsfm.trim().toUpperCase()
      || !resolved.source || autoPlayClaimed.current === token) return;
    const bound = currentPlaybackBinding();
    if (!bound) return;
    autoPlayClaimed.current = token;
    void playBoundWhenCurrent(bound, resolved.availability, capability, () => {
      const latest = autoplayRef.current;
      return latest.available && latest.enabled && latest.intent?.token === token
        && latest.intent.usfm.trim().toUpperCase() === requestedChapter;
    })
      .then(started => { if (started) notifyPlaybackStarted(chapterUsfm); })
      .catch(() => {
        // The binding listener reports platform errors with the product-safe message and ownership
        // checks. A rejected play still needs the same path when the player rejects synchronously.
        notifyPlaybackError(chapterUsfm);
      });
  }, [autoplay.available, autoplay.enabled, autoplay.intent?.token, autoplay.intent?.usfm,
    chapterUsfm, resolved.source?.uri]);
  // Expiry may forbid starting/seeking a stream, but must never forbid stopping this live binding.
  // An old chapter's callback has no current binding and cannot pause its successor.
  const pauseCurrentPlayback = async () => {
    const bound = currentPlaybackBinding();
    if (!bound) return;
    await bound.pause();
    notifyPlaybackPaused(chapterUsfm);
  };
  useImperativeHandle(ref, () => ({ pause: pauseCurrentPlayback }));

  const playCurrentPlayback = async () => {
    if (!scopeIsCurrent() || !authIsCurrent() || playRequest.current) return;
    const operation = {};
    playRequest.current = operation;
    const generation = bindingGeneration.current;
    const bound = currentPlaybackBinding();
    try {
      const fresh = !audioAuthorized || (capability !== null && versionId !== null
        && validateCapability(capability, { versionId, usfm: chapterUsfm }, Date.now()).ok);
      if (fresh) {
        const started = await playBoundWhenCurrent(bound, resolved.availability, capability);
        if (started) notifyPlaybackStarted(chapterUsfm);
        return;
      }
      if (versionId === null || !coordinatorRef.current) return;
      // Expiry is a request to reconfirm this source, not a playback error. Keep
      // the paused binding mounted while the same coordinator refreshes metadata.
      const outcome = await coordinatorRef.current.request({ versionId, usfm: chapterUsfm });
      // Diagnostics stay off the product surface (R5) but must reach logcat: a first-open failure that
      // the retry then clears is otherwise invisible to support.
      if (playRequest.current !== operation || generation !== bindingGeneration.current
        || !scopeIsCurrent() || !authIsCurrent() || outcome.kind === 'stale') return;
      setFailure(null);
      setNeedsRetry(false);
      if (outcome.kind === 'playable') {
        const next = resolveChapterAudioSession({ chapterUsfm, versionId, qaTestAudioEnabled: qaEnabled, audioAuthorized, capability: outcome.capability });
        if (bound && next.source?.uri === resolved.source?.uri) {
          logUnavailable(chapterUsfm, versionId, outcome); setAnswer({ key, sessionKey, outcome });
          const started = await playBoundWhenCurrent(bound, next.availability, outcome.capability);
          if (started) notifyPlaybackStarted(chapterUsfm);
          return;
        }
        // A changed URI must be prepared by the normal binding effect before
        // satisfying this same play intent. No extra user tap is required.
        replayRequest.current = { key, sessionKey, attempt: retryNonce };
      } else replayRequest.current = null;
      logUnavailable(chapterUsfm, versionId, outcome); setAnswer({ key, sessionKey, outcome });
    } finally { if (playRequest.current === operation) playRequest.current = null; }
  };

  const run = (label: string, action: () => Promise<void>) => () => {
    setFailure(null);
    const startedUnder = bindingGeneration.current;
    void Promise.resolve().then(action).catch(() => {
      // R4: an action that was started on a PREVIOUS chapter must not touch the current one. It does
      // not dispose the live binding and its error is not shown under the new chapter's heading.
      if (bindingGeneration.current !== startedUnder || !scopeIsCurrent() || !authIsCurrent()) return;
      // R5: no raw exception text on a product surface aimed at teenagers.
      setFailure(`${label}失敗，請再試一次`);
      if (label === '播放') setNeedsRetry(true);
    });
  };

  const retryPlayback = () => {
    if (!scopeIsCurrent() || !authIsCurrent() || replayRequest.current) return;
    // Revalidate via the existing chapter API, then rebind/prepare even if it returns the same URI.
    // Never replay the old capability simply because its error message was cleared.
    replayRequest.current = { key, sessionKey, attempt: retryNonce + 1 };
    setFailure(null);
    setAnswer(null);
    setRetryNonce(value => value + 1);
  };

  const label = resolved.source?.chapterLabel ?? formatReferenceZhTw(chapterUsfm);
  const hasSource = Boolean(resolved.source);
  const canRetry = authValid && (needsRetry || (!hasSource && current?.kind === 'unavailable' && current.retryable));
  const noAudio = !hasSource && current?.kind === 'unavailable' && !current.retryable;
  const loading = !hasSource && !canRetry && !noAudio;
  const slotLabel = loading
    ? (!authValid ? '登入後即可使用朗讀' : '正在載入朗讀來源')
    : noAudio ? '本章沒有朗讀' : canRetry ? `重試${label}語音` : progress.playing ? `暫停${label}語音` : `播放${label}語音`;

  const reportedAutoUnavailable = useRef<number | null>(null);
  const currentUnavailableStatus = current?.kind === 'unavailable' ? current.status : undefined;
  useEffect(() => {
    const unavailable = currentUnavailableStatus;
    if (!autoplay.available || !autoplay.intent || !active || !unavailable) return;
    if (reportedAutoUnavailable.current === autoplay.intent.token) return;
    if (autoplay.intent.usfm.trim().toUpperCase() !== chapterUsfm.trim().toUpperCase()) return;
    reportedAutoUnavailable.current = autoplay.intent.token;
    autoplay.onAutoplayUnavailable(chapterUsfm, unavailable);
  }, [autoplay.available, autoplay.intent?.token, autoplay.intent?.usfm, active, chapterUsfm, currentUnavailableStatus]);
  useEffect(() => {
    if (!active) autoplay.cancel();
  }, [active, autoplay.cancel]);

  // One persistent player and one control. Pause resumes the same native position;
  // Expired metadata is reconfirmed in place; native errors explicitly reprepare.
  return (
    <View
      style={[styles.host, bottomCell && styles.bottomHost]}
      accessibilityLabel={`章節語音：${label}`}
      {...(!active ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const } : {})}
    >
      <View
        style={[styles.slot, bottomCell && styles.bottomSlot]}
        accessible={false}
        accessibilityLabel={slotLabel}
        accessibilityState={{ busy: loading }}
        {...(!active ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const } : {})}
      >
      {active && loading ? <ActivityIndicator accessibilityLabel={slotLabel} color={theme.colors.primary} /> : null}
      {active && noAudio ? <>
        <MaterialCommunityIcons accessible accessibilityLabel={slotLabel} name="volume-off" size={21} color={theme.colors.muted} />
        {bottomCell ? <Text style={styles.bottomLabel}>無朗讀</Text> : null}
      </> : null}
      {active && (hasSource || canRetry) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bottomCell ? (canRetry ? '重試' : progress.playing ? '暫停' : '播放') : canRetry ? `重試${label}語音` : progress.playing ? `暫停${label}語音` : `播放${label}語音`}
          accessibilityHint={bottomCell ? `${canRetry ? '重試' : progress.playing ? '暫停' : '播放'}${label}語音` : undefined}
          onPress={canRetry ? retryPlayback : run(progress.playing ? '暫停' : '播放', () => progress.playing ? pauseCurrentPlayback() : playCurrentPlayback())}
          android_ripple={{ color: theme.colors.primarySoft }}
          style={[styles.button, bottomCell && styles.bottomButton]}
        >
          <MaterialCommunityIcons name={canRetry ? 'replay' : progress.playing ? 'pause' : 'play'} size={21} color={theme.colors.primary} />
          {bottomCell ? <Text style={styles.bottomLabel}>{canRetry ? '重試' : progress.playing ? '暫停' : '播放'}</Text> : null}
        </Pressable>
      ) : null}
      {active && loading && bottomCell ? <Text style={styles.bottomLabel}>載入</Text> : null}
      </View>
      {active && failure ? (
        <Text
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`朗讀狀態：${failure}`}
          numberOfLines={1}
          style={styles.feedback}
        >{failure}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  host: { width: theme.control.tap, height: theme.control.tap, flexShrink: 0, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  bottomHost: { width: '100%', height: theme.control.tap, flex: 1 },
  slot: { width: theme.control.tap, height: theme.control.tap, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  bottomSlot: { width: '100%', height: theme.control.tap, flex: 1, flexDirection: 'row', gap: theme.spacing.xxs },
  // The collapsed overlay keeps a circular boundary; the bottom action row overrides it with borderless chrome.
  button: { width: theme.control.tap, height: theme.control.tap, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  bottomButton: { width: '100%', height: theme.control.tap, minHeight: theme.control.tap, flexDirection: 'row', gap: theme.spacing.xxs, borderWidth: 0, borderColor: 'transparent', borderRadius: 0, backgroundColor: 'transparent' },
  bottomLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  autoplayToggle: { minWidth: theme.control.tapCompact, minHeight: theme.control.tapCompact, flexShrink: 0, alignItems: 'center', justifyContent: 'center', gap: 3 },
  autoplayTrack: { width: 34, height: 18, borderRadius: 9, justifyContent: 'center' },
  autoplayTrackOn: { backgroundColor: theme.colors.primary },
  autoplayTrackOff: { backgroundColor: theme.colors.borderStrong },
  autoplayKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.white, position: 'absolute', top: 2 },
  autoplayKnobOn: { right: 2 },
  autoplayKnobOff: { left: 2 },
  autoplayToggleText: { fontSize: 10.5, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  autoplayToggleTextOn: { color: theme.colors.primary },
  autoplayToggleTextOff: { color: theme.colors.muted },
  autoplayNoticeRow: { flexShrink: 0, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, backgroundColor: theme.colors.surfaceMuted },
  autoplayNoticeText: { color: theme.colors.danger, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  feedback: { position: 'absolute', left: theme.control.tap + theme.spacing.xs, top: 0, color: theme.colors.danger ?? theme.colors.ink, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, maxWidth: 160 },
});
