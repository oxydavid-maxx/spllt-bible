import type { FetchBibleContent } from '@youversion/platform-react-native-expo-core';

/** The request shape used by the installed BibleReader.Content implementation. */
export function buildBibleContentPath(versionId: number, usfm: string): string {
  const reference = usfm.trim();
  if (!Number.isInteger(versionId) || versionId <= 0 || !reference) {
    throw new Error('Invalid Bible content request');
  }
  const params = new URLSearchParams({
    format: 'html',
    include_headings: 'true',
    include_notes: 'true',
  });
  return `/v1/bibles/${versionId}/passages/${reference}?${params.toString()}`;
}

export interface BibleContentPreloadInput {
  versionId: number;
  references: string[];
  /** The selected reference is put first so it warms before background chapters. */
  activeReferenceIndex?: number;
}

export interface BibleContentPreloadReceipt {
  attempted: number;
  completed: number;
  failed: number;
}

type Waiter = { generation: number; done: (success: boolean) => void };
type Task = { path: string; generation: number; waiters: Waiter[] };

export interface BibleContentPreloader {
  enqueue(input: BibleContentPreloadInput): Promise<BibleContentPreloadReceipt>;
  /** Invalidates queued work for a date/version generation. Native requests cannot be aborted safely. */
  cancel(): void;
}

export function createBibleContentPreloader(
  fetchBibleContent: FetchBibleContent,
  options: { maxConcurrent?: number } = {},
): BibleContentPreloader {
  const maxConcurrent = Math.max(1, Math.min(Math.floor(options.maxConcurrent ?? 2), 2));
  const queued = new Map<string, Task>();
  const active = new Map<string, Task>();
  let generation = 0;
  let running = 0;

  const schedule = (): void => {
    while (running < maxConcurrent) {
      const task = queued.values().next().value as Task | undefined;
      if (!task) return;
      queued.delete(task.path);
      active.set(task.path, task);
      running += 1;
      void fetchBibleContent({ path: task.path }).then(
        (response) => response.status >= 200 && response.status < 300,
        () => false,
      ).then((success) => {
        active.delete(task.path);
        running -= 1;
        for (const waiter of task.waiters) waiter.done(waiter.generation === generation ? success : false);
        schedule();
      });
    }
  };

  const enqueue = (input: BibleContentPreloadInput): Promise<BibleContentPreloadReceipt> => {
    const token = generation;
    const activeIndex = input.activeReferenceIndex ?? 0;
    const references = input.references
      .map((reference) => reference.trim())
      .filter(Boolean);
    const ordered = references.length === 0 ? [] : [
      references[activeIndex] ?? references[0],
      ...references.filter((_, index) => index !== (activeIndex >= 0 && activeIndex < references.length ? activeIndex : 0)),
    ];
    const paths = [...new Set(ordered.map((reference) => buildBibleContentPath(input.versionId, reference)))];
    if (paths.length === 0) return Promise.resolve({ attempted: 0, completed: 0, failed: 0 });
    return new Promise((resolve) => {
      let remaining = paths.length;
      let completed = 0;
      let failed = 0;
      const finish = (success: boolean): void => {
        if (success) completed += 1; else failed += 1;
        remaining -= 1;
        if (remaining === 0) resolve({ attempted: paths.length, completed, failed });
      };
      for (const path of paths) {
        const task = active.get(path) ?? queued.get(path);
        if (task) {
          task.waiters.push({ generation: token, done: finish });
        } else {
          const next: Task = { path, generation: token, waiters: [{ generation: token, done: finish }] };
          queued.set(path, next);
        }
      }
      schedule();
    });
  };

  const cancel = (): void => {
    generation += 1;
    const canceled = [...queued.values(), ...active.values()];
    for (const task of canceled) {
      for (const waiter of task.waiters) waiter.done(false);
      task.waiters = [];
    }
    queued.clear();
  };

  return { enqueue, cancel };
}
