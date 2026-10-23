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
export interface SwitchRecord { label: string; surface: string; key: string; ms: number; commitMs: number; renderMs?: number; layoutMs?: number; marks?: Record<string, number>; at: string }

const pending = new Map<string, { expected: string; label: string; startedAt: number; renderAt?: number; layoutAt?: number; marks?: Record<string, number> }>();

/**
 * Notes, for every switch on its way, when a part of the screen first renders after the tap (`marks` in its record):
 * a switch over the limit then shows which part's render took the time.
 */
export function markSwitch(name: string): void {
  if (!enabled || (pending.size === 0 && settling.size === 0)) return;
  const at = now();
  for (const started of pending.values()) { started.marks ??= {}; if (started.marks[name] === undefined) started.marks[name] = Math.round(at - started.startedAt); }
  // Shown but its frame not drawn yet: a render now is work after the commit holding that frame back (`name+`).
  for (const started of settling) { started.marks ??= {}; if (started.marks[`${name}+`] === undefined) started.marks[`${name}+`] = Math.round(at - started.startedAt); }
}
const settling = new Set<{ startedAt: number; marks?: Record<string, number> }>();

/** One moment outside any switch (e.g. when an answer asked ahead came back), as ms since the app's JS started. */
export function noteMoment(label: string, key: string): void {
  if (!enabled) return;
  records.push({ label, surface: 'note', key, ms: Math.round(now()), commitMs: 0, at: new Date().toISOString() });
}
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
  settling.add(started);
  // The content is committed; the next frame is the one that draws it.
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (run: () => void) => setTimeout(run, 0);
  frame(() => {
    settling.delete(started);
    records.push({ label: started.label, surface, key: shown, ms: Math.round(now() - started.startedAt), commitMs: Math.round(committedAt - started.startedAt), renderMs: since(started.renderAt), layoutMs: since(started.layoutAt), marks: started.marks, at: new Date().toISOString() });
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
