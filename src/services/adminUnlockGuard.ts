export type AdminUnlockState = 'locked' | 'authenticating' | 'unlocked';

export interface AdminUnlockGuard {
  readonly state: AdminUnlockState;
  unlock(): Promise<boolean>;
  clear(): void;
}

export function createAdminUnlockGuard(options: { authenticate: () => Promise<boolean> }): AdminUnlockGuard {
  let state: AdminUnlockState = 'locked';
  return {
    get state() { return state; },
    async unlock() {
      if (state === 'unlocked') return true;
      state = 'authenticating';
      try {
        const success = await options.authenticate();
        state = success === true ? 'unlocked' : 'locked';
        return state === 'unlocked';
      } catch {
        state = 'locked';
        return false;
      }
    },
    clear() { state = 'locked'; },
  };
}

/**
 * The CI simulator has no Face ID and no passcode, so a flow could never open 全體 (管理) to show the version
 * line (光佑 2026-10-21). A fixture build (fake backend, two made-up members) may be told to unlock by the launch
 * argument `qingmuFixtureUnlock: yes` (.maestro/ios/42-version-log.yaml). A real build never reads it.
 */
export function fixtureUnlockRequested(
  fixture = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true',
  read: () => unknown = () => {
    // A named property of require, never a wildcard or import() (AGENTS.md iOS note 1).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Settings } = require('react-native') as { Settings: { get(key: string): unknown } };
    return Settings.get('qingmuFixtureUnlock');
  },
): boolean {
  if (!fixture) return false;
  try { return read() === 'yes'; } catch { return false; }
}

/** Optional native adapter. It is loaded only when the protected surface is opened. */
export function createNativeAdminAuthenticator(promptMessage = '解鎖完整排名'): () => Promise<boolean> {
  return async () => {
    if (fixtureUnlockRequested()) return true;
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: '取消', disableDeviceFallback: false });
      return result.success === true;
    } catch { return false; }
  };
}
import * as LocalAuthentication from 'expo-local-authentication';
