import { StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';

export function ProgressCard({ completed, target, personal, points, pointsStatus, monthly, goalTarget, goalAchieved, scope = 'group' }: { completed: number; target: number; personal: number; points: number; pointsStatus: string; monthly?: { personalCompleted: number; points: number; periodStart: string; periodEnd: string }; goalTarget?: number; goalAchieved?: boolean; scope?: 'group' | 'local' }) {
  const ratio = target ? Math.round((completed / target) * 100) : 0;
  return (
    <View style={styles.card} accessible accessibilityRole="summary">
      <View style={styles.head}>
        <Text style={styles.title}>{scope === 'group' ? '本週一起讀' : '本機今日讀經'}</Text>
        <Text style={styles.big}>{completed}/{target}<Text style={styles.unit}> 人次</Text></Text>
      </View>
      <View style={styles.track} accessibilityLabel={`${scope === 'group' ? '小組共同進度' : '本機今日讀經進度'}${ratio}%`}>
        <View style={[styles.fill, { width: `${Math.min(100, ratio)}%` }]} />
      </View>
      {scope === 'group' && goalTarget !== undefined && <Text style={styles.body}>{goalAchieved ? '本週共同目標已達成' : `本週共同目標：${goalTarget} 人次`}</Text>}
      <Text style={styles.body}>你的完成：{personal} 次　積分：{points}（{pointsStatus === 'UNCONFIGURED' ? '政策待設定' : '已啟用'}）</Text>
      {monthly && <Text style={styles.body}>本月個人累積：{monthly.personalCompleted} 次／{monthly.points} 積分（{monthly.periodStart.replaceAll('-', '/')}～{monthly.periodEnd.replaceAll('-', '/')}）</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // The metric shares the title baseline instead of owning its own band: same
  // information, about 40dp less height, and the number still leads the block.
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  title: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '700' },
  big: { color: theme.colors.primary, fontSize: theme.type.metric.size, lineHeight: theme.type.metric.line, fontWeight: '800' },
  unit: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  track: { height: 10, overflow: 'hidden', backgroundColor: theme.colors.primarySoft, borderRadius: 5 },
  fill: { height: '100%', backgroundColor: theme.colors.primary, borderRadius: 5 },
  body: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
