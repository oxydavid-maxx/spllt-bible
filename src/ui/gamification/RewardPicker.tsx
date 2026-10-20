import { StyleSheet, Text, View } from 'react-native';
import type { Reward } from '../../services/gamificationApiClient';
import type { Congregation } from '../../services/devotionClient';
import { theme } from '../Theme';
import { SIDE_NAME, whereSentence } from '../congregation/congregationCopy';
import { SideSwitch } from '../congregation/SideSwitch';
import { RewardControls } from './RewardControls';

const PRIZE_TAB: Record<Congregation, string> = { youth: '青少獎品', main: '主堂獎品' };

/** 「主堂的獎品還沒上架。同工在試算表「主堂獎品」分頁加上後，這裡就會出現。」 */
export function noPrizesYet(side: Congregation): string {
  return `${SIDE_NAME[side]}的獎品還沒上架。同工在試算表「${PRIZE_TAB[side]}」分頁加上後，這裡就會出現。`;
}

/**
 * 選擇目標獎品 with 「主堂獎品｜青少獎品」 (維護者 2026-10-20, mock v3 ④). It opens on the member's own side, the only
 * side they can aim at. The other side's prizes can be looked at: listed, dimmed, with nothing to press, and one
 * sentence saying why. The server refuses the other side's prize as a target too (PUT /api/me/reward-target).
 */
export function RewardPicker({ own, viewing, ownRewards, otherRewards, otherFailed = false, selectedRewardId, onView, onSelect }: {
  own: Congregation;
  viewing: Congregation;
  ownRewards: Reward[];
  /** The other side's list; null while it is on its way. */
  otherRewards: Reward[] | null;
  otherFailed?: boolean;
  selectedRewardId?: string | null;
  onView: (side: Congregation) => void;
  onSelect: (rewardId: string) => void;
}) {
  const other = otherRewards?.filter((reward) => reward.active) ?? null;
  return <View style={styles.container}>
    <SideSwitch labels={PRIZE_TAB} selected={viewing} onSelect={onView} />
    {viewing === own
      ? <RewardControls rewards={ownRewards} selectedRewardId={selectedRewardId} canEdit onSelect={onSelect} emptyText={noPrizesYet(own)} />
      : otherFailed ? <Text accessibilityRole="alert" style={styles.empty}>{`沒有讀到${SIDE_NAME[viewing]}的獎品，請稍後再試。`}</Text>
        : other === null ? <Text style={styles.empty}>載入中…</Text>
          : other.length === 0 ? <Text style={[styles.empty, styles.emptyBox]}>{noPrizesYet(viewing)}</Text>
            : <>
              {other.map((reward) => <View key={reward.rewardId} accessible accessibilityLabel={`${reward.name} ${reward.costPoints} 分，不能選`} style={styles.seen}>
                <Text style={styles.seenName}>{reward.name}</Text>
                <Text style={styles.seenCost}>{`${reward.costPoints} 分`}</Text>
              </View>)}
              <Text style={styles.why}>{`${whereSentence(own)}，${SIDE_NAME[viewing]}的獎品看得到、不能選。`}</Text>
            </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.sm },
  empty: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, textAlign: 'center', padding: theme.spacing.md },
  emptyBox: { borderRadius: theme.radius.chip, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border },
  // Dimmed, not greyed to nothing: the names and points still read, they just are not offered.
  seen: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
  seenName: { flex: 1, color: theme.colors.muted, fontSize: theme.type.body.size },
  seenCost: { color: theme.colors.muted, fontSize: theme.type.label.size, fontWeight: '700' },
  why: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
