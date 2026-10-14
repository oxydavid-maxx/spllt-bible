import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { ScoreHistory } from '../../services/devotionClient';
import { MONTHLY_BOX, TOTAL_BOX, monthBars, totalChart } from './scoreHistoryModel';
import { theme } from '../Theme';

/**
 * The 積分 page's one chart (維護者 2026-10-14): 總積分 (default) or 每月. Green is reading points;
 * the gold dashed line is 靈修, which earns no points and only sits beside them.
 */

type View_ = 'total' | 'monthly';

function DashSwatch() {
  return <View style={styles.dashSwatch} />;
}

export function ScoreHistoryCard({ history }: { history: ScoreHistory }) {
  const [view, setView] = useState<View_>('total');
  const total = totalChart(history);
  const bars = monthBars(history);
  const thisMonth = history.months.find((month) => month.month === history.today.slice(0, 7))?.points ?? 0;
  return <View style={styles.card}>
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(['total', 'monthly'] as const).map((item, index) => {
        const selected = item === view;
        return <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item === 'total' ? '總積分' : '每月'} onPress={() => setView(item)} style={[styles.tab, index > 0 && styles.tabDivider, selected && styles.tabSelected]}>
          <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item === 'total' ? '總積分' : '每月'}</Text>
        </Pressable>;
      })}
    </View>
    <View style={styles.subtitleRow}>
      <Text style={styles.subtitle}>{view === 'total' ? '從第一天到今天' : '每個月得到的積分'}</Text>
      <Text style={styles.headline}>{view === 'total' ? `${total?.pointsTotal ?? 0} 分` : `本月 ${thisMonth} 分`}</Text>
    </View>
    {view === 'total' ? (total ? <>
      <View style={styles.totalSvg}><Svg viewBox={`0 0 ${TOTAL_BOX.width} ${TOTAL_BOX.height}`} width="100%" height="100%" accessibilityLabel={`總積分折線圖：從第一天的 0 分開始，到今天累積 ${total.pointsTotal} 分；靈修 ${total.devotionsTotal} 天`}>
        <Line x1={TOTAL_BOX.left} y1={TOTAL_BOX.bottom} x2={326} y2={TOTAL_BOX.bottom} stroke={theme.colors.borderStrong} strokeWidth={1} />
        <Line x1={TOTAL_BOX.left} y1={82} x2={326} y2={82} stroke={theme.colors.border} strokeWidth={1} strokeDasharray="3 3" />
        <Line x1={TOTAL_BOX.left} y1={TOTAL_BOX.top} x2={326} y2={TOTAL_BOX.top} stroke={theme.colors.border} strokeWidth={1} strokeDasharray="3 3" />
        <SvgText x={18} y={134} fontSize={11} fill={theme.colors.muted} textAnchor="end">0</SvgText>
        <SvgText x={18} y={86} fontSize={11} fill={theme.colors.muted} textAnchor="end">{String(total.top / 2)}</SvgText>
        <SvgText x={18} y={38} fontSize={11} fill={theme.colors.muted} textAnchor="end">{String(total.top)}</SvgText>
        <Polyline points={total.devotions} fill="none" stroke={theme.colors.goldLine} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
        <Polyline points={total.points} fill="none" stroke={theme.colors.primary} strokeWidth={2.5} strokeLinejoin="round" />
        <Circle cx={total.end.x} cy={total.end.y} r={5} fill={theme.colors.primary} />
        <SvgText x={TOTAL_BOX.left} y={150} fontSize={11} fill={theme.colors.muted}>第一天</SvgText>
        {total.monthTicks.map((tick) => <SvgText key={tick.label} x={tick.x} y={150} fontSize={11} fill={theme.colors.muted} textAnchor="middle">{tick.label}</SvgText>)}
        <SvgText x={326} y={150} fontSize={11} fill={theme.colors.muted} textAnchor="end">今天</SvgText>
      </Svg></View>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={styles.lineSwatch} /><Text style={styles.legendText}>{`讀經積分 ${total.pointsTotal} 分`}</Text></View>
        <View style={styles.legendItem}><DashSwatch /><Text style={styles.legendText}>{`靈修 ${total.devotionsTotal}`}</Text></View>
      </View>
    </> : <Text style={styles.empty}>讀經計畫開始後，這裡會畫出你的積分</Text>) : <>
      <View style={[styles.legend, styles.legendRight]}>
        <View style={styles.legendItem}><View style={styles.barSwatch} /><Text style={styles.legendText}>讀經</Text></View>
        <View style={styles.legendItem}><DashSwatch /><Text style={styles.legendText}>靈修</Text></View>
      </View>
      {bars.length > 0 ? <View style={bars.length > 2 ? styles.monthlySvgTall : styles.monthlySvg}><Svg viewBox={`0 0 ${MONTHLY_BOX.width} ${bars.length > 2 ? 156 : MONTHLY_BOX.height}`} width="100%" height="100%" accessibilityLabel={`每月柱狀圖：${bars.map((bar) => `${bar.label}讀經 ${bar.points}${bar.devotion ? `、靈修 ${bar.devotion.days}` : ''}`).join('，')}`}>
        <Line x1={20} y1={MONTHLY_BOX.baseline} x2={310} y2={MONTHLY_BOX.baseline} stroke={theme.colors.border} strokeWidth={1} />
        {bars.map((bar) => {
          const middle = bar.x + MONTHLY_BOX.barWidth / 2;
          const barColor = bar.devotion?.onBar ? theme.colors.goldOnPrimary : theme.colors.goldText;
          return <G key={bar.month}>
            {bar.points > 0 ? <Rect x={bar.x} y={bar.top} width={MONTHLY_BOX.barWidth} height={MONTHLY_BOX.baseline - bar.top} rx={6} fill={theme.colors.primary} /> : null}
            <SvgText x={middle} y={bar.top - 7} fontSize={14} fontWeight="800" fill={theme.colors.ink} textAnchor="middle">{String(bar.points)}</SvgText>
            {bar.devotion ? <>
              <Line x1={bar.x} y1={bar.devotion.y} x2={middle - 9} y2={bar.devotion.y} stroke={barColor} strokeWidth={2} strokeDasharray="4 3" />
              <Line x1={middle + 9} y1={bar.devotion.y} x2={bar.x + MONTHLY_BOX.barWidth} y2={bar.devotion.y} stroke={barColor} strokeWidth={2} strokeDasharray="4 3" />
              <SvgText x={middle} y={bar.devotion.y + 4.5} fontSize={13} fill={barColor} textAnchor="middle">{String(bar.devotion.days)}</SvgText>
            </> : null}
            <SvgText x={middle} y={131} fontSize={13} fontWeight="700" fill={theme.colors.ink} textAnchor="middle">{bar.current && bars.length <= 2 ? `${bar.label} (到今天)` : bar.label}</SvgText>
            {bar.current && bars.length > 2 ? <SvgText x={middle} y={146} fontSize={11} fill={theme.colors.muted} textAnchor="middle">到今天</SvgText> : null}
          </G>;
        })}
      </Svg></View> : <Text style={styles.empty}>讀經計畫開始後，這裡會畫出每個月的積分</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: 14, gap: theme.spacing.sm },
  tabs: { flexDirection: 'row', borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.button, overflow: 'hidden' },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  tabDivider: { borderLeftWidth: theme.control.hairline, borderLeftColor: theme.colors.borderStrong },
  tabSelected: { backgroundColor: theme.colors.primarySoft },
  tabText: { color: theme.colors.muted, fontSize: theme.type.body.size, fontWeight: '700' },
  tabTextSelected: { color: theme.colors.primary, fontWeight: '800' },
  subtitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 2 },
  subtitle: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  headline: { color: theme.colors.primary, fontSize: 16, fontWeight: '800' },
  totalSvg: { width: '100%', aspectRatio: TOTAL_BOX.width / TOTAL_BOX.height },
  monthlySvg: { width: '100%', aspectRatio: MONTHLY_BOX.width / MONTHLY_BOX.height },
  monthlySvgTall: { width: '100%', aspectRatio: MONTHLY_BOX.width / 156 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  legendRight: { justifyContent: 'flex-end', columnGap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  lineSwatch: { width: 16, height: 3, borderRadius: 2, backgroundColor: theme.colors.primary },
  barSwatch: { width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.primary },
  dashSwatch: { width: 16, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.goldLine },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, paddingVertical: theme.spacing.lg },
});
