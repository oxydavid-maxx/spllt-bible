import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { theme } from './Theme';
import { useAutoUpdateHold } from './useAutoUpdateHold';
import { createApiClient, type SessionResult } from '../services/apiClient';
import { establishGoogleSession } from '../services/googleSession';
import { beginGoogleLogin, finishGoogleLogin, obtainGoogleIdToken, iosClientIdFromUrlScheme, type NativeGoogleModule, type NativeGoogleResult } from '../services/googleNative';
import { beginAuthSessionAttempt, finishAuthSessionAttempt, configureAuthSessionTransport, persistEstablishedAuthSession, type AuthSessionAttempt } from '../services/authSession';

WebBrowser.maybeCompleteAuthSession();

interface NativeLoginWait {
  recover: (showMessage: boolean) => void;
  retryable: boolean;
  foregroundTimer?: ReturnType<typeof setTimeout>;
}

/** `welcome` is the sign-in screen's one large button; `card` is the framed card used everywhere else. */
export function GoogleLoginCard({ baseUrl, onSignedIn, variant = 'card', onSignInStart }: { onSignInStart?: () => void; baseUrl: string; onSignedIn?: (sessionToken: string, memberId: string) => void; variant?: 'card' | 'welcome' }) {
  const clientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID)?.trim();
  const fixture = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
  if (fixture) {
    return <View style={styles.card}><Text style={styles.title}>目前是測試身份</Text><Text style={styles.body}>這次測試只用兩位虛構成員；正式Google登入完成後才會切換到真實身份。</Text></View>;
  }
  if (!clientId) {
    return <View style={styles.card}><Text style={styles.title}>正式登入尚未連接</Text><Text style={styles.body}>正式Google登入完成後，才會切換到真實身份。</Text></View>;
  }
  return <ConfiguredGoogleLogin clientId={clientId} baseUrl={baseUrl} onSignedIn={onSignedIn} variant={variant} onSignInStart={onSignInStart} />;
}

function ConfiguredGoogleLogin({ clientId, baseUrl, onSignedIn, variant, onSignInStart }: { onSignInStart?: () => void; clientId: string; baseUrl: string; onSignedIn?: (sessionToken: string, memberId: string) => void; variant: 'card' | 'welcome' }) {
  const [state, setState] = useState<'idle' | 'exchanging' | 'needs-invite' | 'claiming-invite' | 'signed-in' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  // A sign-in under way or an activation code being typed must not be reloaded away (2026-10-21).
  useAutoUpdateHold(inviteCode.length > 0 || state === 'exchanging' || state === 'needs-invite' || state === 'claiming-invite', '登入中');
  const nativeWait = useRef<NativeLoginWait | null>(null);
  const starting = useRef<AuthSessionAttempt | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      const pending = nativeWait.current;
      if (previousState !== 'active' && nextState === 'active' && pending && !pending.retryable && pending.foregroundTimer === undefined) {
        // Foreground is not completion: the SDK can still be exchanging tokens.
        pending.foregroundTimer = setTimeout(() => pending.recover(true), 10_000);
      }
      previousState = nextState;
    });
    return () => { mounted.current = false; subscription.remove(); nativeWait.current?.recover(false); };
  }, []);
  const completeSession = useCallback(async (session: SessionResult, attempt: AuthSessionAttempt) => {
    if (!await persistEstablishedAuthSession(session, attempt)) return;
    onSignedIn?.(session.sessionToken, session.memberId);
    setState('signed-in');
  }, [onSignedIn]);
  const signIn = useCallback(async () => {
    if (starting.current || (nativeWait.current && !nativeWait.current.retryable)) return;
    // Only an explicit retry (or unmount) invalidates the previous native result.
    nativeWait.current?.recover(false);
    const attempt = beginAuthSessionAttempt();
    starting.current = attempt;
    configureAuthSessionTransport({ baseUrl });
    setState('exchanging');
    setErrorMessage(null);
    onSignInStart?.();
    let marker: string | undefined;
    try {
      marker = await beginGoogleLogin();
      if (!mounted.current) return;
      starting.current = null;
      const nativeGoogle = require('react-native-nitro-google-signin') as NativeGoogleModule;
      // iOS needs its own native client; serverClientID stays the web client so the backend audience is unchanged.
      const iosClientId = Platform.OS === 'ios' ? iosClientIdFromUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME) : undefined;
      const authResult = await new Promise<NativeGoogleResult | null>(resolve => {
        const clearTimers = () => {
          clearTimeout(timeout);
          if (pending.foregroundTimer !== undefined) clearTimeout(pending.foregroundTimer);
        };
        const clearWait = () => {
          clearTimers();
          if (nativeWait.current === pending) nativeWait.current = null;
        };
        const pending: NativeLoginWait = {
          retryable: false,
          recover: showMessage => {
            if (nativeWait.current !== pending) return;
            if (showMessage) {
              if (pending.retryable) return;
              clearTimers();
              pending.retryable = true;
              setState('error');
              setErrorMessage('登入沒有完成，請再按一次。');
            } else {
              clearWait();
              finishAuthSessionAttempt(attempt);
              resolve(null);
            }
          },
        };
        // Offer retry without cancelling a slow native flow or multi-step verification.
        const timeout = setTimeout(() => pending.recover(true), 60_000);
        nativeWait.current = pending;
        void obtainGoogleIdToken(nativeGoogle, clientId, iosClientId).then(result => {
          if (nativeWait.current !== pending) return;
          clearWait();
          resolve(result);
        });
      });
      if (!authResult) return;
      if (authResult.status !== 'SUCCESS') {
        setState('error');
        setErrorMessage(authResult.status === 'CANCELLED' ? '你取消了登入。' : authResult.reason === 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' ? '這台裝置沒有可用的Google服務。' : '登入沒有完成，請稍後再試。');
        return;
      }
      setState('exchanging');
      setErrorMessage(null);
      const session = await establishGoogleSession(baseUrl, authResult.idToken);
      if (!session) {
        setState('error');
        setErrorMessage('登入已回來，但伺服器沒有確認身份。');
        return;
      }
      if ('error' in session) {
        if (session.error === 'UNKNOWN_MEMBER') {
          setGoogleIdToken(authResult.idToken);
          setState('needs-invite');
          setErrorMessage('這個Google身份尚未完成帳戶啟用，請輸入同工提供的一次性啟用碼。');
        } else {
          setState('error');
          setErrorMessage('伺服器沒有確認身份，請稍後再試。');
        }
        return;
      }
      await completeSession(session, attempt);
    } catch {
      setState('error');
      setErrorMessage('目前裝置尚未完成Google登入設定。');
    } finally {
      if (starting.current === attempt) starting.current = null;
      finishAuthSessionAttempt(attempt);
      if (marker) await finishGoogleLogin(marker).catch(() => undefined);
    }
  }, [baseUrl, clientId, completeSession, onSignInStart]);
  const claimInvite = useCallback(async () => {
    if (!googleIdToken || !inviteCode.trim()) return;
    const attempt = beginAuthSessionAttempt();
    configureAuthSessionTransport({ baseUrl });
    setState('claiming-invite');
    setErrorMessage(null);
    try {
      const client = createApiClient({ baseUrl, token: '', memberId: '' });
      const session = await client.claimInvite(googleIdToken, inviteCode.trim(), { persistentDevice: true });
      if (!session || 'error' in session) {
        setState('needs-invite');
        setErrorMessage(session && 'error' in session && session.error === 'INVITE_EXPIRED' ? '啟用碼已過期，請向同工索取新的啟用碼。' : '啟用碼無效或已使用。');
        return;
      }
      await completeSession(session, attempt);
    } catch {
      setState('needs-invite');
      setErrorMessage('啟用碼驗證失敗，請稍後重試。');
    } finally { finishAuthSessionAttempt(attempt); }
  }, [baseUrl, completeSession, googleIdToken, inviteCode]);
  const alert = state === 'error' || state === 'needs-invite';
  const inviting = state === 'needs-invite' || state === 'claiming-invite';
  const inviteForm = <>
    <TextInput value={inviteCode} onChangeText={setInviteCode} placeholder="一次性啟用碼" autoCapitalize="none" autoCorrect={false} style={styles.input} accessibilityLabel="一次性啟用碼" />
    <Pressable accessibilityRole="button" accessibilityLabel="送出啟用碼" disabled={state === 'claiming-invite' || !inviteCode.trim()} style={[styles.button, (state === 'claiming-invite' || !inviteCode.trim()) && styles.disabled]} onPress={() => { void claimInvite(); }}>
      <Text style={styles.buttonText}>{state === 'claiming-invite' ? '確認中…' : '完成帳戶啟用'}</Text>
    </Pressable>
  </>;
  if (variant === 'welcome') {
    const message = state === 'exchanging' ? '正在登入…' : inviting ? errorMessage ?? '請輸入同工提供的一次性啟用碼。' : state === 'error' ? errorMessage ?? '登入失敗，請稍後重試。' : null;
    return (
      <View style={styles.welcome}>
        {message ? <Text style={[styles.body, styles.welcomeMessage, alert && styles.bodyAlert]}>{message}</Text> : null}
        {inviting ? inviteForm : <Pressable accessibilityRole="button" accessibilityLabel="使用Google登入" disabled={state === 'exchanging' || state === 'signed-in'} style={[styles.welcomeButton, (state === 'exchanging' || state === 'signed-in') && styles.disabled]} onPress={() => { void signIn(); }}>
          <View style={styles.googleMark}><Text style={styles.googleMarkText}>G</Text></View>
          <Text style={styles.welcomeButtonText}>用 Google 登入</Text>
        </Pressable>}
      </View>
    );
  }
  return (
    <View style={[styles.card, alert && styles.cardAlert]}>
      <Text style={styles.title}>Google身份</Text>
      <Text style={[styles.body, alert && styles.bodyAlert]}>{state === 'signed-in' ? '已登入，可以保存你的讀經進度。' : state === 'exchanging' ? '正在登入…' : state === 'needs-invite' || state === 'claiming-invite' ? errorMessage ?? '請輸入同工提供的一次性啟用碼。' : state === 'error' ? errorMessage ?? '登入失敗，請稍後重試。' : '登入後可以保存你的讀經進度。'}</Text>
      {inviting ? inviteForm : <Pressable accessibilityRole="button" accessibilityLabel="使用Google登入" disabled={state === 'exchanging' || state === 'signed-in'} style={[styles.button, (state === 'exchanging' || state === 'signed-in') && styles.disabled]} onPress={() => { void signIn(); }}>
        <Text style={styles.buttonText}>{state === 'signed-in' ? '已登入' : '使用Google登入'}</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sign-in is one decision, so the card is one column with a single filled action.
  // The rail turns clay whenever the card is telling you something went wrong.
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderLeftWidth: theme.control.rail, borderLeftColor: theme.colors.primary, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  cardAlert: { borderLeftColor: theme.colors.accent },
  title: { color: theme.colors.ink, fontSize: theme.type.title.size, lineHeight: theme.type.title.line, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  bodyAlert: { color: theme.colors.accent, fontWeight: '700' },
  button: { minHeight: theme.control.cta, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: theme.control.tap, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, color: theme.colors.ink, fontSize: theme.type.body.size, paddingHorizontal: theme.spacing.md },
  disabled: { backgroundColor: theme.colors.muted },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '700' },
  welcome: { gap: theme.spacing.sm },
  welcomeMessage: { textAlign: 'center' },
  welcomeButton: { minHeight: theme.control.cta, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  googleMark: { width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  googleMarkText: { color: '#4285F4', fontSize: 15, fontWeight: '800' },
  welcomeButtonText: { color: theme.colors.white, fontSize: 17, fontWeight: '800' },
});
