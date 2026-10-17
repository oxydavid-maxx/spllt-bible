import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import type { Congregation } from '../../services/devotionClient';
import { useCongregation } from './congregationStore';

/**
 * The first screen after a new member signs in (維護者 2026-10-17): 青少 or 主堂,
 * two large buttons for members of any age. Members from before the split already belong to 青少 and never see
 * it. A modal, so screen readers stay on it until a choice is saved.
 */
const CHOICES: Array<{ value: Congregation; name: string; detail: string }> = [
  { value: 'youth', name: '青少', detail: '國中、高中、大專' },
  { value: 'main', name: '主堂', detail: '成人' },
];

export function CongregationGate() {
  const congregation = useCongregation();
  const [saving, setSaving] = useState<Congregation | null>(null);
  const [failed, setFailed] = useState(false);
  if (congregation.status !== 'ready' || congregation.value !== null) return null;
  const pick = async (value: Congregation) => {
    if (saving) return;
    setSaving(value); setFailed(false);
    try { await congregation.choose(value); } catch { setFailed(true); } finally { setSaving(null); }
  };
  return <Modal visible animationType="fade" onRequestClose={() => undefined}>
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>你在哪裡聚會？</Text>
      <Text style={styles.lead}>這會決定你先看到哪裡的公告和獎品。之後可以在「我的帳戶」改。</Text>
      {CHOICES.map((choice) => <Pressable
        key={choice.value}
        accessibilityRole="button"
        accessibilityLabel={`${choice.name}，${choice.detail}`}
        accessibilityState={{ busy: saving === choice.value, disabled: Boolean(saving) }}
        disabled={Boolean(saving)}
        onPress={() => { void pick(choice.value); }}
        style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
      >
        <Text style={styles.choiceName}>{choice.name}</Text>
        <Text style={styles.choiceDetail}>{saving === choice.value ? '儲存中…' : choice.detail}</Text>
      </Pressable>)}
      {failed ? <Text accessibilityRole="alert" style={styles.error}>沒有存到，請檢查網路後再按一次。</Text> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: theme.spacing.lg, paddingHorizontal: theme.spacing.xl, backgroundColor: theme.colors.background },
  title: { color: theme.colors.ink, fontSize: 28, lineHeight: 36, fontWeight: '800' },
  lead: { color: theme.colors.muted, fontSize: 17, lineHeight: 26 },
  choice: { minHeight: 96, justifyContent: 'center', gap: 4, paddingHorizontal: theme.spacing.xl, borderRadius: 20, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  pressed: { backgroundColor: theme.colors.primarySoft },
  choiceName: { color: theme.colors.primary, fontSize: 30, lineHeight: 38, fontWeight: '800' },
  choiceDetail: { color: theme.colors.muted, fontSize: 17, lineHeight: 24 },
  error: { color: theme.colors.danger, fontSize: 16, lineHeight: 24 },
});
