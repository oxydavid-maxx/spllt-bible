import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClientInstallSummary } from '../../domain/gamificationV1';
import type { PersonListItem } from '../../services/gamificationApiClient';
import { SIDE_NAME } from '../congregation/congregationCopy';
import { theme } from '../Theme';

/**
 * Which version a person's phone runs, e.g. 「Android 0.5.35 · 更新 bff271 · 10/21 打開」 (光佑 2026-10-21): the
 * platform, the store version, the end of the running OTA update (as on the account page, src/ui/accountSurface.ts)
 * and the last day the app was opened. 沒有版本紀錄: no app of theirs has reported, i.e. one older than this.
 */
export function clientVersionLabel(client: ClientInstallSummary | null): string {
  if (!client) return '沒有版本紀錄';
  const platform = client.platform === 'ios' ? 'iOS' : 'Android';
  const update = client.updateId ? ` · 更新 ${client.updateId.replace(/-/g, '').slice(-6)}` : '';
  const [, month, day] = client.lastSeenDate.split('-').map(Number);
  return `${platform} ${client.version}${update} · ${month}/${day} 打開`;
}

/**
 * `showCongregation`: 全體 (管理) only (維護者 2026-10-20). A small 主堂 or 青少 beside each name, so the people who
 * run it can see someone counted on the wrong side and tell them to change it; only the server's 全體 list
 * carries the side, friends never see it.
 *
 * `showClient`: 全體 (管理) only (光佑 2026-10-21), the version line under each person. The row stays two lines:
 * the score moves up beside the name, and the version line runs the full width, under the side and rank too.
 */
export function PeopleList({ people, showRank = false, showCongregation = false, showClient = false, onSelect }: { people: PersonListItem[]; showRank?: boolean; showCongregation?: boolean; showClient?: boolean; onSelect: (person: PersonListItem) => void }) {
  return <FlatList data={people} keyExtractor={(person) => person.memberId} contentContainerStyle={styles.list} renderItem={({ item }) => {
    const side = showCongregation && item.congregation ? item.congregation : null;
    const version = showClient ? clientVersionLabel(item.client ?? null) : null;
    const label = `查看${item.displayName}的積分${side ? `，${SIDE_NAME[side]}` : ''}${version ? `，${version}` : ''}`;
    const badge = side ? <Text style={[styles.badge, side === 'main' && styles.badgeMain]}>{SIDE_NAME[side]}</Text> : null;
    const trailing = showRank ? <Text style={styles.rank}>{item.rank == null ? '—' : `第 ${item.rank} 名`}</Text> : <Text style={styles.chevron}>›</Text>;
    if (version !== null) {
      return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSelect(item)} style={[styles.row, styles.stacked]}>
        <View style={styles.top}><Text style={[styles.name, styles.shrink]} numberOfLines={1}>{item.displayName}</Text><Text style={[styles.total, styles.fill]}>{item.earnedTotal} 總積分</Text>{badge}{trailing}</View>
        <Text style={styles.version} numberOfLines={1}>{version}</Text>
      </Pressable>;
    }
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSelect(item)} style={styles.row}>
      <View style={styles.copy}><Text style={styles.name} numberOfLines={1}>{item.displayName}</Text><Text style={styles.total}>{item.earnedTotal} 總積分</Text></View>
      {badge}
      {trailing}
    </Pressable>;
  }} ListEmptyComponent={<Text style={styles.empty}>目前沒有資料。</Text>} />;
}

const styles = StyleSheet.create({
  list: { gap: theme.spacing.xs, paddingBottom: theme.spacing.md },
  row: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline },
  stacked: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: theme.spacing.xxs, paddingVertical: theme.spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  shrink: { flexShrink: 1 }, fill: { flex: 1 },
  version: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  copy: { flex: 1, gap: theme.spacing.xxs }, name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' }, total: { color: theme.colors.muted, fontSize: theme.type.caption.size }, rank: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' }, chevron: { color: theme.colors.primary, fontSize: 28, lineHeight: 32 }, empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.lg },
  badge: { overflow: 'hidden', color: theme.colors.primary, backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.sm, paddingVertical: 1, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '800' },
  badgeMain: { borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
});
