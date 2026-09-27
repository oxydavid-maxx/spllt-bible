import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NominationRound, RewardNomination } from '../../services/gamificationApiClient';
import { describeDeadline } from '../../domain/nominationRound';
import { theme } from '../Theme';

/**
 * The round: everybody's one idea, how many people want each, and the date it closes.
 *
 * Deliberately plain. The point is that a prize on the shelf was somebody's idea, which is worth
 * more than any amount of decoration around the idea. A row is a name and how much of it, who
 * suggested it, roughly what it would cost, and how many people want it.
 *
 * Three things are shown to one person only. The rewrite offered on a note goes to whoever wrote the
 * note, the reminder about an unpriceable 多少/多久 goes to whoever wrote that, and the button to take
 * an idea back belongs to whoever put it forward. None is a permission check here — the server
 * decides all three — but none is drawn for anybody else either.
 */

/** Same limit as the server: 1 杯, 2 小時, 3 片. */
const MAX_QUANTITY_LENGTH = 20;
/** An idea from before 多少/多久 was asked for. Said here because the server has nothing to say about it. */
const MISSING_QUANTITY_REMINDER = '還沒寫多少/多久，估不出分數。要不要補上？例如 1 小時、2 杯';

export interface NominationBoardProps {
  round: NominationRound | null;
  nominations: RewardNomination[];
  canManage: boolean;
  /** Now, for the countdown. Passed in so the page is a function of its inputs. */
  nowMs: number;
  /** Votes this member has left, and how many they started with. Three, because three prizes win. */
  votesLeft?: number;
  votesPerMember?: number;
  busy?: boolean;
  onNominate: (name: string, note: string, quantity: string) => void | boolean | Promise<void | boolean>;
  onVote: (nominationId: string, voting: boolean) => void;
  /** The author rewrites their own 多少/多久 while the round is voting. */
  onEditQuantity?: (nominationId: string, quantity: string) => void;
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
  round, nominations, canManage, nowMs, votesLeft, votesPerMember = 3, busy = false, onNominate, onVote, onEditQuantity, onWithdraw, onResolveSuggestion, onDecide, onCloseRound,
}: NominationBoardProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ nominationId: string; quantity: string } | null>(null);
  const [price, setPrice] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const voting = round?.phase === 'VOTING';
  // Said out loud, because a board of tick boxes reads as "tick what you like" and this one is
  // "choose three". Somebody who thinks it is unlimited ticks everything, and a list where nothing
  // is ranked is the same as not voting. The number also has to be visible before the first tick:
  // a limit discovered by hitting it is a trap, not a rule.
  const remaining = typeof votesLeft === 'number' ? votesLeft : votesPerMember;
  const spent = remaining <= 0;
  const alreadyMine = nominations.some((nomination) => nomination.mine && nomination.status === 'OPEN');

  // Written by hand every time, never picked: "2 小時", "3 片" and "1 次" are all fine answers.
  const canSubmit = Boolean(name.trim() && quantity.trim());
  const submit = () => {
    if (!canSubmit || busy || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    const finish = (success: void | boolean) => {
      if (success !== false) { setName(''); setQuantity(''); setNote(''); }
      submittingRef.current = false; setSubmitting(false);
    };
    try {
      const result = onNominate(name.trim(), note.trim(), quantity.trim());
      if (result instanceof Promise) void result.then(finish).catch(() => finish(false));
      else finish(result);
    } catch { finish(false); }
  };

  return <View style={styles.card} accessibilityLabel="想要什麼獎品">
    {round ? <View style={styles.roundHead}>
      <Text accessibilityRole="header" style={styles.heading}>{round.title ?? '想要什麼獎品'}</Text>
      <Text style={styles.deadline}>{voting ? describeDeadline(round.closesAt, nowMs) : '投票結束,等輔導決定'}</Text>
      {voting ? <Text style={[styles.votesLeft, spent && styles.votesSpent]}>
        {spent ? `${votesPerMember} 票投完了,想改就先取消一票` : `選 ${votesPerMember} 個,還有 ${remaining} 票`}
      </Text> : null}
    </View> : <Text accessibilityRole="header" style={styles.heading}>想要什麼獎品</Text>}

    {nominations.map((nomination) => {
      const ownOpen = voting && nomination.mine && nomination.status === 'OPEN';
      const reminder = ownOpen ? nomination.quantityReminder ?? (nomination.quantity ? null : MISSING_QUANTITY_REMINDER) : null;
      const editingThis = editing?.nominationId === nomination.nominationId;
      return <View key={nomination.nominationId} style={styles.row}>
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={2}>{nomination.name}</Text>
          {nomination.quantity ? <Text style={styles.quantity}>{nomination.quantity}</Text> : null}
        </View>
        {nomination.note ? <Text style={styles.note} numberOfLines={3}>{nomination.note}</Text> : null}
        <Text style={styles.by}>
          {`${nomination.displayName} 提名`}
          {nomination.estimatedPoints !== undefined ? ` · 約 ${nomination.estimatedPoints} 分` : nomination.status === 'OPEN' ? ' · 還沒估分' : ''}
          {STATUS_LABEL[nomination.status] ? ` · ${STATUS_LABEL[nomination.status]}` : ''}
        </Text>

        {/* Why there is no number, told to the one person who can fix it, with the fix beside it. */}
        {reminder && onEditQuantity ? <View style={styles.reminder}>
          <Text style={styles.reminderText}>{`小提醒：${reminder}`}</Text>
          {editingThis ? <View style={styles.editRow}>
            <TextInput
              accessibilityLabel={`${nomination.name} 的多少或多久`}
              maxLength={MAX_QUANTITY_LENGTH}
              value={editing.quantity}
              editable={!busy}
              onChangeText={(value) => setEditing({ nominationId: nomination.nominationId, quantity: value })}
              style={[styles.input, styles.editInput]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={`儲存 ${nomination.name} 的多少或多久`}
              disabled={busy || !editing.quantity.trim() || editing.quantity.trim() === nomination.quantity}
              onPress={() => { const next = editing.quantity.trim(); if (!next || next === nomination.quantity) return; setEditing(null); onEditQuantity(nomination.nominationId, next); }}
              style={styles.fix}><Text style={styles.fixText}>儲存</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="取消修改" onPress={() => setEditing(null)} style={styles.suggestionAction}>
              <Text style={styles.suggestionKeep}>取消</Text>
            </Pressable>
          </View> : <Pressable accessibilityRole="button" accessibilityLabel={`修改 ${nomination.name} 的多少或多久`} disabled={busy}
            onPress={() => setEditing({ nominationId: nomination.nominationId, quantity: nomination.quantity ?? '' })} style={styles.fix}>
            <Text style={styles.fixText}>修改</Text>
          </Pressable>}
        </View> : null}

        {/* The author's own controls. Offered to them because it is their idea and their words. */}
        {voting && nomination.mine && nomination.status === 'OPEN' && nomination.noteSuggestion && onResolveSuggestion ? <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>{nomination.noteSuggestion}</Text>
          <View style={styles.suggestionActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="採用這個說法" disabled={busy} onPress={() => onResolveSuggestion(nomination.nominationId, true)} style={styles.suggestionAction}>
              <Text style={styles.suggestionAccept}>採用</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="維持我寫的" disabled={busy} onPress={() => onResolveSuggestion(nomination.nominationId, false)} style={styles.suggestionAction}>
              <Text style={styles.suggestionKeep}>維持我寫的</Text>
            </Pressable>
          </View>
        </View> : null}
        {nomination.mine && nomination.status === 'OPEN' && voting && onWithdraw ? <Pressable
          accessibilityRole="button" accessibilityLabel={`撤回 ${nomination.name}`} disabled={busy}
          onPress={() => onWithdraw(nomination.nominationId)} style={styles.withdraw}
        ><Text style={styles.withdrawText}>撤回</Text></Pressable> : null}
      </View>

      {/* Out of votes disables the ones not yet picked and leaves the picked ones alive, because
          taking a vote back is how somebody changes their mind — disabling those too would strand
          them on a choice they have already regretted. */}
      {nomination.status === 'OPEN' ? <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: nomination.voted, disabled: busy || !voting || (spent && !nomination.voted) }}
        accessibilityLabel={`${nomination.voted ? '取消想要' : spent ? `票投完了，先取消一票才能選：${nomination.name}` : '我也想要'}${nomination.voted || !spent ? `：${nomination.name}，目前 ${nomination.voteCount} 人` : ''}`}
        disabled={busy || !voting || (spent && !nomination.voted)}
        onPress={() => onVote(nomination.nominationId, !nomination.voted)}
        style={[styles.vote, nomination.voted && styles.voted, (!voting || (spent && !nomination.voted)) && styles.voteClosed]}
      >
        <Text style={[styles.voteCount, nomination.voted && styles.votedText]}>{nomination.voteCount}</Text>
        <Text style={[styles.voteLabel, nomination.voted && styles.votedText]}>想要</Text>
      </Pressable> : null}
    </View>;
    })}

    {/* The composer comes before the 輔導 controls: a member's own action should not sit below
        a block of administrative chrome, where the sheet cuts it off. */}
    {/* One idea each, so the composer is gone once yours is in. Taking it back brings it back. */}
    {round && voting && !alreadyMine ? <View style={styles.composer}>
      <Text style={styles.fieldLabel}>你想要什麼獎品？</Text>
      <TextInput
        accessibilityLabel="獎品名稱"
        placeholder="例如 唱 KTV"
        placeholderTextColor={theme.colors.muted}
        maxLength={40}
        value={name}
        editable={!busy && !submitting}
        onChangeText={setName}
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>多少/多久？（必填，自己寫）</Text>
      <TextInput
        accessibilityLabel="多少或多久"
        placeholder="例如 2 小時、1 杯"
        placeholderTextColor={theme.colors.muted}
        maxLength={MAX_QUANTITY_LENGTH}
        value={quantity}
        editable={!busy && !submitting}
        onChangeText={setQuantity}
        style={[styles.input, !quantity.trim() && name.trim() ? styles.inputRequired : null]}
      />
      <TextInput
        accessibilityLabel="補充說明"
        placeholder="想說的話（可留白）"
        placeholderTextColor={theme.colors.muted}
        maxLength={200}
        value={note}
        editable={!busy && !submitting}
        onChangeText={setNote}
        style={styles.input}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="提名獎品" accessibilityState={{ disabled: busy || submitting || !canSubmit }} disabled={busy || submitting || !canSubmit} onPress={submit} style={[styles.submit, !canSubmit && styles.submitOff]}>
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
        editable={!busy}
        onChangeText={(value) => setPrice((current) => ({ ...current, [nomination.nominationId]: value }))}
        style={styles.priceInput}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={`核准 ${nomination.name}`} disabled={busy} onPress={() => {
        const costPoints = Number(price[nomination.nominationId]);
        if (Number.isSafeInteger(costPoints) && costPoints > 0) onDecide(nomination.nominationId, 'approve', nomination.revision, costPoints);
      }} style={styles.manageAction}><Text style={styles.manageActionText}>核准</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`婉拒 ${nomination.name}`} disabled={busy} onPress={() => onDecide(nomination.nominationId, 'decline', nomination.revision)} style={styles.manageAction}><Text style={styles.manageActionText}>婉拒</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`移除 ${nomination.name}`} disabled={busy} onPress={() => onDecide(nomination.nominationId, 'remove', nomination.revision)} style={styles.manageAction}><Text style={styles.removeText}>移除</Text></Pressable>
    </View>) : null}

    {canManage && round && onCloseRound ? <Pressable
      accessibilityRole="button" accessibilityLabel="結束這一輪" disabled={busy} onPress={() => onCloseRound(round.roundId)} style={styles.closeRound}
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
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.xs },
  name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700', flexShrink: 1 },
  // The quantity is part of the prize, so it sits on the name's line as a small tag, not in the by-line.
  quantity: { color: theme.colors.primary, backgroundColor: theme.colors.primarySoft, borderRadius: 8, overflow: 'hidden', paddingHorizontal: theme.spacing.xs, fontSize: theme.type.caption.size, fontWeight: '800' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  by: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  suggestion: { borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, padding: theme.spacing.xs, gap: theme.spacing.xxs },
  suggestionText: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  suggestionActions: { flexDirection: 'row', gap: theme.spacing.sm },
  suggestionAction: { minHeight: theme.control.tap, justifyContent: 'center' },
  suggestionAccept: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
  suggestionKeep: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  reminder: { borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft, padding: theme.spacing.xs, gap: theme.spacing.xxs },
  reminderText: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  editInput: { flex: 1 },
  fix: { minHeight: theme.control.tap, alignSelf: 'flex-start', justifyContent: 'center' },
  fixText: { color: theme.colors.accent, fontSize: theme.type.caption.size, fontWeight: '800' },
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
  inputRequired: { borderColor: theme.colors.accent },
  fieldLabel: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '800' },
  submit: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  submitOff: { opacity: 0.5 },
  submitText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
});
