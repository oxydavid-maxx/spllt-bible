import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
import { obtainGoogleIdToken, iosClientIdFromUrlScheme, type NativeGoogleModule } from '../../src/services/googleNative';

function moduleFor(responses: unknown[], checkPlayServices = vi.fn(async () => undefined)): NativeGoogleModule {
  const signIn = vi.fn(async () => responses.shift());
  const createAccount = vi.fn(async () => responses.shift());
  const presentExplicitSignIn = vi.fn(async () => responses.shift());
  return {
    GoogleOneTapSignIn: { configure: vi.fn(), checkPlayServices, signIn, createAccount, presentExplicitSignIn },
    isSuccessResponse: (response): response is { data: { idToken: string } } => Boolean((response as { data?: { idToken?: string } })?.data?.idToken),
    isNoSavedCredentialFoundResponse: (response) => (response as { kind?: string })?.kind === 'NO_SAVED',
    isCancelledResponse: (response) => (response as { kind?: string })?.kind === 'CANCELLED',
  };
}

describe('native Google authentication boundary', () => {
  it('configures iOS with its native client while keeping the web token audience', async () => {
    const native = moduleFor([{ data: { idToken: 'fixture-id-token' } }]);
    const iosClientId = iosClientIdFromUrlScheme('com.googleusercontent.apps.synthetic-ios');
    expect(iosClientId).toBe('synthetic-ios.apps.googleusercontent.com');
    await obtainGoogleIdToken(native, 'web-client-id.apps.googleusercontent.com', iosClientId);
    expect(native.GoogleOneTapSignIn.configure).toHaveBeenCalledWith({ webClientId: 'web-client-id.apps.googleusercontent.com', iosClientId });
    expect(iosClientIdFromUrlScheme('')).toBeUndefined();
    expect(iosClientIdFromUrlScheme('https://wrong')).toBeUndefined();
  });
  it('uses Credential Manager flow and returns the ID token without inventing an OAuth value', async () => {
    const native = moduleFor([{ data: { idToken: 'fixture-id-token' } }]);
    await expect(obtainGoogleIdToken(native, 'web-client-id.apps.googleusercontent.com')).resolves.toEqual({ status: 'SUCCESS', idToken: 'fixture-id-token' });
    expect(native.GoogleOneTapSignIn.configure).toHaveBeenCalledWith({ webClientId: 'web-client-id.apps.googleusercontent.com' });
    expect(native.GoogleOneTapSignIn.createAccount).not.toHaveBeenCalled();
  });

  it.each([{ data: { idToken: 'fixture-id-token' } }, { kind: 'NO_SAVED' }, { kind: 'CANCELLED' }])('uses only one explicit button flow for %j', async response => {
    const native = moduleFor([response]);
    await obtainGoogleIdToken(native, 'web-client-id.apps.googleusercontent.com');
    expect(native.GoogleOneTapSignIn.presentExplicitSignIn).toHaveBeenCalledOnce();
    expect(native.GoogleOneTapSignIn.signIn).not.toHaveBeenCalled();
    expect(native.GoogleOneTapSignIn.createAccount).not.toHaveBeenCalled();
  });

  it('reports missing Play Services as a device dependency instead of pretending Google passed', async () => {
    const native = moduleFor([], vi.fn(async () => { throw new Error('Google Play services unavailable'); }));
    await expect(obtainGoogleIdToken(native, 'web-client-id.apps.googleusercontent.com')).resolves.toEqual({ status: 'ERROR', reason: 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' });
  });
});
