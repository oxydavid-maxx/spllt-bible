import { useEffect } from 'react';
import { holdAutoUpdate } from '../services/autoUpdateGuard';

/**
 * While `active`, a downloaded update waits instead of reloading the app (src/services/autoUpdateGuard.ts):
 * a panel that is open, an input that is not saved yet. Released on unmount, so a screen that goes away
 * never leaves the update held.
 */
export function useAutoUpdateHold(active: boolean, reason: string): void {
  useEffect(() => (active ? holdAutoUpdate(reason) : undefined), [active, reason]);
}
