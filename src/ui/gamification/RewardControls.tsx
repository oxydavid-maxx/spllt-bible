import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Reward } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/**
 * The member's own side's prizes in 選擇目標獎品. The prizes are kept in the Google Sheet (維護者 2026-10-17); the app
 * only lists them. The sheet title already says 選擇目標獎品, and the list is the whole point of opening it, so it
 * has no heading of its own and nothing to fold away (2026-10-20, with the 主堂獎品｜青少獎品 switch above it).
 */
export function RewardControls({ rewards, selectedRewardId, canEdit, onSelect, emptyText = '尚未設定獎品' }: { rewards: Reward[]; selectedRewardId?: string | null; canEdit: boolean; onSelect?: (rewardId: string) => void; emptyText?: string }) {
  const active = rewards.filter((reward) => reward.active);
  return <View style={styles.container}>{active.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}{active.map((reward) => <View key={reward.rewardId} style={styles.row}><Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedRewardId === reward.rewardId }} disabled={!canEdit} onPress={() => reward.rewardId !== selectedRewardId ? onSelect?.(reward.rewardId) : undefined} style={styles.choice}><Text style={styles.name}>{reward.name}</Text><Text style={styles.cost}>{reward.costPoints} 分</Text></Pressable></View>)}</View>;
}
const styles = StyleSheet.create({ container: { gap: theme.spacing.xs }, empty: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, textAlign: 'center', padding: theme.spacing.md, borderRadius: theme.radius.chip, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border }, row: { minHeight: theme.control.tap, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border }, choice: { flex: 1, minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }, name: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size }, cost: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' } });
