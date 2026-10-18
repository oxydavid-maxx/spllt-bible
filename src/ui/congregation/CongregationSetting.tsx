import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import { ActionSheet } from '../gamification/ActionSheet';
import { useCongregation } from './congregationStore';

/**
 * 我的帳戶 → 我在哪裡聚會 (維護者 2026-10-17): changing it is confirmed first, saying what
 * changes (which announcements open first, which prizes show) and what does not (points already earned).
 */
const NAME = { youth: '青少', main: '主堂' } as const;

export function CongregationSetting() {
  const congregation = useCongregation();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  if (congregation.status !== 'ready' || !congregation.value) return null;
  const current = congregation.value;
  const other = current === 'youth' ? 'main' : 'youth';
  const change = async () => {
    setFailed(false);
    try { await congregation.choose(other); setConfirming(false); } catch { setFailed(true); }
  };
  return <View style={styles.row}>
    <Text style={styles.label}>我在哪裡聚會</Text>
    <Text style={styles.value}>{NAME[current]}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="改我在哪裡聚會" onPress={() => { setFailed(false); setConfirming(true); }} style={styles.change}>
      <Text style={styles.changeText}>改 ›</Text>
    </Pressable>
    <ActionSheet visible={confirming} title={`改到${NAME[other]}？`} onClose={() => setConfirming(false)} dismissOnOutsideTap
      actions={[{ label: `改到${NAME[other]}`, onPress: () => { void change(); } }, { label: '取消', onPress: () => setConfirming(false) }]}>
      <Text style={styles.body}>{`公告會先打開${NAME[other]}那一頁，獎品改看${NAME[other]}的清單。已經得到的積分不會變。`}</Text>
      {failed ? <Text accessibilityRole="alert" style={styles.error}>沒有存到，請檢查網路後再試一次。</Text> : null}
    </ActionSheet>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: theme.control.tap, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  label: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  value: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  change: { minHeight: theme.control.tap, minWidth: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  changeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  error: { color: theme.colors.danger, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
});
