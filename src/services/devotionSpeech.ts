import type { DevotionalPost } from './devotionClient';

/**
 * Reads the pastor's 靈修 aloud one paragraph at a time with the phone's own voice (維護者
 * 2026-10-14: a general AI voice for now; the pastor's own voice only after he agrees). The screen
 * lights the paragraph being read. Android's speech engine cannot pause, so pause stops the
 * paragraph and resume starts it again from its beginning.
 */

export interface SpeechEngine {
  speak(text: string, callbacks: { onDone: () => void; onStopped: () => void; onError: () => void }): void;
  stop(): void;
}

export interface DevotionSpeechSnapshot {
  readonly status: 'idle' | 'speaking' | 'paused' | 'done';
  /** The paragraph being read (or to resume), counted across every section; -1 when none. */
  readonly index: number;
  readonly date: string | null;
}

export interface DevotionSpeechUnit { section: number; paragraph: number; text: string }

/** Every paragraph in reading order; a section's heading is read before its first paragraph. */
export function speechUnits(post: DevotionalPost): DevotionSpeechUnit[] {
  const units: DevotionSpeechUnit[] = [];
  post.sections.forEach((section, sectionIndex) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      const lead = paragraphIndex === 0 ? `${sectionIndex === 0 ? `${post.title}。` : ''}${section.heading}。` : '';
      units.push({ section: sectionIndex, paragraph: paragraphIndex, text: `${lead}${paragraph}` });
    });
  });
  return units;
}

export function createDevotionSpeech(engine: SpeechEngine, onFinished: (date: string) => void) {
  let snapshot: DevotionSpeechSnapshot = Object.freeze({ status: 'idle', index: -1, date: null });
  let units: DevotionSpeechUnit[] = [];
  let token = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Omit<DevotionSpeechSnapshot, never>) => { snapshot = Object.freeze({ ...next }); listeners.forEach((listener) => listener()); };

  function speakFrom(index: number): void {
    const date = snapshot.date;
    if (!date) return;
    if (index >= units.length) { publish({ status: 'done', index: -1, date }); onFinished(date); return; }
    const mine = ++token;
    publish({ status: 'speaking', index, date });
    engine.speak(units[index].text, {
      // A stopped or superseded paragraph reports back too; only the current one moves the reading on.
      onDone: () => { if (mine === token) speakFrom(index + 1); },
      onStopped: () => undefined,
      onError: () => { if (mine === token) publish({ status: 'paused', index, date }); },
    });
  }

  return {
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
