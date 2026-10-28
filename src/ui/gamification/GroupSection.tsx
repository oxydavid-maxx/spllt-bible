import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Congregation, GroupReading, createDevotionClient } from '../../services/devotionClient';
import { switchStarted } from '../../services/switchLatencyProbe';
import { useViewCache, viewCacheKey, type ViewCacheRequest } from '../../services/viewCache';
import { CongregationLine } from '../congregation/CongregationLine';
import { theme } from '../Theme';
import { GroupReadingCard } from './GroupReadingCard';
import { shiftMonth } from './readingCalendarModel';

/**
 * 團體 on the 積分 page, with the 「全教會｜青少」 switch and its months. Its own component, holding its own side and
 * month (光佑 2026-10-23:「速度要完全無感非常的快」): a tap redraws this card only, never the rest of the page (the
 * day card, the calendar, the chart). What it shows comes from the shared store in the tap's own render, asked ahead
 * when the page opened (src/services/viewCache.ts).
 */
export interface GroupSectionProps {
  memberId: string;
  sessionToken: string;
  client: Pick<ReturnType<typeof createDevotionClient>, 'getGroupReading'> | null;
  /** Where the member counts; null while unknown (the first-run choice is then on screen). */
  ownSide: Congregation | null;
  /** The member's own page is on screen and its points have settled. */
  active: boolean;
  /** This visit's start (viewCache.beginVisit()). */
  freshSince: number;
  /** A new number starts again on the member's own side (each focus, a change of side). */
  resetSignal: number;
  today: string;
  /** The first month the arrows can reach. */
  firstMonth: string;
  /**
   * Where the card was, held by the page across 自己｜好友 (the card is not drawn on 好友, so it is mounted again on
   * 自己): the side and month stay as they were, as they did when the page held them.
   */
  memory: GroupSectionMemory;
}
export interface GroupSectionMemory { side: Congregation | null; month: string | null; reset: number }

function GroupSectionView({ memberId, sessionToken, client, ownSide, active, freshSince, resetSignal, today, firstMonth, memory }: GroupSectionProps) {
  const [groupSide, setGroupSide] = useState<Congregation | null>(() => memory.reset === resetSignal ? memory.side : null);
  const [groupMonth, setGroupMonth] = useState(() => memory.month ?? today.slice(0, 7));
  const [groupRetry, setGroupRetry] = useState(0);
  // Each opening starts on the member's own side (維護者 2026-10-20), set in the same render as the signal.
  const [seenReset, setSeenReset] = useState(resetSignal);
  if (seenReset !== resetSignal) { setSeenReset(resetSignal); setGroupSide(null); }
  useEffect(() => { memory.side = groupSide; memory.month = groupMonth; memory.reset = seenReset; }, [memory, groupSide, groupMonth, seenReset]);
  const session = { memberId, sessionToken };
  const accountKey = JSON.stringify([memberId, sessionToken]);
  const otherSide = (side: Congregation): Congregation => side === 'main' ? 'youth' : 'main';
  // The member's own side asks without naming it, as before (and as an older server understands).
  const groupRequest = (side: Congregation | null, month: string): ViewCacheRequest<GroupReading> | null => client
    ? { key: viewCacheKey(session, 'group', side ?? `own:${ownSide ?? ''}`, month), load: () => side ? client.getGroupReading(month, side) : client.getGroupReading(month) } : null;
  const shownSide = groupSide ?? ownSide;
  const ahead = [
    shownSide ? groupRequest(otherSide(shownSide) === ownSide ? null : otherSide(shownSide), groupMonth) : null,
    groupMonth > firstMonth ? groupRequest(groupSide, shiftMonth(groupMonth, -1)) : null,
    groupMonth < today.slice(0, 7) ? groupRequest(groupSide, shiftMonth(groupMonth, 1)) : null,
  ].filter((item): item is ViewCacheRequest<GroupReading> => item !== null);
  const group = useViewCache(groupRequest(groupSide, groupMonth), { active: Boolean(client) && active, freshSince, ahead, retry: groupRetry });
  // While a side or month not asked yet is on its way, the card keeps what it showed — never another member's.
  const shownGroup = useRef<{ owner: string; view: GroupReading } | null>(null);
  if (group.value) shownGroup.current = { owner: accountKey, view: group.value };
  const groupReading = group.value ?? (shownGroup.current?.owner === accountKey ? shownGroup.current.view : null);
  // A side that could not be read (or an older server that answered with the member's own side) says so on the card.
  const groupFailed = groupSide && ((group.failed && !group.value) || (group.value && group.value.scope !== groupSide)) ? groupSide : null;
  const viewGroup = (side: Congregation) => { switchStarted('group', `${side}:${groupMonth}`, 'group-side'); setGroupRetry((value) => value + 1); setGroupSide(side === ownSide ? null : side); };
  const stepGroupMonth = (step: number) => { const month = shiftMonth(groupMonth, step); switchStarted('group', `${groupSide ?? ownSide ?? groupReading?.scope ?? 'youth'}:${month}`, 'group-month'); setGroupMonth(month); };
  if (!groupReading && !ownSide) return null;
  return <>
    <SectionHeader title="團體" />
    {/* Where I count, said once with its own 改 (維護者 2026-10-20): a wrong side shows up here, in the numbers. */}
    {ownSide ? <CongregationLine variant="points" /> : null}
    {groupReading ? <GroupReadingCard
      view={groupReading}
      own={ownSide}
      onView={ownSide ? viewGroup : undefined}
      failedSide={groupFailed}
      onPreviousMonth={groupMonth > firstMonth ? () => stepGroupMonth(-1) : undefined}
      onNextMonth={groupMonth < today.slice(0, 7) ? () => stepGroupMonth(1) : undefined}
    /> : null}
    <SectionHeader title="個人" />
  </>;
}
export const GroupSection = memo(GroupSectionView);

export function SectionHeader({ title }: { title: string }) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text><View style={styles.sectionRule} /></View>;
}

const styles = StyleSheet.create({
  section: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.xs, paddingHorizontal: theme.spacing.xxs },
  sectionTitle: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  sectionRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: theme.colors.primary },
});
