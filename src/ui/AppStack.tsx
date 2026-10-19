import { Image, View } from 'react-native';
import { BRAND_ICON } from './brandIcon';
import { Stack } from 'expo-router';
import type { AuthStatus } from '../services/authSession';

/** Only a restored local session opens the app; returning members never see sign-in flash. */
export function canUseApp(status: AuthStatus): boolean {
  return status === 'signed-in';
}

/**
 * Every app screen sits behind sign-in (Expo Router's Stack.Protected): a signed-out or expired
 * session lands on the sign-in screen, and the sign-in screen is out of reach once signed in.
 * List any new top-level route here; a route the layout does not name stays reachable signed out.
 */
export function AppStack({ signedIn, hydrating = false }: { signedIn: boolean; hydrating?: boolean }) {
  // Match the native launch screen's white background and app icon, with no routes or text yet.
  if (hydrating) return <View testID="auth-startup" style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
    <Image source={BRAND_ICON} style={{ width: 200, height: 200 }} accessibilityIgnoresInvertColors />
  </View>;
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={signedIn}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="account" />
      <Stack.Screen name="back-office" />
    </Stack.Protected>
    <Stack.Protected guard={!signedIn}>
      <Stack.Screen name="sign-in" />
    </Stack.Protected>
  </Stack>;
}
