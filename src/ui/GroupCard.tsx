import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { buildGroupLinkFallback } from './groupLinkFallback';
import { theme } from './Theme';

export function GroupCard({ groupName, openChatUrl, rpgUrl, callUrl, callProvider, callScope, linkStatus }: { groupName: string; openChatUrl: string | null; rpgUrl: string | null; callUrl?: string | null; callProvider?: string | null; callScope?: 'TEST_ONLY' | 'APPROVED' | null; linkStatus: 'PENDING_UI_VERIFICATION' | 'READY' }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const open = async (url: string) => {
    try { await Linking.openURL(url); setFailedUrl(null); } catch { setFailedUrl(url); }
  };
  const copy = async (url: string) => { await Clipboard.setStringAsync(url); setCopied(true); };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{groupName}</Text>
      <Text style={styles.body}>RPG固定組員在LINE OpenChat自行約；通話由大家選擇核准的外部方式。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="開啟青牧LINE OpenChat社群" disabled={!openChatUrl} style={[styles.button, !openChatUrl && styles.disabled]} onPress={() => openChatUrl && open(openChatUrl)}>
        <Text style={styles.buttonText}>{openChatUrl ? '開啟社群入口' : '社群入口待核准'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="開啟我的RPG入口" disabled={!rpgUrl} style={[styles.buttonSecondary, !rpgUrl && styles.disabledSecondary]} onPress={() => rpgUrl && open(rpgUrl)}>
        <Text style={styles.secondaryText}>{rpgUrl ? '開啟我的RPG' : 'RPG入口待核准'}</Text>
      </Pressable>
      {callUrl ? <><Pressable accessibilityRole="button" accessibilityLabel={`開啟${callProvider ?? '外部'}通話`} style={styles.buttonSecondary} onPress={() => open(callUrl)}><Text style={styles.secondaryText}>開啟{callProvider === 'meet' ? 'Meet' : 'Zoom'}通話</Text></Pressable><Text style={styles.pending}>{callScope === 'TEST_ONLY' ? '這是目前的測試通話入口，不代表正式聚會連結。' : '目前使用核准的聚會通話入口。'}</Text></> : <Text style={styles.pending}>{linkStatus === 'PENDING_UI_VERIFICATION' ? 'LINE社群入口尚待管理者核對。' : '目前沒有可用通話連結。'}</Text>}
      {failedUrl ? <View style={styles.fallback}><Text style={styles.pending}>目前裝置無法開啟連結；你可以複製後改用瀏覽器或回到小組LINE。</Text><Pressable accessibilityRole="button" accessibilityLabel="複製失敗的連結" style={styles.buttonSecondary} onPress={() => { void copy(buildGroupLinkFallback(failedUrl, openChatUrl).copyUrl); }}><Text style={styles.secondaryText}>{copied ? '已複製連結' : '複製連結'}</Text></Pressable>{buildGroupLinkFallback(failedUrl, openChatUrl).returnToGroupUrl ? <Pressable accessibilityRole="button" accessibilityLabel="回到小組LINE入口" style={styles.buttonSecondary} onPress={() => open(buildGroupLinkFallback(failedUrl, openChatUrl).returnToGroupUrl!)}><Text style={styles.secondaryText}>回到小組LINE</Text></Pressable> : null}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // One filled action per card. Everything still waiting on a person (link
  // approval, copy-link fallback) is clay on a rail, not another green block.
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderLeftWidth: theme.control.rail, borderLeftColor: theme.colors.primary, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  title: { color: theme.colors.ink, fontSize: theme.type.title.size, lineHeight: theme.type.title.line, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  button: { minHeight: theme.control.cta, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md },
  disabled: { backgroundColor: theme.colors.muted },
  buttonSecondary: { minHeight: theme.control.tap, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', borderColor: theme.colors.primary, borderWidth: theme.control.hairline, paddingHorizontal: theme.spacing.md },
  disabledSecondary: { opacity: 0.62, borderColor: theme.colors.borderStrong },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '700' },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  pending: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  fallback: { gap: theme.spacing.xs, backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.chip, padding: theme.spacing.sm },
});
