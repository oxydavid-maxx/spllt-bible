import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Reward } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/** 選擇目標獎品. The prizes are kept in the Google Sheet (維護者 2026-10-17); the app only lists them. */
export function RewardControls({ rewards, selectedRewardId, canEdit, onSelect }: { rewards: Reward[]; selectedRewardId?: string | null; canEdit: boolean; onSelect?: (rewardId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const active = rewards.filter((reward) => reward.active);
  const visible = expanded || Boolean(selectedRewardId) ? active : [];
  return <View style={styles.container}><Text style={styles.label}>選擇目標獎品</Text>{visible.length === 0 ? <Text style={styles.empty}>尚未設定獎品</Text> : null}{visible.map((reward) => <View key={reward.rewardId} style={styles.row}><Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedRewardId === reward.rewardId }} disabled={!canEdit} onPress={() => reward.rewardId !== selectedRewardId ? onSelect?.(reward.rewardId) : undefined} style={styles.choice}><Text style={styles.name}>{reward.name}</Text><Text style={styles.cost}>{reward.costPoints} 分</Text></Pressable></View>)}{canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="顯示獎品選擇" onPress={() => setExpanded(!expanded)} style={styles.toggle}><Text style={styles.toggleText}>{expanded ? '收起' : '選擇獎品'}</Text></Pressable> : null}</View>;
}
const styles = StyleSheet.create({ container: { gap: theme.spacing.xs }, label: { color: theme.colors.muted, fontSize: theme.type.caption.size }, empty: { color: theme.colors.muted, fontSize: theme.type.label.size }, row: { minHeight: theme.control.tap, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border }, choice: { flex: 1, minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }, name: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size }, cost: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, toggle: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderColor: theme.colors.primary, borderWidth: theme.control.hairline }, toggleText: { color: theme.colors.primary, fontWeight: '800' } });
