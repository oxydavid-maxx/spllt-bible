// Inert Node-only native boundary. Real authorization is proven by the simulator, never this double.
export const isAvailableAsync = async () => false;
export const signInAsync = async (): Promise<never> => { throw new Error('NATIVE_APPLE_UNAVAILABLE'); };
export const AppleAuthenticationButton = () => null;
export const AppleAuthenticationScope = { FULL_NAME: 0 };
export const AppleAuthenticationButtonType = { SIGN_IN: 0 };
export const AppleAuthenticationButtonStyle = { BLACK: 0 };
