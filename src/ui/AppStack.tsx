import { Stack } from 'expo-router';
import type { AuthStatus } from '../services/authSession';

/**
 * A saved session counts while it is being restored, so a returning member never sees the sign-in
 * screen flash by. If it turns out to be gone, the guard flips and Expo Router sends them to sign in.
 */
export function canUseApp(status: AuthStatus): boolean {
  return status === 'signed-in' || status === 'hydrating';
}

/**
 * Every app screen sits behind sign-in (Expo Router's Stack.Protected): a signed-out or expired
 * session lands on the sign-in screen, and the sign-in screen is out of reach once signed in.
 * List any new top-level route here; a route the layout does not name stays reachable signed out.
 */
export function AppStack({ signedIn }: { signedIn: boolean }) {
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={signedIn}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="account" />
    </Stack.Protected>
    <Stack.Protected guard={!signedIn}>
      <Stack.Screen name="sign-in" />
    </Stack.Protected>
  </Stack>;
}
