import { StyleSheet, Text, View } from 'react-native';
import type { Redemption } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/** 我的領取紀錄. Rows come from the Google Sheet (維護者 2026-10-17); a wrong row is fixed there, not here. */
export function RedemptionList({ redemptions }: { redemptions: Redemption[] }) {
  return <View style={styles.list}>{redemptions.length === 0 ? <Text style={styles.empty}>目前沒有領取紀錄。</Text> : redemptions.map((item) => <View key={item.redemptionId} style={styles.row}><View style={styles.copy}><Text style={styles.name}>{item.rewardName}</Text><Text style={styles.detail}>{item.costPoints} 分 · {item.status === 'REVERSED' ? '已撤銷' : '已完成'}</Text></View></View>)}</View>;
}

const styles = StyleSheet.create({ list: { gap: theme.spacing.xs }, row: { minHeight: theme.control.tap, padding: theme.spacing.sm, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm }, copy: { flex: 1, gap: theme.spacing.xxs }, name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' }, detail: { color: theme.colors.muted, fontSize: theme.type.caption.size }, empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.md } });
