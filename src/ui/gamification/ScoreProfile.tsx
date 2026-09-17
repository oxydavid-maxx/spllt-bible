import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reward, ScoreChartQuery, ScoreProfile as ScoreProfileData } from '../../services/gamificationApiClient';
import { theme } from '../Theme';
import { ScoreProfileChart } from './ScoreProfileChart';

export function ScoreProfile({ profile, onChooseReward, onOpenActions, onChartChange, today }: { profile: ScoreProfileData; onChooseReward?: () => void; onOpenActions?: () => void; onChartChange?: (query: ScoreChartQuery) => void; today?: string }) {
  const privateData = profile.private;
  // Redeemable equals earned until something was redeemed; repeating the same number three times
  // only confuses. The balance line appears once the two diverge, with what was spent.
  const redeemed = privateData ? Math.max(0, profile.earnedTotal - privateData.redeemableBalance) : 0;
  const showBalance = privateData !== undefined && privateData.redeemableBalance !== profile.earnedTotal;
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <Text style={styles.name}>{profile.displayName}</Text>
      <Text style={styles.total}>{profile.earnedTotal}</Text>
      <Text style={styles.totalLabel}>總積分</Text>
      {profile.band == null ? <Text style={styles.bandPending}>滿 10 人開始分梯隊</Text> : <Text style={styles.band}>{`第 ${profile.band} 梯隊`}</Text>}
    </View>
    <ScoreProfileChart chart={profile.chart} fallbackMonths={profile.months} onChartChange={onChartChange} today={today} />
    {privateData ? <View style={styles.card}>
      {showBalance ? <><Text style={styles.cardTitle}>可兌換積分</Text><Text style={styles.balance}>{privateData.redeemableBalance}</Text><Text style={styles.targetLabel}>{`已兌換 ${redeemed} 分`}</Text></> : null}
      <Text style={showBalance ? styles.targetLabel : styles.cardTitle}>目標獎品</Text>
      {privateData.targetReward ? <><Text style={styles.target}>{privateData.targetReward.name} · {privateData.targetReward.costPoints} 分</Text><Text accessibilityLabel={`兌換進度${Math.min(privateData.redeemableBalance, privateData.targetReward.costPoints)}/${privateData.targetReward.costPoints} 分`} style={styles.progress}>{Math.min(privateData.redeemableBalance, privateData.targetReward.costPoints)}/{privateData.targetReward.costPoints} 分</Text></> : <Text style={styles.muted}>尚未設定獎品</Text>}
      {profile.permissions.canEditTarget && onChooseReward ? <Pressable accessibilityRole="button" accessibilityLabel="選擇獎品" onPress={onChooseReward} style={styles.button}><Text style={styles.buttonText}>選擇獎品</Text></Pressable> : null}
    </View> : null}
    {profile.permissions.canRedeem && onOpenActions ? <Pressable accessibilityRole="button" accessibilityLabel="管理兌換" onPress={onOpenActions} style={styles.adminButton}><Text style={styles.adminText}>現場兌換</Text></Pressable> : null}
  </ScrollView>;
}

export type { Reward };
const styles = StyleSheet.create({
  content: { gap: theme.spacing.md, paddingBottom: theme.spacing.xl }, header: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.lg, borderLeftColor: theme.colors.primary, borderLeftWidth: theme.control.rail, gap: theme.spacing.xxs }, name: { color: theme.colors.ink, fontSize: theme.type.title.size, fontWeight: '800' }, total: { color: theme.colors.primaryDeep, fontSize: 42, lineHeight: 48, fontWeight: '800' }, totalLabel: { color: theme.colors.muted, fontSize: theme.type.label.size }, band: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '700' }, bandPending: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line }, card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm }, cardTitle: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' }, balance: { color: theme.colors.primaryDeep, fontSize: theme.type.metric.size, fontWeight: '800' }, targetLabel: { color: theme.colors.muted, fontSize: theme.type.caption.size }, target: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' }, progress: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' }, muted: { color: theme.colors.muted, fontSize: theme.type.body.size }, button: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary }, buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' }, adminButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary }, adminText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
});
