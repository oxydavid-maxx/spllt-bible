import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { createApiClient } from '../services/apiClient';
import { beginAuthSessionAttempt, configureAuthSessionTransport, finishAuthSessionAttempt, persistEstablishedAuthSession } from '../services/authSession';
import { theme } from './Theme';

/** Apple native authorization is iOS-only; Android retains its existing Google sign-in. */
export function AppleLoginCard({ baseUrl }: { baseUrl: string }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (Platform?.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(value => { if (active) setAvailable(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (Platform?.OS !== 'ios' || !available) return null;
  const signIn = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('正在登入…');
    const attempt = beginAuthSessionAttempt();
    configureAuthSessionTransport({ baseUrl });
    try {
      const client = createApiClient({ baseUrl, memberId: '', token: '' });
      const nonce = await client.appleChallenge();
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME], nonce });
      if (!credential.identityToken || !credential.authorizationCode) throw new Error('APPLE_CREDENTIAL_MISSING');
      const displayName = [credential.fullName?.familyName, credential.fullName?.givenName].filter(Boolean).join('');
      const session = await client.establishAppleSession({ identityToken: credential.identityToken, authorizationCode: credential.authorizationCode, nonce, displayName });
      if (!session || 'error' in session) throw new Error('APPLE_SESSION_FAILED');
      await persistEstablishedAuthSession(session, attempt);
      setMessage(null);
    } catch (error) {
      setMessage((error as { code?: string }).code === 'ERR_REQUEST_CANCELED' ? null : 'Apple 登入沒有完成，請稍後再試。');
    } finally {
      finishAuthSessionAttempt(attempt); pending.current = false; setBusy(false);
    }
  };
  return <View style={styles.card}>
    <View pointerEvents={busy ? 'none' : 'auto'} accessibilityState={{ busy, disabled: busy }}>
      <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={12}
        accessibilityLabel="使用Apple登入" style={styles.button} onPress={() => { void signIn(); }} />
    </View>
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.md, gap: theme.spacing.sm },
  button: { width: '100%', height: theme.control.cta },
  message: { color: theme.colors.danger, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
});
