export interface AutoplayChapter {
  index: number;
  usfm: string;
  reference: string;
}

export interface AutoplayIntent extends AutoplayChapter {
  generation: number;
  token: number;
}

export type AutoplayDecision =
  | { kind: 'advance'; intent: AutoplayIntent }
  | { kind: 'stop'; reason: 'last' }
  | { kind: 'ignore'; reason: 'disabled' | 'stale' };

export interface ReaderAutoplayController {
  setEnabled(enabled: boolean): void;
  begin(chapter: AutoplayChapter): AutoplayIntent | null;
  onEof(chapter: AutoplayChapter, next: AutoplayChapter | null): AutoplayDecision;
  cancel(): void;
  isIntentCurrent(intent: AutoplayIntent): boolean;
}

export function createReaderAutoplayController(): ReaderAutoplayController {
  let enabled = true;
  let generation = 0;
  let token = 0;
  let active: AutoplayIntent | null = null;

  const sameChapter = (left: AutoplayChapter, right: AutoplayChapter) =>
    left.index === right.index && left.usfm.trim().toUpperCase() === right.usfm.trim().toUpperCase();

  return {
    setEnabled(next: boolean): void {
      if (typeof next !== 'boolean') return;
      if (enabled && !next) {
        generation += 1;
        active = null;
      }
      enabled = next;
    },
    begin(chapter: AutoplayChapter): AutoplayIntent | null {
      if (!enabled) return null;
      if (active && sameChapter(active, chapter)) return active;
      generation += 1;
      active = { ...chapter, generation, token: ++token };
      return active;
    },
    onEof(chapter: AutoplayChapter, next: AutoplayChapter | null): AutoplayDecision {
      if (!enabled) return { kind: 'ignore', reason: 'disabled' };
      if (!active || !sameChapter(active, chapter)) return { kind: 'ignore', reason: 'stale' };
      if (next === null) {
        active = null;
        generation += 1;
        return { kind: 'stop', reason: 'last' };
      }
      generation += 1;
      active = { ...next, generation, token: ++token };
      return { kind: 'advance', intent: active };
    },
    cancel(): void {
      generation += 1;
      active = null;
    },
    isIntentCurrent(intent: AutoplayIntent): boolean {
      return enabled && active !== null && active.token === intent.token && active.generation === intent.generation;
    },
  };
}
