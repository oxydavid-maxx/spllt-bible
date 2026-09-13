import { useLayoutEffect, useRef, useState } from 'react';
import type { ReaderSettingsSnapshot } from '@youversion/platform-react-native-expo-ui';

export interface ReaderPreferencesBinding {
  ownerId: string | null;
  settings: ReaderSettingsSnapshot | null;
  onChange(next: ReaderSettingsSnapshot): void;
}
type SettingsApi = Pick<typeof import('@youversion/platform-react-native-expo-ui'), 'getReaderSettings' | 'getDefaultReaderSettings' | 'setReaderSettings' | 'subscribeReaderSettings'>;
type Applied = { sdk: SettingsApi; ownerId: string | null | undefined; failed: boolean };
const sameSettings = (left: ReaderSettingsSnapshot, right: ReaderSettingsSnapshot) => left.fontSize === right.fontSize && left.fontFamily === right.fontFamily && left.lineSpacing === right.lineSpacing;

/** Binds the tracked SDK extension to the current account, without owning disk I/O. */
export function useReaderPreferencesBinding(sdk: SettingsApi | null, preferences?: ReaderPreferencesBinding) {
  const enabled = preferences !== undefined;
  const ownerId = preferences?.ownerId;
  const requested = preferences?.settings;
  const [applied, setApplied] = useState<Applied | null>(null);
  // Read by callbacks between render and old-effect cleanup. An old account may
  // never forward an event into the new account's onChange closure.
  const current = useRef({ sdk, enabled, ownerId, onChange: preferences?.onChange });
  current.current = { sdk, enabled, ownerId, onChange: preferences?.onChange };

  useLayoutEffect(() => {
    if (!enabled || !sdk) return;
    let alive = true;
    let applying = true;
    let unsubscribe: (() => void) | undefined;
    try {
      if (['getReaderSettings', 'getDefaultReaderSettings', 'setReaderSettings', 'subscribeReaderSettings'].some(name => typeof sdk[name as keyof SettingsApi] !== 'function')) {
        throw new Error('READER_SETTINGS_EXTENSION_UNAVAILABLE');
      }
      // Null means this account's SDK defaults, never the preceding user's values.
      sdk.setReaderSettings(requested ?? sdk.getDefaultReaderSettings());
      let lastObserved = sdk.getReaderSettings();
      unsubscribe = sdk.subscribeReaderSettings(next => {
        const latest = current.current;
        if (!alive || applying || !latest.enabled || latest.sdk !== sdk || latest.ownerId !== ownerId) return;
        // A queued snapshot superseded in the same owner must not rewind storage.
        if (sameSettings(next, lastObserved) || !sameSettings(next, sdk.getReaderSettings())) return;
        lastObserved = { ...next };
        latest.onChange?.({ ...next });
      });
      applying = false;
      setApplied({ sdk, ownerId, failed: false });
    } catch {
      alive = false;
      applying = false;
      unsubscribe?.();
      setApplied({ sdk, ownerId, failed: true });
    }
    return () => { alive = false; unsubscribe?.(); };
    // Values, not object/callback identity: host re-renders must not reapply or loop.
  }, [sdk, enabled, ownerId, requested?.fontSize, requested?.fontFamily, requested?.lineSpacing, requested === null]);

  const matchesOwner = applied?.sdk === sdk && applied?.ownerId === ownerId;
  return {
    ready: !enabled || Boolean(matchesOwner && !applied?.failed),
    failed: enabled && Boolean(matchesOwner && applied?.failed),
  };
}
