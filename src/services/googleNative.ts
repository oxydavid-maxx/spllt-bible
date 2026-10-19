import * as SecureStore from 'expo-secure-store';

export interface NativeGoogleModule {
  GoogleOneTapSignIn: {
    configure: (options: { webClientId: string; iosClientId?: string }) => void;
    checkPlayServices: () => Promise<void>;
    signIn: () => Promise<unknown>;
    createAccount: () => Promise<unknown>;
    presentExplicitSignIn: () => Promise<unknown>;
  };
  isSuccessResponse: (response: unknown) => response is { data: { idToken: string } };
  isNoSavedCredentialFoundResponse: (response: unknown) => boolean;
  isCancelledResponse: (response: unknown) => boolean;
}

export type NativeGoogleResult =
  | { status: 'SUCCESS'; idToken: string }
  | { status: 'CANCELLED' }
  | { status: 'ERROR'; reason: 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' | 'SIGN_IN_NOT_COMPLETED' | 'NATIVE_MODULE_UNAVAILABLE' };

/** Google defines the callback scheme as the reversed iOS OAuth client ID. */
export function iosClientIdFromUrlScheme(scheme: string | undefined): string | undefined {
  const match = /^com\.googleusercontent\.apps\.([A-Za-z0-9_-]+)$/.exec(scheme?.trim() ?? '');
  return match ? `${match[1]}.apps.googleusercontent.com` : undefined;
}

export async function obtainGoogleIdToken(nativeGoogle: NativeGoogleModule, webClientId: string, iosClientId?: string): Promise<NativeGoogleResult> {
  try {
    nativeGoogle.GoogleOneTapSignIn.configure({ webClientId, ...(iosClientId ? { iosClientId } : {}) });
    await nativeGoogle.GoogleOneTapSignIn.checkPlayServices();
    // A user-pressed button uses Google's explicit UI on both platforms, without One Tap fallbacks.
    const response = await nativeGoogle.GoogleOneTapSignIn.presentExplicitSignIn();
    if (nativeGoogle.isSuccessResponse(response)) return { status: 'SUCCESS', idToken: response.data.idToken };
    if (nativeGoogle.isCancelledResponse(response)) return { status: 'CANCELLED' };
    return { status: 'ERROR', reason: 'SIGN_IN_NOT_COMPLETED' };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return { status: 'ERROR', reason: message.includes('play') || message.includes('credential') ? 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' : 'NATIVE_MODULE_UNAVAILABLE' };
  }
}

const GOOGLE_LOGIN_PENDING_KEY = 'qingmu.googleLogin.pending.v1';
let markerSequence = 0;
let markerTail: Promise<unknown> = Promise.resolve();
function mutateMarker<T>(operation: () => Promise<T>): Promise<T> {
  const result = markerTail.then(operation, operation);
  markerTail = result.catch(() => undefined);
  return result;
}

/** Persist before opening native UI; contains no account or token. */
export function beginGoogleLogin(): Promise<string> {
  const startedAt = Date.now();
  const marker = JSON.stringify({ id: `${startedAt}-${++markerSequence}`, startedAt });
  return mutateMarker(async () => {
    await SecureStore.setItemAsync(GOOGLE_LOGIN_PENDING_KEY, marker);
    return marker;
  });
}

/** A superseded attempt must never clear the newer attempt's marker. */
export function finishGoogleLogin(marker: string): Promise<void> {
  return mutateMarker(async () => {
    if (await SecureStore.getItemAsync(GOOGLE_LOGIN_PENDING_KEY) === marker) {
      await SecureStore.deleteItemAsync(GOOGLE_LOGIN_PENDING_KEY);
    }
  });
}

/** Consume once after local hydration, including stale/malformed or already-signed-in starts. */
export function consumeInterruptedGoogleLogin(signedIn: boolean): Promise<boolean> {
  return mutateMarker(async () => {
    const raw = await SecureStore.getItemAsync(GOOGLE_LOGIN_PENDING_KEY);
    if (raw === null) return false;
    await SecureStore.deleteItemAsync(GOOGLE_LOGIN_PENDING_KEY);
    try {
      const marker = JSON.parse(raw) as { startedAt?: unknown };
      const age = typeof marker?.startedAt === 'number' ? Date.now() - marker.startedAt : NaN;
      return !signedIn && Number.isFinite(age) && age >= 0 && age < 10 * 60_000;
    } catch { return false; }
  });
}
