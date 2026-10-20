// PROOF BRANCH ONLY (proof/flow21-diag): CI evidence for iOS flow 21's lost 積分 tap. Never merged.
// Fixture builds only; one short line per event, read back from the simulator log by run-flows.sh.
import { AppState } from 'react-native';

const on = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';

export function ciDiag(event: string, data?: Record<string, unknown>): void {
  if (!on) return;
  console.error(`CI_DIAG ${Date.now()} ${event} ${data ? JSON.stringify(data) : ''}`);
}

let started = false;
/** JS-thread stalls: a 100 ms tick that arrives late by more than 250 ms is logged with its delay. */
export function startCiStallMonitor(): void {
  if (!on || started) return;
  started = true;
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const late = now - last - 100;
    if (late > 250) ciDiag('js-stall', { late });
    last = now;
  }, 100);
  AppState.addEventListener('change', (state) => ciDiag('app-state', { state }));
}
