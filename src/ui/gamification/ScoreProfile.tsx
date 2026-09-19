import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reward, ScoreChartQuery, ScoreProfile as ScoreProfileData } from '../../services/gamificationApiClient';
import { theme } from '../Theme';
import { RewardGoalCard } from './RewardGoalCard';
import { ScoreProfileChart } from './ScoreProfileChart';

export function ScoreProfile({ profile, rewards, onChooseReward, onChooseTarget, onOpenActions, onChartChange, today, nominations, community }: {
  profile: ScoreProfileData;
  /** Active reward catalogue for the member's own shelf. */
  rewards?: Reward[];
  onChooseReward?: () => void;
  onChooseTarget?: (rewardId: string) => void;
  onOpenActions?: () => void;
  onChartChange?: (query: ScoreChartQuery) => void;
  today?: string;
  /**
   * Rendered inside this screen's scroll container rather than beside it. Placing it as a sibling in
   * the route would nest one scroller inside another, which is how a list stops scrolling properly.
   */
  nominations?: ReactNode;
  /** Sits below the calendar: the group's reading, never a target. */
  community?: ReactNode;
}) {
  const privateData = profile.private;
  return <ScrollView contentContainerStyle={styles.content}>
    {privateData ? <RewardGoalCard target={privateData.targetReward} redeemableBalance={privateData.redeemableBalance} earnedTotal={profile.earnedTotal} rewards={rewards} canEditTarget={profile.permissions.canEditTarget} onChooseTarget={onChooseTarget} onOpenPicker={onChooseReward} displayName={profile.displayName} band={profile.band} /> : <View style={styles.header}>
      <Text style={styles.name}>{profile.displayName}</Text>
      <Text style={styles.total}>{profile.earnedTotal}</Text>
      <Text style={styles.totalLabel}>總積分</Text>
      {profile.band == null ? <Text style={styles.bandPending}>滿 10 人開始分梯隊</Text> : <Text style={styles.band}>{`第 ${profile.band} 梯隊`}</Text>}
    </View>}
    {nominations}
    <ScoreProfileChart chart={profile.chart} fallbackMonths={profile.months} onChartChange={onChartChange} today={today} />
    {community}
    {profile.permissions.canRedeem && onOpenActions ? <Pressable accessibilityRole="button" accessibilityLabel="管理兌換" onPress={onOpenActions} style={styles.adminButton}><Text style={styles.adminText}>現場兌換</Text></Pressable> : null}
  </ScrollView>;
}

export type { Reward };
const styles = StyleSheet.create({
  content: { gap: theme.spacing.sm, paddingBottom: theme.spacing.xl }, header: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md, borderLeftColor: theme.colors.primary, borderLeftWidth: theme.control.rail, gap: theme.spacing.xxs }, name: { color: theme.colors.ink, fontSize: theme.type.title.size, fontWeight: '800' }, total: { color: theme.colors.primaryDeep, fontSize: 42, lineHeight: 48, fontWeight: '800' }, totalLabel: { color: theme.colors.muted, fontSize: theme.type.label.size }, band: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '700' }, bandPending: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line }, adminButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary }, adminText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
});
