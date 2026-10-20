import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import type { Congregation } from '../../services/devotionClient';
import { ActionSheet } from '../gamification/ActionSheet';
import { useCongregation, type CongregationBinding } from './congregationStore';
import { CHOICES, QUESTION, whereParts, whereSentence } from './congregationCopy';

/**
 * 「我在主堂聚會 (不是青少)」 with its own 「改」 (維護者 2026-10-20, mock v3 ② ⑤). The same line and the same change
 * sheet on the 積分 page (under 團體, where a wrong side shows up in the numbers) and on 我的帳戶; one setting.
 *
 * The sheet says what a change does before it is made: past reading days move to the new side's group numbers
 * (they are counted by where the member is now, server/congregation.ts), points stay. Its button names the change
 * itself, 「改成：我在青少聚會 (不是主堂)」, and stays off until the other side is picked.
 */
export function CongregationLine({ variant }: { variant: 'points' | 'account' }) {
  return <CongregationLineView variant={variant} congregation={useCongregation()} />;
}

/** For a screen that already holds the member's binding (the 積分 page), so it does not read or listen twice. */
export function CongregationLineView({ variant, congregation }: { variant: 'points' | 'account'; congregation: CongregationBinding }) {
  const [open, setOpen] = useState(false);
  if (!congregation.value) return null;
  const parts = whereParts(congregation.value);
  return <View style={variant === 'account' ? styles.accountRow : styles.pointsRow}>
    <Text accessibilityLabel={whereSentence(congregation.value)} style={[styles.says, variant === 'account' && styles.saysAccount]}>
      {`${parts.says} `}<Text style={styles.not}>{parts.not}</Text>
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel="改我在哪裡聚會" hitSlop={4} onPress={() => setOpen(true)} style={({ pressed }) => [styles.change, pressed && styles.changePressed]}>
      <Text style={styles.changeText}>改</Text>
    </Pressable>
    {open ? <CongregationChangeSheet current={congregation.value} choose={congregation.choose} onClose={() => setOpen(false)} /> : null}
  </View>;
}

function CongregationChangeSheet({ current, choose, onClose }: { current: Congregation; choose: (value: Congregation) => Promise<void>; onClose: () => void }) {
  const [picked, setPicked] = useState<Congregation | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const changing = picked !== null && picked !== current;
  const save = async () => {
    if (!changing || saving) return;
    setSaving(true); setFailed(false);
    try { await choose(picked!); onClose(); } catch { setFailed(true); setSaving(false); }
  };
  const label = saving ? '儲存中…' : changing ? `改成：${whereSentence(picked!)}` : '請選要改成哪一邊';
  // Rendered only while open (CongregationLine), so it always starts with nothing picked.
  return <ActionSheet visible title={QUESTION} onClose={onClose} dismissOnOutsideTap={!saving}
    actions={[{ label, disabled: !changing || saving, onPress: () => { void save(); } }]}>
    {CHOICES.map((choice) => {
      const selected = picked === choice.value;
      const name = choice.value === current ? `${choice.name} (現在)` : choice.name;
      return <Pressable
        key={choice.value}
        accessibilityRole="radio"
        accessibilityLabel={`${name}，${choice.detail}`}
        accessibilityState={{ checked: selected, disabled: saving }}
        disabled={saving}
        onPress={() => { setPicked(choice.value); setFailed(false); }}
        style={[styles.choice, selected && styles.choicePicked]}
      >
        <Text style={styles.choiceName}>{name}</Text>
        <Text style={styles.choiceDetail}>{choice.detail}</Text>
      </Pressable>;
    })}
    <Text style={styles.hint}>改了之後，我以前讀經的天數會一起算到新的那一邊；積分不會變。</Text>
    {failed ? <Text accessibilityRole="alert" style={styles.error}>沒有存到，請檢查網路後再試一次。</Text> : null}
  </ActionSheet>;
}

const styles = StyleSheet.create({
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xxs },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: theme.control.tap, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  says: { flex: 1, color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
  saysAccount: { fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  not: { color: theme.colors.muted, fontWeight: '600' },
  change: { minHeight: 40, minWidth: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.chip, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  changePressed: { backgroundColor: theme.colors.primarySoft },
  changeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  choice: { minHeight: theme.control.tap, justifyContent: 'center', gap: 2, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.card, borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  choicePicked: { borderColor: theme.colors.primary, borderWidth: 3, backgroundColor: theme.colors.primarySoft },
  choiceName: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  choiceDetail: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  hint: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  error: { color: theme.colors.danger, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
});
