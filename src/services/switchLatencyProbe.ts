import { useEffect, useLayoutEffect } from 'react';

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

/**
 * From the tap, in milliseconds: `renderMs` the first render that drew the content, `layoutMs` its layout effect (the
 * native tree committed and laid out), `commitMs` its passive effect, `ms` the next frame. Where the time goes when `ms`
 * is over the limit: rendering, layout, effects, or other work holding the frame back.
 */
export interface SwitchRecord { label: string; surface: string; key: string; ms: number; commitMs: number; renderMs?: number; layoutMs?: number; at: string }

const pending = new Map<string, { expected: string; label: string; startedAt: number; renderAt?: number; layoutAt?: number }>();
const records: SwitchRecord[] = [];
const fileName = `switch-latency-${Date.now()}.json`;
let writing: Promise<void> = Promise.resolve();

export function switchStarted(surface: string, expected: string, label: string): void {
  if (!enabled) return;
  pending.set(surface, { expected, label, startedAt: now() });
}

function matching(surface: string, shown: string | null) {
  const started = shown === null ? undefined : pending.get(surface);
  return started && started.expected === shown ? started : undefined;
}

export function switchShown(surface: string, shown: string | null): void {
  if (!enabled || shown === null) return;
  const started = matching(surface, shown);
  if (!started) return;
  pending.delete(surface);
  const committedAt = now();
  const since = (at: number | undefined) => at === undefined ? undefined : Math.round(at - started.startedAt);
  // The content is committed; the next frame is the one that draws it.
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (run: () => void) => setTimeout(run, 0);
  frame(() => {
    records.push({ label: started.label, surface, key: shown, ms: Math.round(now() - started.startedAt), commitMs: Math.round(committedAt - started.startedAt), renderMs: since(started.renderAt), layoutMs: since(started.layoutAt), at: new Date().toISOString() });
    const text = JSON.stringify(records);
    writing = writing.then(async () => {
      const fs = await import('expo-file-system/legacy');
      if (fs.documentDirectory) await fs.writeAsStringAsync(`${fs.documentDirectory}${fileName}`, text);
    }).catch(() => undefined);
  });
}

/** Reports `shown` after every commit in which it changed (and notes the render and layout on the way). */
export function useSwitchShown(surface: string, shown: string | null): void {
  if (enabled) { const started = matching(surface, shown); if (started && started.renderAt === undefined) started.renderAt = now(); }
  useLayoutEffect(() => {
    if (!enabled) return;
    const started = matching(surface, shown);
    if (started && started.layoutAt === undefined) started.layoutAt = now();
  }, [surface, shown]);
  useEffect(() => { switchShown(surface, shown); }, [surface, shown]);
}

/** Tests only. */
export function switchLatencyRecords(): readonly SwitchRecord[] { return records; }
