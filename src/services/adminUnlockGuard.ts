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

/** Optional native adapter. It is loaded only when the protected surface is opened. */
export function createNativeAdminAuthenticator(): () => Promise<boolean> {
  return async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: '解鎖完整排名', cancelLabel: '取消', disableDeviceFallback: false });
      return result.success === true;
    } catch { return false; }
  };
}
import * as LocalAuthentication from 'expo-local-authentication';
