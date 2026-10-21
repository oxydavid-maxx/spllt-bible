/**
 * What a downloaded update must not interrupt (光佑 2026-10-21). src/ui/admin/OtaUpdates.tsx puts a downloaded
 * update in place when the app comes back after 30 minutes away; before it reloads it asks here whether
 * anything is in use: narration or other playback running, a journal entry or other input not saved yet, a
 * panel open. Panels and inputs hold the update while they are open or unsaved (useAutoUpdateHold); players
 * register a probe that reads the real player when asked, so a track that ends by itself needs no event.
 *
 * Plain module state, no react-native: one app process has one set of holds. tests/tools/autoUpdateHolds.test.ts
 * fails when a new panel, input or player forgets to tell this module.
 */
type Probe = () => boolean | Promise<boolean>;

const holds = new Map<number, string>();
const probes = new Map<number, { reason: string; busy: Probe }>();
let nextId = 0;

/** Holds updates until the returned release is called (once; later calls do nothing). */
export function holdAutoUpdate(reason: string): () => void {
  const id = ++nextId;
  holds.set(id, reason);
  return () => { holds.delete(id); };
}

/** Asked at decision time; true means busy. A probe that throws is read as idle: a released player cannot play. */
export function addAutoUpdateProbe(reason: string, busy: Probe): () => void {
  const id = ++nextId;
  probes.set(id, { reason, busy });
  return () => { probes.delete(id); };
}

/** Why an update may not be put in place right now; empty when nothing is in use. */
export async function autoUpdateBlockers(): Promise<string[]> {
  const reasons = [...holds.values()];
  for (const probe of [...probes.values()]) {
    try { if (await probe.busy()) reasons.push(probe.reason); } catch { /* idle */ }
  }
  return reasons;
}
