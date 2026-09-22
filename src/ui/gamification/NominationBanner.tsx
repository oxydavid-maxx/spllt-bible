import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NominationRound } from '../../services/gamificationApiClient';
import { describeDeadline } from '../../domain/nominationRound';
import { theme } from '../Theme';

/**
 * One line at the top of the points page while a prize round is running, and nothing at all when
 * one is not.
 *
 * The board used to sit on this page permanently, which made a thing that happens twice a term look
 * like part of the furniture. A round is an event: it appears, it has a date, and it goes away. The
 * page underneath goes back to being about your own reading when it does.
 */

export interface NominationBannerProps {
  round: NominationRound;
  nowMs: number;
  /** Whether this member has already put an idea in. Changes the invitation, not the access. */
  mine: boolean;
  onOpen: () => void;
}

export function NominationBanner({ round, nowMs, mine, onOpen }: NominationBannerProps) {
  const voting = round.phase === 'VOTING';
  const action = !voting ? '看結果' : mine ? '看看大家的' : '我要提案';
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${round.title ?? '獎品提案'}，${action}`}
    onPress={onOpen}
    style={styles.banner}
  >
    <View style={styles.text}>
      <Text style={styles.title} numberOfLines={1}>{round.title ?? '獎品提案'}</Text>
      <Text style={styles.when}>{voting ? describeDeadline(round.closesAt, nowMs) : '投票結束,等輔導決定'}</Text>
    </View>
    <Text style={styles.action}>{action}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: theme.control.tap, borderRadius: theme.radius.card, backgroundColor: theme.colors.primarySoft, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.sm },
  text: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.primaryDeep, fontSize: theme.type.label.size, fontWeight: '800' },
  when: { color: theme.colors.primaryDeep, fontSize: theme.type.caption.size },
  action: { color: theme.colors.primaryDeep, fontSize: theme.type.label.size, fontWeight: '800' },
});
