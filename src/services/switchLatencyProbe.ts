import { useEffect } from 'react';

/**
 * How long a switch takes, from the tap to the frame that shows its content (光佑 2026-10-23: switches must feel
 * instant, at most 100 ms). Only the CI fixture build records anything (EXPO_PUBLIC_QINGMU_FIXTURE, inlined at build
 * time); every other build returns at the first line, keeps nothing and writes nothing.
 *
 * A tap names the content it expects (`switchStarted`); the screen reports what it now shows (`switchShown`, or the
 * hook). When the two meet, the time to the next frame is one record. The records go to a JSON file in the app's
 * Documents folder, one file per launch, which scripts/ios/check-switch-latency.ts reads from the simulator.
 * A tap whose content never shows leaves no record, so the check counts it as not measured (FAIL).
 */

const enabled = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
const now = (): number => globalThis.performance?.now?.() ?? Date.now();

/** `commitMs`: from the tap to the commit that shows the content (the rest of `ms` is waiting for the frame). */
export interface SwitchRecord { label: string; surface: string; key: string; ms: number; commitMs: number; at: string }

const pending = new Map<string, { expected: string; label: string; startedAt: number }>();
const records: SwitchRecord[] = [];
const fileName = `switch-latency-${Date.now()}.json`;
let writing: Promise<void> = Promise.resolve();

export function switchStarted(surface: string, expected: string, label: string): void {
  if (!enabled) return;
  pending.set(surface, { expected, label, startedAt: now() });
}

export function switchShown(surface: string, shown: string | null): void {
  if (!enabled || shown === null) return;
  const started = pending.get(surface);
  if (!started || started.expected !== shown) return;
  pending.delete(surface);
  const committedAt = now();
  // The content is committed; the next frame is the one that draws it.
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (run: () => void) => setTimeout(run, 0);
  frame(() => {
    records.push({ label: started.label, surface, key: shown, ms: Math.round(now() - started.startedAt), commitMs: Math.round(committedAt - started.startedAt), at: new Date().toISOString() });
    const text = JSON.stringify(records);
    writing = writing.then(async () => {
      const fs = await import('expo-file-system/legacy');
      if (fs.documentDirectory) await fs.writeAsStringAsync(`${fs.documentDirectory}${fileName}`, text);
    }).catch(() => undefined);
  });
}

/** Reports `shown` after every commit in which it changed. */
export function useSwitchShown(surface: string, shown: string | null): void {
  useEffect(() => { switchShown(surface, shown); }, [surface, shown]);
}

/** Tests only. */
export function switchLatencyRecords(): readonly SwitchRecord[] { return records; }
