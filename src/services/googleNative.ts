export interface NativeGoogleModule {
  GoogleOneTapSignIn: {
    configure: (options: { webClientId: string }) => void;
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

export async function obtainGoogleIdToken(nativeGoogle: NativeGoogleModule, webClientId: string): Promise<NativeGoogleResult> {
  try {
    nativeGoogle.GoogleOneTapSignIn.configure({ webClientId });
    await nativeGoogle.GoogleOneTapSignIn.checkPlayServices();
    let response = await nativeGoogle.GoogleOneTapSignIn.signIn();
    if (nativeGoogle.isNoSavedCredentialFoundResponse(response)) response = await nativeGoogle.GoogleOneTapSignIn.createAccount();
    if (nativeGoogle.isNoSavedCredentialFoundResponse(response)) response = await nativeGoogle.GoogleOneTapSignIn.presentExplicitSignIn();
    if (nativeGoogle.isSuccessResponse(response)) return { status: 'SUCCESS', idToken: response.data.idToken };
    if (nativeGoogle.isCancelledResponse(response)) return { status: 'CANCELLED' };
    return { status: 'ERROR', reason: 'SIGN_IN_NOT_COMPLETED' };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return { status: 'ERROR', reason: message.includes('play') || message.includes('credential') ? 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' : 'NATIVE_MODULE_UNAVAILABLE' };
  }
}
