// Inert Node-only native boundary: the store build's own copy is running and updates are off.
// Real update delivery is proven on a phone (docs/eas-update.md), never with this double.
export const isEnabled = false;
export const isEmbeddedLaunch = true;
export const updateId: string | null = null;
export const createdAt: Date | null = null;
export const channel: string | null = null;
export const UpdatesCheckAutomaticallyValue = { ON_LOAD: 'ON_LOAD', ON_ERROR_RECOVERY: 'ON_ERROR_RECOVERY', WIFI_ONLY: 'WIFI_ONLY', NEVER: 'NEVER' } as const;
export const checkAutomatically: string | null = null;
export const checkForUpdateAsync = async (): Promise<never> => { throw new Error('NATIVE_UPDATES_UNAVAILABLE'); };
export const fetchUpdateAsync = async (): Promise<never> => { throw new Error('NATIVE_UPDATES_UNAVAILABLE'); };
export const setUpdateRequestHeadersOverride = (): void => { throw new Error('NATIVE_UPDATES_UNAVAILABLE'); };
