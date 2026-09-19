import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RewardNomination } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/**
 * The board where students say what they want the prizes to be.
 *
 * Deliberately plain. The point is that a prize on the shelf was somebody's idea, which is worth
 * more than any amount of decoration around the idea. A row is a name, who suggested it, and how
 * many people want it.
 */

export interface NominationBoardProps {
  nominations: RewardNomination[];
  canManage: boolean;
  onNominate: (name: string, note: string) => void;
  onVote: (nominationId: string, voting: boolean) => void;
  onDecide?: (nominationId: string, decision: 'approve' | 'decline' | 'remove', revision: number, costPoints?: number) => void;
}

const STATUS_LABEL: Record<RewardNomination['status'], string> = {
  OPEN: '',
  APPROVED: '已成為獎品',
  DECLINED: '這次沒有採用',
};

export function NominationBoard({ nominations, canManage, onNominate, onVote, onDecide }: NominationBoardProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [price, setPrice] = useState<Record<string, string>>({});

  const submit = () => {
    if (!name.trim()) return;
    onNominate(name.trim(), note.trim());
    setName('');
    setNote('');
  };

  return <View style={styles.card} accessibilityLabel="想要什麼獎品">
    <Text accessibilityRole="header" style={styles.heading}>想要什麼獎品</Text>

    {nominations.map((nomination) => <View key={nomination.nominationId} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={2}>{nomination.name}</Text>
        {nomination.note ? <Text style={styles.note} numberOfLines={2}>{nomination.note}</Text> : null}
        <Text style={styles.by}>{`${nomination.displayName} 提名${STATUS_LABEL[nomination.status] ? ` · ${STATUS_LABEL[nomination.status]}` : ''}`}</Text>
      </View>
      {nomination.status === 'OPEN' ? <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: nomination.voted }}
        accessibilityLabel={`${nomination.voted ? '取消想要' : '我也想要'}：${nomination.name}，目前 ${nomination.voteCount} 人`}
        onPress={() => onVote(nomination.nominationId, !nomination.voted)}
        style={[styles.vote, nomination.voted && styles.voted]}
      >
        <Text style={[styles.voteCount, nomination.voted && styles.votedText]}>{nomination.voteCount}</Text>
        <Text style={[styles.voteLabel, nomination.voted && styles.votedText]}>想要</Text>
      </Pressable> : null}
    </View>)}

    {canManage && onDecide ? nominations.filter((nomination) => nomination.status === 'OPEN').map((nomination) => <View key={`manage-${nomination.nominationId}`} style={styles.manageRow}>
      <Text style={styles.manageName} numberOfLines={1}>{nomination.name}</Text>
      <TextInput
        accessibilityLabel={`${nomination.name} 的積分`}
        keyboardType="number-pad"
        placeholder="積分"
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

    <View style={styles.composer}>
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
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  heading: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  rowText: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  name: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  by: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  vote: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong },
  voted: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  voteCount: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  voteLabel: { color: theme.colors.muted, fontSize: theme.type.micro.size },
  votedText: { color: theme.colors.white },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  manageName: { flex: 1, minWidth: 0, color: theme.colors.muted, fontSize: theme.type.caption.size },
  priceInput: { width: 64, minHeight: theme.control.tap, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, paddingHorizontal: theme.spacing.xs, color: theme.colors.ink, fontSize: theme.type.caption.size },
  manageAction: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xs },
  manageActionText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
  removeText: { color: theme.colors.danger, fontSize: theme.type.caption.size, fontWeight: '800' },
  composer: { gap: theme.spacing.xs, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, paddingTop: theme.spacing.sm },
  input: { minHeight: theme.control.tap, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, paddingHorizontal: theme.spacing.sm, color: theme.colors.ink, fontSize: theme.type.body.size },
  submit: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  submitText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
});
