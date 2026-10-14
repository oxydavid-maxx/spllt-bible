import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Announcement } from '../services/announcementClient';
import type { EventRegistrationSummary } from '../services/eventRegistrationClient';
import { theme } from './Theme';
import { taipeiDate } from '../domain/gamificationV1';
import { nextDateBlock, sermonWeeks, shortRole, shortWeek, type BoardLink, type BoardSession } from './announcementModel';

/**
 * The notice board (維護者 2026-10-14): the next gathering under a dark date block, then 講道紀錄 —
 * one card per Sunday, newest first, the date down the left — then how to get there.
 *
 * Anything the published file does not carry simply is not drawn; there are no empty states here,
 * because an absent block says more than a block saying it is absent.
 */

export interface AnnouncementBoardProps {
  announcement: Announcement;
  /** Shown only when the device copy is being used because the fetch failed. */
  stale?: boolean;
  onOpen: (url: string) => void;
  /** Sign-ups for the next gathering: a count, whether you signed up, and which friends did. */
  registration?: EventRegistrationSummary | null;
}

function LinkIcon({ kind }: { kind: BoardLink['kind'] }) {
  return <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={theme.colors.primary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {kind === 'audio' ? <><Path d="M4 15v-3a8 8 0 0 1 16 0v3" /><Rect x={3} y={14} width={4} height={6} rx={1} /><Rect x={17} y={14} width={4} height={6} rx={1} /></>
      : kind === 'slides' ? <><Rect x={3} y={4} width={18} height={12} rx={1} /><Path d="M12 16v4M8 20h8" /></>
        : kind === 'video' ? <><Rect x={3} y={5} width={18} height={14} rx={2} /><Path d="M10 9l5 3-5 3z" /></>
          : <><Path d="M6 3h8l4 4v14H6z" /><Path d="M14 3v4h4M9 12h6M9 16h6" /></>}
  </Svg>;
}

function TextLink({ link, onOpen, last }: { link: BoardLink; onOpen: (url: string) => void; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={link.label} onPress={() => onOpen(link.url)} style={[styles.textLink, last && styles.textLinkLast]}>
    <LinkIcon kind={link.kind} /><Text style={styles.textLinkText}>{link.label}</Text>
  </Pressable>;
}

function SessionTag({ label }: { label: string }) {
  return <Text style={styles.sessionTag}>{label}</Text>;
}

function SermonSession({ session, first, onOpen }: { session: BoardSession; first: boolean; onOpen: (url: string) => void }) {
  if (session.compact) return <View style={[styles.compactSession, !first && styles.sessionDivider]} accessibilityLabel={session.label ?? undefined}>
    {session.label ? <SessionTag label={session.label} /> : null}
    <Text style={styles.compactTitle}>{session.title}</Text>
    {session.links.length ? <><View style={styles.spacer} /><TextLink link={session.links[0]} onOpen={onOpen} last /></> : null}
  </View>;
  return <View style={[styles.sermonSession, !first && styles.sessionDivider]} accessibilityLabel={session.label ?? undefined}>
    <View style={styles.titleLine}>
      {session.label ? <SessionTag label={session.label} /> : null}
      <Text style={styles.sessionTitle}>{session.title}</Text>
    </View>
    {session.byline ? <Text style={styles.byline}>{session.byline}</Text> : null}
    {session.links.length ? <View style={styles.textLinks}>{session.links.map((link) => <TextLink key={`${link.label}:${link.url}`} link={link} onOpen={onOpen} />)}</View> : null}
  </View>;
}

export function AnnouncementBoard({ announcement, stale, onOpen, registration }: AnnouncementBoardProps) {
  const { next, standing } = announcement;
  const today = taipeiDate();
  const weeks = sermonWeeks(announcement);
  const block = next ? nextDateBlock(next.date, announcement.week) : null;
  return <ScrollView contentContainerStyle={styles.page}>
    {next ? <View style={styles.nextCard} accessibilityLabel="下次聚會">
      <View style={styles.dateBlock} accessible accessibilityLabel={`下次聚會 ${next.date}`}>
        {block ? <><Text style={styles.dateBlockSmall}>{block.month}</Text><Text style={styles.dateBlockDay}>{block.day}</Text>{block.weekday ? <Text style={styles.dateBlockSmall}>{block.weekday}</Text> : null}</> : <Text style={styles.dateBlockDay}>{next.date}</Text>}
      </View>
      <View style={styles.nextCopy}>
        <Text style={styles.nextEyebrow}>下次聚會</Text>
        {next.sessions && next.sessions.length > 0
          ? next.sessions.map((session) => <View key={session.label} style={styles.nextSession} accessibilityLabel={session.label}>
              <View style={styles.titleLine}><SessionTag label={session.label} /><Text style={styles.sessionTitle}>{session.title}</Text></View>
              {session.kind || session.owner ? <Text style={styles.nextByline}>{[session.kind, session.owner].filter(Boolean).join(' · ')}</Text> : null}
            </View>)
          : <>
              <Text style={styles.sessionTitle}>{next.topic}</Text>
              {next.owner ? <Text style={styles.byline}>{next.owner}</Text> : null}
            </>}
        {next.signup ? <Pressable accessibilityRole="button" accessibilityLabel="報名" onPress={() => onOpen(next.signup!)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>報名</Text></Pressable> : null}
        {registration && registration.total > 0 ? <View accessibilityLabel="報名狀況" style={styles.signups}>
          <Text style={styles.byline}>{`已有 ${registration.total} 人報名${registration.registered ? '，包括你' : ''}`}</Text>
          {registration.friends.length > 0 ? <Text style={styles.friends}>{`朋友：${registration.friends.join('、')}`}</Text> : null}
        </View> : null}
        {next.roles && next.roles.length > 0 ? <View style={styles.roleGrid} accessibilityLabel="服事">
          {next.roles.map((role) => <Text key={role.label} style={styles.role} accessibilityLabel={`${role.label} ${role.value}`}>
            <Text style={styles.roleLabel}>{shortRole(role.label)}</Text>{' '}<Text style={styles.roleValue}>{role.value}</Text>
          </Text>)}
        </View> : null}
      </View>
    </View> : null}

    {weeks.length ? <>
      <View style={styles.sectionHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>講道紀錄</Text><View style={styles.sectionRule} /></View>
      <View style={styles.weeks} accessibilityLabel="講道紀錄">
        {weeks.map((week) => <View key={week.week} style={styles.weekCard} accessibilityLabel={`${shortWeek(week.week, today)} 的講道`}>
          <View style={styles.weekDate}>
            <Text style={styles.weekDateText}>{shortWeek(week.week, today)}</Text>
            {week.latest ? <Text style={styles.latest}>上週</Text> : null}
          </View>
          <View style={styles.weekBody}>
            {week.sessions.map((session, index) => <SermonSession key={`${index}:${session.label ?? ''}`} session={session} first={index === 0} onOpen={onOpen} />)}
          </View>
        </View>)}
      </View>
    </> : null}

    {standing ? <View style={styles.card} accessibilityLabel="常設資訊">
      {Object.entries(standing).map(([label, value]) => (/^https?:\/\//.test(value)
        ? <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(value)} style={styles.standingLink}>
            <Text style={styles.textLinkText}>{label}</Text>
          </Pressable>
        : <Text key={label} style={styles.standing}>{`${label}：${value}`}</Text>))}
    </View> : null}

    {/* Last, and quiet. Being a week out of date matters less than the board looking broken. */}
    {stale ? <Text style={styles.stale}>{`目前顯示 ${shortWeek(announcement.week, today)} 的公告，還沒連上更新`}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: theme.spacing.md, gap: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.xxs },
  nextCard: { flexDirection: 'row', gap: theme.spacing.md, backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md },
  dateBlock: { width: 58, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.sm, borderRadius: 10, backgroundColor: theme.colors.primary },
  dateBlockSmall: { color: theme.colors.white, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '700' },
  dateBlockDay: { color: theme.colors.white, fontSize: 26, lineHeight: 30, fontWeight: '800' },
  nextCopy: { flex: 1, minWidth: 0, gap: 6 },
  nextEyebrow: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '800' },
  nextSession: { gap: 2 },
  nextByline: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  sessionTag: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: theme.radius.chip, backgroundColor: theme.colors.primarySoft, color: theme.colors.primary, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '800', paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  sessionTitle: { flexShrink: 1, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  byline: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 1, borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border, paddingTop: 6 },
  role: { flexBasis: '45%', flexGrow: 1, minWidth: 0, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  roleLabel: { color: theme.colors.muted },
  roleValue: { color: theme.colors.ink, fontWeight: '700' },
  primaryButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, marginTop: theme.spacing.xs },
  primaryButtonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
  signups: { gap: 2 },
  friends: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingTop: 6, paddingHorizontal: theme.spacing.xxs },
  sectionTitle: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  sectionRule: { flex: 1, height: theme.control.hairline, backgroundColor: theme.colors.border },
  weeks: { gap: theme.spacing.sm },
  weekCard: { flexDirection: 'row', overflow: 'hidden', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card },
  weekDate: { width: 58, alignItems: 'center', gap: 2, paddingVertical: theme.spacing.md, backgroundColor: theme.colors.primarySoft },
  weekDateText: { color: theme.colors.primary, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  latest: { overflow: 'hidden', color: theme.colors.white, backgroundColor: theme.colors.accent, borderRadius: 6, fontSize: 11, lineHeight: 15, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1 },
  weekBody: { flex: 1, minWidth: 0, paddingTop: 10, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs },
  sermonSession: { flexDirection: 'column', alignItems: 'stretch', paddingBottom: 2 },
  sessionDivider: { borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.background, paddingTop: theme.spacing.sm },
  compactSession: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  compactTitle: { flexShrink: 1, color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  spacer: { flex: 1 },
  textLinks: { flexDirection: 'row', flexWrap: 'wrap' },
  textLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: 14 },
  textLinkLast: { paddingRight: 0 },
  textLinkText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  standing: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  standingLink: { minHeight: theme.control.tap, justifyContent: 'center' },
  stale: { color: theme.colors.muted, fontSize: theme.type.caption.size, textAlign: 'center', paddingTop: theme.spacing.xs },
});
