import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { useViewerCapabilities } from '../../services/viewerCapabilities';
import { createAdminUnlockGuard, createNativeAdminAuthenticator } from '../../services/adminUnlockGuard';
import { withClientHeaders } from '../../services/clientInfo';
import { theme } from '../Theme';
import { adminRowStyles } from './adminRowStyles';

/**
 * 後台規則與文件 (維護者 2026-10-17, mock 9): every back-office rule and document on one page, so nothing has to be
 * looked for elsewhere. Administrators only, behind the device unlock. The links come from the private deployment
 * (server/adminLinks.ts), never from this public code.
 */
export const BACK_OFFICE_RULES: ReadonlyArray<[string, string]> = [
  ['可以換的分數', '讀經得分 − 試算表兌換列加總'],
  ['人數', '青少只算青少；主堂算全教會'],
  ['週刊', '公布欄同一人 10 分鐘內貼的兩張以上 A4 直式圖片；3 小時內補貼的頁併入'],
  ['青少/主堂', '第一次登入一定要選；在積分頁或我的帳戶改；全體 (管理) 看得到每個人在哪邊'],
  ['管理者', '私人設定裡指定'],
];

const apiBaseUrl = () => runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl;

/** A row of the 管理者 card on 我的帳戶 (AdminSection); only an administrator sees it. */
export function BackOfficeEntry() {
  if (!useViewerCapabilities()?.canViewAllScores) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="後台規則與文件" accessibilityHint="規則、試算表和表單連結" onPress={() => router.push('/back-office')} style={adminRowStyles.row}>
    <View style={adminRowStyles.text}>
      <Text style={adminRowStyles.title}>後台規則與文件</Text>
      <Text style={adminRowStyles.note}>規則、試算表和表單連結</Text>
    </View>
    <Text style={adminRowStyles.chevron}>›</Text>
  </Pressable>;
}

type LinksState = { status: 'locked' | 'loading' | 'ready' | 'error'; links: Array<{ name: string; url: string }> };

export function BackOfficePage() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const [state, setState] = useState<LinksState>({ status: 'locked', links: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const guard = createAdminUnlockGuard({ authenticate: createNativeAdminAuthenticator('解鎖後台規則與文件') });
    void (async () => {
      if (!await guard.unlock()) { if (active) setState({ status: 'locked', links: [] }); return; }
      if (active) setState({ status: 'loading', links: [] });
      try {
        const response = await withClientHeaders(fetch)(`${apiBaseUrl()}/api/admin/documents`, { headers: { authorization: `Bearer ${session.sessionToken}` } });
        const links = response.ok ? ((await response.json()) as { links?: LinksState['links'] }).links : null;
        if (active) setState(Array.isArray(links) ? { status: 'ready', links } : { status: 'error', links: [] });
      } catch { if (active) setState({ status: 'error', links: [] }); }
    })();
    return () => { active = false; guard.clear(); };
  }, [session?.memberId, session?.sessionToken, attempt]);

  if (state.status === 'locked') {
    return <View style={styles.page}>
      <Text style={styles.note}>需要完成身分驗證才能查看後台規則與文件。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="再解鎖一次" onPress={() => setAttempt((count) => count + 1)} style={styles.retry}><Text style={styles.retryText}>再解鎖一次</Text></Pressable>
    </View>;
  }
  return <ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.section}>規則</Text>
    <View style={styles.list}>
      {BACK_OFFICE_RULES.map(([key, value]) => <View key={key} style={styles.row}><Text style={styles.key}>{key}</Text><Text style={styles.value}>{value}</Text></View>)}
    </View>
    <Text accessibilityRole="header" style={styles.section}>文件</Text>
    <View style={styles.list}>
      {state.status === 'loading' ? <Text style={styles.note}>載入中…</Text> : null}
      {state.status === 'error' ? <Text style={styles.note}>暫時讀不到文件連結。</Text> : null}
      {state.status === 'ready' && !state.links.length ? <Text style={styles.note}>還沒有設定文件連結。</Text> : null}
      {state.status === 'error' || (state.status === 'ready' && !state.links.length) ? <Pressable accessibilityRole="button" accessibilityLabel="重試讀取文件連結" onPress={() => setAttempt(count => count + 1)} style={styles.retry}><Text style={styles.retryText}>重試</Text></Pressable> : null}
      {state.links.map((link) => <Pressable key={link.url} accessibilityRole="link" accessibilityLabel={`開啟${link.name}`} onPress={() => { void WebBrowser.openBrowserAsync(link.url); }} style={styles.row}>
        <Text style={styles.key}>{link.name}</Text><Text style={styles.link}>開啟 ›</Text>
      </Pressable>)}
    </View>
    <Text style={styles.note}>連結從私人設定讀，不在公開的程式碼裡。</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: theme.spacing.lg, gap: theme.spacing.sm },
  section: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800', paddingTop: theme.spacing.sm },
  list: { borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm, minHeight: theme.control.tap, alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  key: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800', flexShrink: 0 },
  value: { flex: 1, color: theme.colors.muted, fontSize: theme.type.label.size, textAlign: 'right' },
  link: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, padding: theme.spacing.sm },
  retry: { minHeight: theme.control.tap, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  retryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
});
