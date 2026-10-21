import type { DevotionalPost } from './devotionClient';
import { DEFAULT_DEVOTION_VOICE, type DevotionVoice } from '../domain/devotionVoice';

/**
 * Reads the 靈修 one paragraph at a time through an injected engine (Azure with device fallback
 * since 2026-10-16). Both engines use the same pronunciation and paragraph indices. The screen
 * lights the paragraph being read, or with Azure audio the sentence or two being heard (2026-10-21).
 * Android's speech engine cannot pause, so pause stops the paragraph and resume starts it again
 * from its beginning.
 */

/** `volume`: 0–1, matching the scripture recording just heard (devotionVolume); absent means full volume. */
export interface DevotionSpeechRequest { date: string; index: number; rate: number; voice: DevotionVoice; volume?: number }

export interface SpeechCallbacks {
  onDone: () => void; onStopped: () => void; onError: () => void;
  /** Share of the paragraph's audio played (0–1); null when it went to device speech, which reports no position. */
  onProgress?: (share: number | null) => void;
}

export interface SpeechEngine {
  speak(text: string, callbacks: SpeechCallbacks, request?: DevotionSpeechRequest): void;
  setRate?(rate: number): void;
  stop(): void;
}

export interface DevotionSpeechSnapshot {
  readonly status: 'idle' | 'speaking' | 'paused' | 'done';
  /** The paragraph being read (or to resume), counted across every section; -1 when none. */
  readonly index: number;
  readonly date: string | null;
  /**
   * The part of that paragraph being heard (readAlongPart): 0 its spoken heading, n ≥ 1 piece n - 1; -1 the whole
   * paragraph, while its audio is not yet playing or when device speech reads it. Changes only between parts.
   */
  readonly part: number;
}

export { speechUnits } from '../domain/devotionReading';
import { isSpokenSection, readAlongPart, readAlongPlan, speechUnits, type DevotionSpeechUnit, type ReadAlongUnit } from '../domain/devotionReading';
export type { DevotionSpeechUnit } from '../domain/devotionReading';

export function createDevotionSpeech(engine: SpeechEngine, onFinished: (date: string) => void) {
  let snapshot: DevotionSpeechSnapshot = Object.freeze({ status: 'idle', index: -1, date: null, part: -1 });
  let units: DevotionSpeechUnit[] = [];
  let spoken: boolean[] = [];
  let plan: ReadAlongUnit[] = [];
  let token = 0;
  let rate = 1;
  let volume = 1;
  let voice = DEFAULT_DEVOTION_VOICE;
  const listeners = new Set<() => void>();
  const publish = (next: Omit<DevotionSpeechSnapshot, never>) => { snapshot = Object.freeze({ ...next }); listeners.forEach((listener) => listener()); };

  function speakFrom(index: number): void {
    const date = snapshot.date;
    if (!date) return;
    while (index < units.length && (!spoken[index] || !units[index].text.trim())) index++;
    if (index >= units.length) { token += 1; publish({ status: 'done', index: -1, date, part: -1 }); onFinished(date); return; }
    const mine = ++token;
    publish({ status: 'speaking', index, date, part: -1 });
    engine.speak(units[index].text, {
      // A stopped or superseded paragraph reports back too; only the current one moves the reading on.
      onDone: () => { if (mine === token) speakFrom(index + 1); },
      onStopped: () => undefined,
      onError: () => { if (mine === token) publish({ status: 'paused', index, date, part: -1 }); },
      onProgress: (share) => {
        if (mine !== token || snapshot.status !== 'speaking') return;
        const part = share === null || !plan[index] ? -1 : readAlongPart(plan[index], share);
        if (part !== snapshot.part) publish({ ...snapshot, part });
      },
    }, { date, index, rate, voice, volume });
  }

  return {
    setRate(value: number) { if (value > 0 && value !== rate) { rate = value; engine.setRate?.(rate); } },
    /** Applies from the next paragraph; the version read does not change in the middle of a 靈修. */
    setVolume(value: number) { if (value > 0 && value <= 1) volume = value; },
    setVoice(value: DevotionVoice) {
      if (voice === value) return;
      voice = value;
      if (snapshot.status === 'speaking') { token += 1; engine.stop(); speakFrom(snapshot.index); }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Starts the day's 靈修 from its first paragraph read aloud (or `from`). */
    start(date: string, post: DevotionalPost, from = 0) {
      token += 1; engine.stop();
      units = speechUnits(post);
      spoken = units.map((unit) => isSpokenSection(post.sections[unit.section]?.heading ?? ''));
      plan = readAlongPlan(post);
      snapshot = Object.freeze({ status: 'idle', index: -1, date, part: -1 });
      speakFrom(Math.max(0, Math.min(from, units.length)));
    },
    pause() {
      if (snapshot.status !== 'speaking') return;
      token += 1; engine.stop();
      // Resuming reads the paragraph again from its start, so the whole paragraph is the one waiting.
      publish({ ...snapshot, status: 'paused', part: -1 });
    },
    resume() {
      if (snapshot.status !== 'paused') return;
      speakFrom(snapshot.index);
    },
    stop() {
      token += 1; engine.stop();
      publish({ status: 'idle', index: -1, date: null, part: -1 });
    },
  };
}

export type DevotionSpeech = ReturnType<typeof createDevotionSpeech>;
