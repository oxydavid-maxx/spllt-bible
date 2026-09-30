import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Announcement } from '../services/announcementClient';
import type { EventRegistrationSummary } from '../services/eventRegistrationClient';
import { theme } from './Theme';
import { taipeiDate } from '../domain/gamificationV1';

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
  /** Sign-ups for the next gathering: a count, whether you signed up, and which friends did. */
  registration?: EventRegistrationSummary | null;
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
  const [year, month, day] = week.split('-');
  const date = `${Number(month)}/${Number(day)}`;
  return year === taipeiDate().slice(0, 4) ? date : `${year}/${date}`;
}

export function AnnouncementBoard({ announcement, stale, onOpen, registration }: AnnouncementBoardProps) {
  const { sermon, next, standing, past } = announcement;
  return <ScrollView contentContainerStyle={styles.page}>
    {next ? <View style={styles.card} accessibilityLabel="下次聚會">
      <Text style={styles.eyebrow}>{`下次 ${next.date}`}</Text>
      {next.sessions && next.sessions.length > 0
        ? next.sessions.map((session) => <View key={session.label} style={styles.session} accessibilityLabel={session.label}>
            <Text style={styles.sessionTag}>{session.label}</Text>
            <View style={styles.sessionCopy}>
              <Text style={styles.sessionTitle}>{session.title}</Text>
              {session.kind || session.owner ? <Text style={styles.muted}>{[session.kind, session.owner].filter(Boolean).join(' · ')}</Text> : null}
            </View>
          </View>)
        : <>
            <Text style={styles.headline}>{next.topic}</Text>
            {next.owner ? <Text style={styles.muted}>{next.owner}</Text> : null}
          </>}
      {next.signup ? <Pressable
        accessibilityRole="button" accessibilityLabel="報名"
        onPress={() => onOpen(next.signup!)} style={styles.primaryButton}
      ><Text style={styles.primaryButtonText}>報名</Text></Pressable> : null}
      {registration && registration.total > 0 ? <View accessibilityLabel="報名狀況" style={styles.signups}>
        <Text style={styles.muted}>{`已有 ${registration.total} 人報名${registration.registered ? '，包括你' : ''}`}</Text>
        {registration.friends.length > 0 ? <Text style={styles.friends}>{`朋友：${registration.friends.join('、')}`}</Text> : null}
      </View> : null}
      {next.roles && next.roles.length > 0 ? <View style={styles.roles} accessibilityLabel="服事">
        <Text style={styles.eyebrow}>服事</Text>
        <View style={styles.roleGrid}>
          {next.roles.map((role) => <View key={role.label} style={styles.role}>
            <Text style={styles.roleLabel}>{role.label}</Text>
            <Text style={styles.roleValue}>{role.value}</Text>
          </View>)}
        </View>
      </View> : null}
    </View> : null}

    {sermon ? <View style={styles.card} accessibilityLabel="上次講道">
      <Text style={styles.eyebrow}>上次講道</Text>
      <Text style={styles.headline}>{sermon.title ?? '講道'}</Text>
      <Text style={styles.muted}>{[sermon.speaker, sermon.passage].filter(Boolean).join(' · ')}</Text>
      <LinkRow
        links={[['錄音', sermon.audio], ['講道投影片', sermon.sermonSlides ?? null], ['報告投影片', sermon.slides], ['逐字稿', sermon.transcript], ['影片', sermon.youtube]]}
        onOpen={onOpen}
      />
    </View> : null}

    {past.length > 0 ? <View style={styles.card} accessibilityLabel="以前的主日">
      <Text style={styles.eyebrow}>以前的主日</Text>
      {past.map((week) => <View key={week.week} style={styles.pastRow}>
        <Text style={styles.pastTitle}>{[shortWeek(week.week), week.speaker, week.title].filter(Boolean).join(' · ')}</Text>
        <LinkRow links={[['錄音', week.audio], ['講道投影片', week.sermonSlides ?? null], ['報告投影片', week.slides], ['逐字稿', week.transcript]]} onOpen={onOpen} />
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
  session: { flexDirection: 'row', gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  sessionTag: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: theme.radius.chip, backgroundColor: theme.colors.primarySoft, color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xxs },
  sessionCopy: { flex: 1, minWidth: 0 },
  sessionTitle: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  roles: { marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, gap: theme.spacing.xs },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.spacing.md, rowGap: theme.spacing.xxs },
  role: { flexDirection: 'row', flexBasis: '45%', flexGrow: 1, gap: theme.spacing.xs, minWidth: 0 },
  roleLabel: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  roleValue: { flexShrink: 1, color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, paddingTop: theme.spacing.xs },
  link: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  linkText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  primaryButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, marginTop: theme.spacing.xs },
  primaryButtonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
  signups: { gap: 2, paddingTop: theme.spacing.xs },
  friends: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  pastRow: { flexDirection: 'column', alignItems: 'stretch', gap: theme.spacing.xxs, paddingVertical: theme.spacing.xxs },
  pastTitle: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  standing: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  standingLink: { minHeight: theme.control.tap, justifyContent: 'center' },
  stale: { color: theme.colors.muted, fontSize: theme.type.caption.size, textAlign: 'center', paddingTop: theme.spacing.xs },
});
