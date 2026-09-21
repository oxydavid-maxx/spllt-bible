import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Announcement } from '../services/announcementClient';
import { theme } from './Theme';

/**
 * The notice board: what is on next, what was preached last, and how to get there.
 *
 * Ordered by how long each thing stays useful. The sermon is at the top because it is the only part
 * with a life after Sunday — the run of show and the sign-up are worthless by Monday, and the
 * address never changes. Anything the published file does not carry simply is not drawn; there are
 * no empty states here, because an absent block says more than a block saying it is absent.
 */

export interface AnnouncementBoardProps {
  announcement: Announcement;
  /** Shown only when the device copy is being used because the fetch failed. */
  stale?: boolean;
  onOpen: (url: string) => void;
}

function LinkRow({ links, onOpen }: { links: Array<[string, string | null]>; onOpen: (url: string) => void }) {
  const present = links.filter((pair): pair is [string, string] => Boolean(pair[1]));
  if (present.length === 0) return null;
  return <View style={styles.links}>
    {present.map(([label, url]) => <Pressable
      key={label} accessibilityRole="button" accessibilityLabel={label}
      onPress={() => onOpen(url)} style={styles.link}
    ><Text style={styles.linkText}>{label}</Text></Pressable>)}
  </View>;
}

function shortWeek(week: string): string {
  const [, month, day] = week.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function AnnouncementBoard({ announcement, stale, onOpen }: AnnouncementBoardProps) {
  const { sermon, next, standing, past } = announcement;
  return <ScrollView contentContainerStyle={styles.page}>
    {next ? <View style={styles.card} accessibilityLabel="下次聚會">
      <Text style={styles.eyebrow}>{`下次 ${next.date}`}</Text>
      <Text style={styles.headline}>{next.topic}</Text>
      {next.owner ? <Text style={styles.muted}>{next.owner}</Text> : null}
      {next.signup ? <Pressable
        accessibilityRole="button" accessibilityLabel="報名"
        onPress={() => onOpen(next.signup!)} style={styles.primaryButton}
      ><Text style={styles.primaryButtonText}>報名</Text></Pressable> : null}
    </View> : null}

    {sermon ? <View style={styles.card} accessibilityLabel="上次講道">
      <Text style={styles.eyebrow}>上次講道</Text>
      <Text style={styles.headline}>{sermon.title ?? '講道'}</Text>
      <Text style={styles.muted}>{[sermon.speaker, sermon.passage].filter(Boolean).join(' · ')}</Text>
      <LinkRow
        links={[['錄音', sermon.audio], ['投影片', sermon.slides], ['逐字稿', sermon.transcript], ['影片', sermon.youtube]]}
        onOpen={onOpen}
      />
    </View> : null}

    {past.length > 0 ? <View style={styles.card} accessibilityLabel="以前的主日">
      <Text style={styles.eyebrow}>以前的主日</Text>
      {past.map((week) => <View key={week.week} style={styles.pastRow}>
        <Text style={styles.pastWeek}>{shortWeek(week.week)}</Text>
        <Text style={styles.pastTitle} numberOfLines={1}>{week.title ?? ''}</Text>
        <LinkRow links={[['錄音', week.audio], ['投影片', week.slides], ['逐字稿', week.transcript]]} onOpen={onOpen} />
      </View>)}
    </View> : null}

    {standing ? <View style={styles.card} accessibilityLabel="常設資訊">
      {Object.entries(standing).map(([label, value]) => (/^https?:\/\//.test(value)
        ? <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(value)} style={styles.standingLink}>
            <Text style={styles.linkText}>{label}</Text>
          </Pressable>
        : <Text key={label} style={styles.standing}>{`${label}：${value}`}</Text>))}
    </View> : null}

    {/* Last, and quiet. Being a week out of date matters less than the board looking broken. */}
    {stale ? <Text style={styles.stale}>{`目前顯示 ${shortWeek(announcement.week)} 的公告，還沒連上更新`}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: theme.spacing.md, gap: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.xxs },
  eyebrow: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  headline: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  muted: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingTop: theme.spacing.xs },
  link: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  linkText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  primaryButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, marginTop: theme.spacing.xs },
  primaryButtonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxs },
  pastWeek: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800', minWidth: 48 },
  pastTitle: { flex: 1, minWidth: 0, color: theme.colors.muted, fontSize: theme.type.caption.size },
  standing: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  standingLink: { minHeight: theme.control.tap, justifyContent: 'center' },
  stale: { color: theme.colors.muted, fontSize: theme.type.caption.size, textAlign: 'center', paddingTop: theme.spacing.xs },
});
