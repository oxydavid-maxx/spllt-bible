import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { theme } from './Theme';
import { createApiClient } from '../services/apiClient';
import { obtainGoogleIdToken, type NativeGoogleModule } from '../services/googleNative';
import { persistAuthSession } from '../services/authSession';

WebBrowser.maybeCompleteAuthSession();

export function GoogleLoginCard({ baseUrl, onSignedIn }: { baseUrl: string; onSignedIn?: (sessionToken: string, memberId: string) => void }) {
  const clientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID)?.trim();
  const fixture = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
  if (fixture) {
    return <View style={styles.card}><Text style={styles.title}>目前是測試身份</Text><Text style={styles.body}>這次測試只用兩位虛構成員；正式Google登入完成後才會切換到真實身份。</Text></View>;
  }
  if (!clientId) {
    return <View style={styles.card}><Text style={styles.title}>正式登入尚未連接</Text><Text style={styles.body}>正式Google登入完成後，才會切換到真實身份。</Text></View>;
  }
  return <ConfiguredGoogleLogin clientId={clientId} baseUrl={baseUrl} onSignedIn={onSignedIn} />;
}

function ConfiguredGoogleLogin({ clientId, baseUrl, onSignedIn }: { clientId: string; baseUrl: string; onSignedIn?: (sessionToken: string, memberId: string) => void }) {
  const [state, setState] = useState<'idle' | 'exchanging' | 'needs-invite' | 'claiming-invite' | 'signed-in' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const completeSession = useCallback(async (session: { sessionToken: string; memberId: string; expiresInSeconds: number }) => {
    await persistAuthSession({ sessionToken: session.sessionToken, memberId: session.memberId }, session.expiresInSeconds);
    onSignedIn?.(session.sessionToken, session.memberId);
    setState('signed-in');
  }, [onSignedIn]);
  const signIn = useCallback(async () => {
    setState('exchanging');
    setErrorMessage(null);
    try {
      const nativeGoogle = require('react-native-nitro-google-signin') as NativeGoogleModule;
      const authResult = await obtainGoogleIdToken(nativeGoogle, clientId);
      if (authResult.status !== 'SUCCESS') {
        setState('error');
        setErrorMessage(authResult.status === 'CANCELLED' ? '你取消了登入。' : authResult.reason === 'GOOGLE_PLAY_SERVICES_UNAVAILABLE' ? '這台裝置沒有可用的Google服務。' : '登入沒有完成，請稍後再試。');
        return;
      }
      const client = createApiClient({ baseUrl, token: '', memberId: '' });
      const session = await client.establishSession(authResult.idToken);
      if (!session) {
        setState('error');
        setErrorMessage('登入已回來，但伺服器沒有確認身份。');
        return;
      }
      if ('error' in session) {
        if (session.error === 'UNKNOWN_MEMBER') {
          setGoogleIdToken(authResult.idToken);
          setState('needs-invite');
          setErrorMessage('這個Google身份尚未加入核准名單，請輸入同工提供的一次性邀請碼。');
        } else {
          setState('error');
          setErrorMessage('伺服器沒有確認身份，請稍後再試。');
        }
        return;
      }
      await completeSession(session);
    } catch {
      setState('error');
      setErrorMessage('目前裝置尚未完成Google登入設定。');
    }
  }, [baseUrl, clientId, completeSession]);
  const claimInvite = useCallback(async () => {
    if (!googleIdToken || !inviteCode.trim()) return;
    setState('claiming-invite');
    setErrorMessage(null);
    try {
      const client = createApiClient({ baseUrl, token: '', memberId: '' });
      const session = await client.claimInvite(googleIdToken, inviteCode.trim());
      if (!session || 'error' in session) {
        setState('needs-invite');
        setErrorMessage(session && 'error' in session && session.error === 'INVITE_EXPIRED' ? '邀請碼已過期，請向同工索取新的邀請碼。' : '邀請碼無效或已使用。');
        return;
      }
      await completeSession(session);
    } catch {
      setState('needs-invite');
      setErrorMessage('邀請碼驗證失敗，請稍後重試。');
    }
  }, [baseUrl, completeSession, googleIdToken, inviteCode]);
  const alert = state === 'error' || state === 'needs-invite';
  return (
    <View style={[styles.card, alert && styles.cardAlert]}>
      <Text style={styles.title}>Google身份</Text>
      <Text style={[styles.body, alert && styles.bodyAlert]}>{state === 'signed-in' ? '已登入，可以連續保存你的讀經與小組進度。' : state === 'exchanging' ? '正在登入…' : state === 'needs-invite' || state === 'claiming-invite' ? errorMessage ?? '請輸入同工提供的一次性邀請碼。' : state === 'error' ? errorMessage ?? '登入失敗，請稍後重試。' : '登入後可以連續保存你的讀經與小組進度。'}</Text>
      {state === 'needs-invite' || state === 'claiming-invite' ? <>
        <TextInput value={inviteCode} onChangeText={setInviteCode} placeholder="一次性邀請碼" autoCapitalize="none" autoCorrect={false} style={styles.input} accessibilityLabel="一次性邀請碼" />
        <Pressable accessibilityRole="button" accessibilityLabel="送出邀請碼" disabled={state === 'claiming-invite' || !inviteCode.trim()} style={[styles.button, (state === 'claiming-invite' || !inviteCode.trim()) && styles.disabled]} onPress={() => { void claimInvite(); }}>
          <Text style={styles.buttonText}>{state === 'claiming-invite' ? '確認中…' : '加入核准小組'}</Text>
        </Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="使用Google登入" disabled={state === 'exchanging' || state === 'signed-in'} style={[styles.button, (state === 'exchanging' || state === 'signed-in') && styles.disabled]} onPress={() => { void signIn(); }}>
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
});
