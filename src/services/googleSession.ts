import { NativeModules, Platform } from 'react-native';
import { createApiClient } from './apiClient';

export async function establishGoogleSession(baseUrl: string, idToken: string) {
  let firebaseTestLab: boolean | undefined;
  // Firebase's system setting exists only on Android; iOS never touches the Android bridge.
  if (Platform.OS === 'android') {
    try {
      const value: unknown = await NativeModules.QingmuTestLab?.isRunningInTestLab();
      if (typeof value === 'boolean') firebaseTestLab = value;
    } catch { /* An older binary or unavailable setting keeps the existing IP-only fallback. */ }
  }
  return createApiClient({ baseUrl, token: '', memberId: '' }).establishSession(idToken, { persistentDevice: true, firebaseTestLab });
}
