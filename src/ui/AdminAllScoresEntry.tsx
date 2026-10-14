import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { runtimeConfig } from '../config/runtime';
import { useAuthSnapshot } from '../services/authSession';
import { createGamificationApiClient } from '../services/gamificationApiClient';
import { requestOpenAllScores } from '../services/allScoresRequest';
import { theme } from './Theme';

/**
 * 全體 (管理), faded at the bottom of 我的帳戶 (維護者 2026-10-14). Shown only to an account the
 * server says may view all scores; the 積分 screen still asks for the device unlock before opening it.
 */
export function AdminAllScoresEntry() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(false);
    if (!session) return;
    let active = true;
    const client = createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId });
    void client.getCapabilities().then((value) => { if (active) setAllowed(Boolean(value.canViewAllScores)); }).catch(() => undefined);
    return () => { active = false; };
  }, [session?.memberId, session?.sessionToken]);
  if (!allowed) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="全體 (管理)" onPress={() => { requestOpenAllScores(); router.navigate('/progress'); }} style={styles.entry}>
    <Text style={styles.text}>全體 (管理) ›</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  entry: { minHeight: theme.control.tap, alignSelf: 'stretch', justifyContent: 'center', marginTop: theme.spacing.xxl },
  text: { color: theme.colors.borderStrong, fontSize: theme.type.label.size, fontWeight: '600' },
});
