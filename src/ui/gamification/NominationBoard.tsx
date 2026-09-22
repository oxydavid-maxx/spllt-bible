import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NominationRound, RewardNomination } from '../../services/gamificationApiClient';
import { describeDeadline } from '../../domain/nominationRound';
import { theme } from '../Theme';

/**
 * The round: everybody's one idea, how many people want each, and the date it closes.
 *
 * Deliberately plain. The point is that a prize on the shelf was somebody's idea, which is worth
 * more than any amount of decoration around the idea. A row is a name, who suggested it, roughly
 * what it would cost, and how many people want it.
 *
 * Two things are shown to one person only. The rewrite offered on a note goes to whoever wrote the
 * note, and the button to take an idea back belongs to whoever put it forward. Neither is a
 * permission check here — the server decides both — but neither is drawn for anybody else either.
 */

export interface NominationBoardProps {
  round: NominationRound | null;
  nominations: RewardNomination[];
  canManage: boolean;
  /** Now, for the countdown. Passed in so the page is a function of its inputs. */
  nowMs: number;
  /** Votes this member has left, and how many they started with. Three, because three prizes win. */
  votesLeft?: number;
  votesPerMember?: number;
  onNominate: (name: string, note: string) => void;
  onVote: (nominationId: string, voting: boolean) => void;
  onWithdraw?: (nominationId: string) => void;
  onResolveSuggestion?: (nominationId: string, accept: boolean) => void;
  onDecide?: (nominationId: string, decision: 'approve' | 'decline' | 'remove', revision: number, costPoints?: number) => void;
  onCloseRound?: (roundId: string) => void;
}

const STATUS_LABEL: Record<RewardNomination['status'], string> = {
  OPEN: '',
  APPROVED: '已成為獎品',
  DECLINED: '這次沒有採用',
};

export function NominationBoard({
  round, nominations, canManage, nowMs, votesLeft, votesPerMember = 3, onNominate, onVote, onWithdraw, onResolveSuggestion, onDecide, onCloseRound,
}: NominationBoardProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState<Record<string, string>>({});

  const voting = round?.phase === 'VOTING';
  // Said out loud, because a board of tick boxes reads as "tick what you like" and this one is
  // "choose three". Somebody who thinks it is unlimited ticks everything, and a list where nothing
  // is ranked is the same as not voting. The number also has to be visible before the first tick:
  // a limit discovered by hitting it is a trap, not a rule.
  const remaining = typeof votesLeft === 'number' ? votesLeft : votesPerMember;
  const spent = remaining <= 0;
  const alreadyMine = nominations.some((nomination) => nomination.mine && nomination.status === 'OPEN');

  const submit = () => {
    if (!name.trim()) return;
    onNominate(name.trim(), note.trim());
    setName('');
    setNote('');
  };

  return <View style={styles.card} accessibilityLabel="想要什麼獎品">
    {round ? <View style={styles.roundHead}>
      <Text accessibilityRole="header" style={styles.heading}>{round.title ?? '想要什麼獎品'}</Text>
      <Text style={styles.deadline}>{voting ? describeDeadline(round.closesAt, nowMs) : '投票結束,等輔導決定'}</Text>
      {voting ? <Text style={[styles.votesLeft, spent && styles.votesSpent]}>
        {spent ? `${votesPerMember} 票投完了,想改就先取消一票` : `選 ${votesPerMember} 個,還有 ${remaining} 票`}
      </Text> : null}
    </View> : <Text accessibilityRole="header" style={styles.heading}>想要什麼獎品</Text>}

    {nominations.map((nomination) => <View key={nomination.nominationId} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={2}>{nomination.name}</Text>
        {nomination.note ? <Text style={styles.note} numberOfLines={3}>{nomination.note}</Text> : null}
        <Text style={styles.by}>
          {`${nomination.displayName} 提名`}
          {nomination.estimatedPoints === undefined ? '' : ` · 約 ${nomination.estimatedPoints} 分`}
          {STATUS_LABEL[nomination.status] ? ` · ${STATUS_LABEL[nomination.status]}` : ''}
        </Text>

        {/* The author's own controls. Offered to them because it is their idea and their words. */}
        {nomination.mine && nomination.noteSuggestion && onResolveSuggestion ? <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>{nomination.noteSuggestion}</Text>
          <View style={styles.suggestionActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="採用這個說法" onPress={() => onResolveSuggestion(nomination.nominationId, true)} style={styles.suggestionAction}>
              <Text style={styles.suggestionAccept}>採用</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="維持我寫的" onPress={() => onResolveSuggestion(nomination.nominationId, false)} style={styles.suggestionAction}>
              <Text style={styles.suggestionKeep}>維持我寫的</Text>
            </Pressable>
          </View>
        </View> : null}
        {nomination.mine && nomination.status === 'OPEN' && voting && onWithdraw ? <Pressable
          accessibilityRole="button" accessibilityLabel={`撤回 ${nomination.name}`}
          onPress={() => onWithdraw(nomination.nominationId)} style={styles.withdraw}
        ><Text style={styles.withdrawText}>撤回</Text></Pressable> : null}
      </View>

      {/* Out of votes disables the ones not yet picked and leaves the picked ones alive, because
          taking a vote back is how somebody changes their mind — disabling those too would strand
          them on a choice they have already regretted. */}
      {nomination.status === 'OPEN' ? <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: nomination.voted, disabled: !voting || (spent && !nomination.voted) }}
        accessibilityLabel={`${nomination.voted ? '取消想要' : spent ? `票投完了，先取消一票才能選：${nomination.name}` : '我也想要'}${nomination.voted || !spent ? `：${nomination.name}，目前 ${nomination.voteCount} 人` : ''}`}
        disabled={!voting || (spent && !nomination.voted)}
        onPress={() => onVote(nomination.nominationId, !nomination.voted)}
        style={[styles.vote, nomination.voted && styles.voted, (!voting || (spent && !nomination.voted)) && styles.voteClosed]}
      >
        <Text style={[styles.voteCount, nomination.voted && styles.votedText]}>{nomination.voteCount}</Text>
        <Text style={[styles.voteLabel, nomination.voted && styles.votedText]}>想要</Text>
      </Pressable> : null}
    </View>)}

    {/* The composer comes before the 輔導 controls: a member's own action should not sit below
        a block of administrative chrome, where the sheet cuts it off. */}
    {/* One idea each, so the composer is gone once yours is in. Taking it back brings it back. */}
    {round && voting && !alreadyMine ? <View style={styles.composer}>
      <TextInput
        accessibilityLabel="獎品名稱"
        placeholder="你想要什麼獎品？"
        placeholderTextColor={theme.colors.muted}
        maxLength={40}
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="補充說明"
        placeholder="想說的話（可留白）"
        placeholderTextColor={theme.colors.muted}
        maxLength={200}
        value={note}
        onChangeText={setNote}
        style={styles.input}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="提名獎品" onPress={submit} style={styles.submit}>
        <Text style={styles.submitText}>提名</Text>
      </Pressable>
    </View> : null}
    {canManage && onDecide ? nominations.filter((nomination) => nomination.status === 'OPEN').map((nomination) => <View key={`manage-${nomination.nominationId}`} style={styles.manageRow}>
      <Text style={styles.manageName} numberOfLines={1}>{nomination.name}</Text>
      <TextInput
        accessibilityLabel={`${nomination.name} 的積分`}
        keyboardType="number-pad"
        placeholder={nomination.estimatedPoints === undefined ? '積分' : String(nomination.estimatedPoints)}
        placeholderTextColor={theme.colors.muted}
        value={price[nomination.nominationId] ?? ''}
        onChangeText={(value) => setPrice((current) => ({ ...current, [nomination.nominationId]: value }))}
        style={styles.priceInput}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={`核准 ${nomination.name}`} onPress={() => {
        const costPoints = Number(price[nomination.nominationId]);
        if (Number.isSafeInteger(costPoints) && costPoints > 0) onDecide(nomination.nominationId, 'approve', nomination.revision, costPoints);
      }} style={styles.manageAction}><Text style={styles.manageActionText}>核准</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`婉拒 ${nomination.name}`} onPress={() => onDecide(nomination.nominationId, 'decline', nomination.revision)} style={styles.manageAction}><Text style={styles.manageActionText}>婉拒</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`移除 ${nomination.name}`} onPress={() => onDecide(nomination.nominationId, 'remove', nomination.revision)} style={styles.manageAction}><Text style={styles.removeText}>移除</Text></Pressable>
    </View>) : null}

    {canManage && round && onCloseRound ? <Pressable
      accessibilityRole="button" accessibilityLabel="結束這一輪" onPress={() => onCloseRound(round.roundId)} style={styles.closeRound}
    ><Text style={styles.closeRoundText}>結束這一輪</Text></Pressable> : null}

  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  roundHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  heading: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800', flexShrink: 1 },
  votesLeft: { color: theme.colors.primaryDeep, fontSize: theme.type.caption.size, fontWeight: '800' },
  votesSpent: { color: theme.colors.muted },
  deadline: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  rowText: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  by: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  suggestion: { borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, padding: theme.spacing.xs, gap: theme.spacing.xxs },
  suggestionText: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  suggestionActions: { flexDirection: 'row', gap: theme.spacing.sm },
  suggestionAction: { minHeight: theme.control.tap, justifyContent: 'center' },
  suggestionAccept: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
  suggestionKeep: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  withdraw: { minHeight: theme.control.tap, justifyContent: 'center' },
  withdrawText: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  vote: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong },
  voted: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  voteClosed: { opacity: 0.6 },
  voteCount: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  voteLabel: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  votedText: { color: theme.colors.white },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  manageName: { flex: 1, minWidth: 0, color: theme.colors.muted, fontSize: theme.type.caption.size },
  priceInput: { width: 64, minHeight: theme.control.tap, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, paddingHorizontal: theme.spacing.xs, color: theme.colors.ink, fontSize: theme.type.caption.size },
  manageAction: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xs },
  manageActionText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
  removeText: { color: theme.colors.danger, fontSize: theme.type.caption.size, fontWeight: '800' },
  closeRound: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong },
  closeRoundText: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '800' },
  composer: { gap: theme.spacing.xs, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, paddingTop: theme.spacing.sm },
  input: { minHeight: theme.control.tap, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, paddingHorizontal: theme.spacing.sm, color: theme.colors.ink, fontSize: theme.type.body.size },
  submit: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  submitText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
});
