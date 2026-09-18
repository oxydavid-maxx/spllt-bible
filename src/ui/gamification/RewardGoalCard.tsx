import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Reward } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

// The reward a member is saving for sits at the top of their own points page (Octalysis CD4
// Ownership + CD2 progress bar; the "last mile" is shown as an honest fraction, never as a nag).
// Copy rules from the product owner: the fraction reads `72/120 分`; no "還差 N 分", no slogans.

const RING_SIZE = 72;
const RING_STROKE = 8;

export function ProgressRing({ value, max, size = RING_SIZE }: { value: number; max: number; size?: number }) {
  const radius = (size - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return <View style={{ width: size, height: size }} accessible accessibilityRole="progressbar" accessibilityLabel="兌換進度" accessibilityValue={{ min: 0, max, now: Math.min(value, max), text: `${Math.min(value, max)}/${max} 分` }}>
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.colors.primarySoft} strokeWidth={RING_STROKE} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.colors.primary} strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
    <View pointerEvents="none" style={styles.ringLabel}><Text style={styles.ringValue}>{Math.min(value, max)}</Text><Text style={styles.ringMax}>{`/${max} 分`}</Text></View>
  </View>;
}

export function RewardGoalCard({ target, redeemableBalance, earnedTotal, rewards, canEditTarget, onChooseTarget, onOpenPicker, displayName, band }: {
  target: Reward | null;
  redeemableBalance: number;
  earnedTotal: number;
  /** Active catalogue for the shelf; omitted or empty hides the shelf. */
  rewards?: Reward[];
  canEditTarget: boolean;
  onChooseTarget?: (rewardId: string) => void;
  /** Legacy picker sheet; kept for callers that still open it. */
  onOpenPicker?: () => void;
  /** When given, the member's total/band line joins this card so the page top is one compact block. */
  displayName?: string;
  band?: number | null;
}) {
  const redeemed = Math.max(0, earnedTotal - redeemableBalance);
  const shelf = (rewards ?? []).filter((reward) => reward.active);
  const reachable = target !== null && redeemableBalance >= target.costPoints;
  return <View style={styles.card} accessibilityLabel="目標獎品">
    {target ? <View style={styles.goalRow}>
      <ProgressRing value={redeemableBalance} max={target.costPoints} />
      <View style={styles.goalCopy}>
        <Text style={styles.eyebrow}>目標獎品</Text>
        <Text style={styles.goalName} numberOfLines={2}>{target.name}</Text>
        <Text style={styles.goalCost}>{`${target.costPoints} 分`}</Text>
        {reachable ? <Text style={styles.ready}>可以兌換了 · 主日找輔導領取</Text> : null}
        {redeemed > 0 ? <Text style={styles.muted}>{`可兌換 ${redeemableBalance} 分 · 已兌換 ${redeemed} 分`}</Text> : null}
      </View>
    </View> : <View style={styles.goalCopy}>
      <Text style={styles.goalName}>選一個目標獎品</Text>
      <Text style={styles.muted}>每天讀經得到的積分，會往你選的獎品前進。</Text>
      {redeemed > 0 ? <Text style={styles.muted}>{`可兌換 ${redeemableBalance} 分 · 已兌換 ${redeemed} 分`}</Text> : null}
    </View>}
    {shelf.length > 0 && canEditTarget ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf} accessibilityLabel="獎品架">
      {shelf.map((reward) => {
        const selected = target?.rewardId === reward.rewardId;
        const ratio = reward.costPoints > 0 ? Math.min(1, redeemableBalance / reward.costPoints) : 0;
        return <Pressable key={reward.rewardId} accessibilityRole="button" accessibilityLabel={`${selected ? '目前目標：' : '設為目標：'}${reward.name} ${reward.costPoints} 分`} accessibilityState={{ selected }} onPress={() => onChooseTarget?.(reward.rewardId)} style={[styles.shelfCard, selected && styles.shelfCardSelected]}>
          <Text style={[styles.shelfName, selected && styles.shelfNameSelected]} numberOfLines={2}>{reward.name}</Text>
          <Text style={[styles.shelfCost, selected && styles.shelfNameSelected]}>{`${reward.costPoints} 分`}</Text>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(ratio * 100)}%` }, selected && styles.barFillSelected]} /></View>
          <Text style={[styles.shelfState, selected && styles.shelfNameSelected]}>{selected ? '目標' : redeemableBalance >= reward.costPoints ? '可兌換' : `${Math.min(redeemableBalance, reward.costPoints)}/${reward.costPoints}`}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {canEditTarget && onOpenPicker && shelf.length === 0 ? <Pressable accessibilityRole="button" accessibilityLabel="選擇獎品" onPress={onOpenPicker} style={styles.button}><Text style={styles.buttonText}>選擇獎品</Text></Pressable> : null}
    {displayName !== undefined ? <View style={styles.totalRow}><Text style={styles.totalName} numberOfLines={1}>{displayName}</Text><Text style={styles.totalValue}>{earnedTotal}</Text><Text style={styles.totalLabel}>總積分</Text><Text style={styles.totalBand} numberOfLines={1}>{band == null ? '滿 10 人開始分梯隊' : `第 ${band} 梯隊`}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, borderLeftColor: theme.colors.primary, borderLeftWidth: theme.control.rail, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, gap: theme.spacing.sm },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, paddingTop: theme.spacing.sm },
  totalName: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800', flexShrink: 1 },
  totalValue: { color: theme.colors.primaryDeep, fontSize: theme.type.metric.size, lineHeight: theme.type.metric.line, fontWeight: '800' },
  totalLabel: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  totalBand: { color: theme.colors.muted, fontSize: theme.type.caption.size, marginLeft: 'auto', flexShrink: 1 },
  goalCopy: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  eyebrow: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  goalName: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  goalCost: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  ready: { color: theme.colors.primaryDeep, fontSize: theme.type.label.size, fontWeight: '800' },
  muted: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  ringLabel: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringValue: { color: theme.colors.primaryDeep, fontSize: 20, lineHeight: 24, fontWeight: '800' },
  ringMax: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '700' },
  shelf: { gap: theme.spacing.sm },
  shelfCard: { width: 116, minHeight: theme.control.tap, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, gap: theme.spacing.xxs },
  shelfCardSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  shelfName: { color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
  shelfNameSelected: { color: theme.colors.white },
  shelfCost: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '700' },
  shelfState: { color: theme.colors.muted, fontSize: theme.type.micro.size, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: theme.colors.primarySoft, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  barFillSelected: { backgroundColor: theme.colors.white },
  button: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
});
