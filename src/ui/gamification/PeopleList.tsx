import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PersonListItem } from '../../services/gamificationApiClient';
import { SIDE_NAME } from '../congregation/congregationCopy';
import { theme } from '../Theme';

/**
 * `showCongregation`: 全體 (管理) only (維護者 2026-10-20). A small 主堂 or 青少 beside each name, so the people who
 * run it can see someone counted on the wrong side and tell them to change it; only the server's 全體 list
 * carries the side, friends never see it.
 */
export function PeopleList({ people, showRank = false, showCongregation = false, onSelect }: { people: PersonListItem[]; showRank?: boolean; showCongregation?: boolean; onSelect: (person: PersonListItem) => void }) {
  return <FlatList data={people} keyExtractor={(person) => person.memberId} contentContainerStyle={styles.list} renderItem={({ item }) => {
    const side = showCongregation && item.congregation ? item.congregation : null;
    return <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.displayName}的積分${side ? `，${SIDE_NAME[side]}` : ''}`} onPress={() => onSelect(item)} style={styles.row}>
      <View style={styles.copy}><Text style={styles.name} numberOfLines={1}>{item.displayName}</Text><Text style={styles.total}>{item.earnedTotal} 總積分</Text></View>
      {side ? <Text style={[styles.badge, side === 'main' && styles.badgeMain]}>{SIDE_NAME[side]}</Text> : null}
      {showRank ? <Text style={styles.rank}>{item.rank == null ? '—' : `第 ${item.rank} 名`}</Text> : <Text style={styles.chevron}>›</Text>}
    </Pressable>;
  }} ListEmptyComponent={<Text style={styles.empty}>目前沒有資料。</Text>} />;
}

const styles = StyleSheet.create({
  list: { gap: theme.spacing.xs, paddingBottom: theme.spacing.md },
  row: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline },
  copy: { flex: 1, gap: theme.spacing.xxs }, name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' }, total: { color: theme.colors.muted, fontSize: theme.type.caption.size }, rank: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, chevron: { color: theme.colors.primary, fontSize: 28, lineHeight: 32 }, empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.lg },
  badge: { overflow: 'hidden', color: theme.colors.primary, backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.sm, paddingVertical: 1, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '800' },
  badgeMain: { borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
});
