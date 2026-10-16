import type { DevotionalPost } from './devotionClient';
import { DEFAULT_DEVOTION_VOICE, type DevotionVoice } from '../domain/devotionVoice';

/**
 * Reads the 靈修 one paragraph at a time through an injected engine (Azure with device fallback
 * since 2026-10-16). Both engines use the same pronunciation and paragraph indices. The screen
 * lights the paragraph being read. Android's speech engine cannot pause, so pause stops the
 * paragraph and resume starts it again from its beginning.
 */

export interface DevotionSpeechRequest { date: string; index: number; rate: number; voice: DevotionVoice }

export interface SpeechEngine {
  speak(text: string, callbacks: { onDone: () => void; onStopped: () => void; onError: () => void }, request?: DevotionSpeechRequest): void;
  setRate?(rate: number): void;
  stop(): void;
}

export interface DevotionSpeechSnapshot {
  readonly status: 'idle' | 'speaking' | 'paused' | 'done';
  /** The paragraph being read (or to resume), counted across every section; -1 when none. */
  readonly index: number;
  readonly date: string | null;
}

export { speechUnits } from '../domain/devotionReading';
import { speechUnits, type DevotionSpeechUnit } from '../domain/devotionReading';
export type { DevotionSpeechUnit } from '../domain/devotionReading';

export function createDevotionSpeech(engine: SpeechEngine, onFinished: (date: string) => void) {
  let snapshot: DevotionSpeechSnapshot = Object.freeze({ status: 'idle', index: -1, date: null });
  let units: DevotionSpeechUnit[] = [];
  let token = 0;
  let rate = 1;
  let voice = DEFAULT_DEVOTION_VOICE;
  const listeners = new Set<() => void>();
  const publish = (next: Omit<DevotionSpeechSnapshot, never>) => { snapshot = Object.freeze({ ...next }); listeners.forEach((listener) => listener()); };

  function speakFrom(index: number): void {
    const date = snapshot.date;
    if (!date) return;
    while (index < units.length && !units[index].text.trim()) index++;
    if (index >= units.length) { token += 1; publish({ status: 'done', index: -1, date }); onFinished(date); return; }
    const mine = ++token;
    publish({ status: 'speaking', index, date });
    engine.speak(units[index].text, {
      // A stopped or superseded paragraph reports back too; only the current one moves the reading on.
      onDone: () => { if (mine === token) speakFrom(index + 1); },
      onStopped: () => undefined,
      onError: () => { if (mine === token) publish({ status: 'paused', index, date }); },
    }, { date, index, rate, voice });
  }

  return {
    setRate(value: number) { if (value > 0 && value !== rate) { rate = value; engine.setRate?.(rate); } },
    setVoice(value: DevotionVoice) {
      if (voice === value) return;
      voice = value;
      if (snapshot.status === 'speaking') { token += 1; engine.stop(); speakFrom(snapshot.index); }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Starts the day's 靈修 from its first paragraph (or `from`). */
    start(date: string, post: DevotionalPost, from = 0) {
      token += 1; engine.stop();
      units = speechUnits(post);
      snapshot = Object.freeze({ status: 'idle', index: -1, date });
      speakFrom(Math.max(0, Math.min(from, units.length)));
    },
    pause() {
      if (snapshot.status !== 'speaking') return;
      token += 1; engine.stop();
      publish({ ...snapshot, status: 'paused' });
    },
    resume() {
      if (snapshot.status !== 'paused') return;
      speakFrom(snapshot.index);
    },
    stop() {
      token += 1; engine.stop();
      publish({ status: 'idle', index: -1, date: null });
    },
  };
}

export type DevotionSpeech = ReturnType<typeof createDevotionSpeech>;
