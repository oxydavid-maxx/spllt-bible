import type { AudioStatus } from 'expo-audio';
import * as Speech from 'expo-speech';
import type { DevotionClientOptions } from './devotionClient';
import type { SpeechEngine } from './devotionSpeech';
import { createDevotionAudioEngine, type DevotionSegmentAudio } from './devotionAudioEngine';
import { createPrefetchingDevotionAudio, fetchDevotionAudio } from './devotionAudioClient';
import { createChapterBoundPlayback } from './expoAudioPlayback';
import { addAutoUpdateProbe } from './autoUpdateGuard';

// Expo's inherited SharedObject listener declaration is unresolved by this TS setup, as in ChapterAudioControls.
interface PlaybackStatusEmitter { addListener(event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void): { remove(): void } }

let fileSequence = 0;
// The device voice reads a devotion when the recorded audio is unavailable; while it speaks, a downloaded update
// waits (2026-10-21, src/services/autoUpdateGuard.ts). Registered once, on first use; the player path reports
// through createChapterBoundPlayback.
let speechProbeAdded = false;

export function createNativeDevotionEngine(connection: () => DevotionClientOptions | null): SpeechEngine {
  // expo-speech stop is asynchronous; a late stop must never cancel the replacement utterance.
  let speechToken = 0;
  let stopped = Promise.resolve();
  const device: SpeechEngine = {
    stop() { speechToken++; stopped = stopped.then(() => Speech.stop()).catch(() => undefined); },
    speak(text, callbacks, request) {
      if (!speechProbeAdded) { speechProbeAdded = true; addAutoUpdateProbe('朗讀中', () => Speech.isSpeakingAsync()); }
      const token = ++speechToken;
      void stopped.then(() => {
        if (token !== speechToken) return;
        Speech.speak(text, { language: 'zh-TW', rate: request?.rate ?? 1, volume: request?.volume ?? 1, onDone: callbacks.onDone, onStopped: callbacks.onStopped, onError: callbacks.onError });
      }).catch(() => { if (token === speechToken) callbacks.onError(); });
    },
  };
  const fetchAudio = createPrefetchingDevotionAudio(async (request, signal) => {
    const options = connection();
    if (!options) throw new Error('DEVOTIONAL_AUDIO_NO_SESSION');
    return fetchDevotionAudio(options, request, signal);
  });
  return createDevotionAudioEngine({ device, async loadAudio(request, signal): Promise<DevotionSegmentAudio> {
    const bytes = await fetchAudio(request, signal);
    // Lazy native modules: unavailable audio never needs a file/player, and no new dependency.
    const [{ File, Paths }, { createAudioPlayer }] = await Promise.all([import('expo-file-system'), import('expo-audio')]);
    if (signal.aborted) throw new Error('DEVOTIONAL_AUDIO_CANCELLED');
    const file = new File(Paths.cache, `qingmu-devotion-${Date.now()}-${++fileSequence}.mp3`);
    file.write(bytes);
    let player: ReturnType<typeof createAudioPlayer>;
    try { player = createAudioPlayer({ uri: file.uri }, { updateInterval: 250 }); }
    catch (error) { file.delete(); throw error; }
    // As loud as the scripture recording just heard (devotionVolume); the file itself is never changed.
    player.volume = request.volume ?? 1;
    const playback = createChapterBoundPlayback(player, `devotion:${request.date}:${request.index}`, undefined, { ownsPlayer: true });
    let rate = request.rate, disposed = false;
    let subscription: { remove(): void } | undefined;
    let rejectPlay: ((error: Error) => void) | undefined;
    return {
      async setRate(value) { rate = value; if (player.isLoaded && !disposed) await playback.setRate(value); },
      play(callbacks) {
        return new Promise<void>((resolve, reject) => {
          if (disposed) { reject(new Error('DEVOTIONAL_AUDIO_CANCELLED')); return; }
          rejectPlay = reject;
          let started = false;
          const start = () => {
            if (started || disposed) return;
            started = true;
            void playback.setRate(rate).then(() => { if (!disposed) return playback.play(); })
              .then(() => { if (!disposed) resolve(); }).catch(reject);
          };
          subscription = (player as unknown as PlaybackStatusEmitter).addListener('playbackStatusUpdate', status => {
            if (disposed) return;
            if (status.error) { reject(new Error('DEVOTIONAL_AUDIO_PLAYBACK')); callbacks.onError(); }
            else if (status.didJustFinish) callbacks.onDone();
            else if (status.isLoaded) {
              start();
              // The same 250 ms status the player already sends: the read-along needs no timer of its own.
              if (started && status.duration > 0) callbacks.onProgress?.(Math.min(1, Math.max(0, status.currentTime / status.duration)));
            }
          });
          if (player.isLoaded) start();
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true; subscription?.remove(); rejectPlay?.(new Error('DEVOTIONAL_AUDIO_CANCELLED'));
        try { playback.dispose(); } finally { if (file.exists) file.delete(); }
      },
    };
  } });
}
