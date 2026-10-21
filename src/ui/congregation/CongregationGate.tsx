import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import { useAutoUpdateHold } from '../useAutoUpdateHold';
import type { Congregation } from '../../services/devotionClient';
import { useCongregation } from './congregationStore';
import { CHOICES, QUESTION, whereSentence } from './congregationCopy';

/**
 * The first screen after a new member signs in (維護者 2026-10-17, mock v3 ① 2026-10-20): 青少 or 主堂, two large
 * choices for members of any age. Nothing is chosen for them and nothing skips it: the confirm button stays off
 * until a side is picked, then says the whole choice — 「我在主堂聚會 (不是青少)」 — so an older member reads what
 * they are agreeing to. A modal with no close and a system back that does nothing.
 *
 * Members from before the split already belong to 青少 and never see it. When where the member meets cannot be
 * read, a phone that has seen their choice uses it (congregationMemory); a phone that never saw it asks anyway,
 * with 「再試一次」, rather than letting the member through uncounted.
 */
export function CongregationGate() {
  const congregation = useCongregation();
  const [picked, setPicked] = useState<Congregation | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Asked once the read settles with nothing chosen; held while 再試一次 reads again, so the screen never blinks away.
  const asking = congregation.value === null && (congregation.status === 'ready' || congregation.status === 'error');
  const [heldFor, setHeldFor] = useState<string | null>(null);
  useEffect(() => { if (asking && congregation.key) setHeldFor(congregation.key); }, [asking, congregation.key]);
  const visible = congregation.key !== null && congregation.value === null && (asking || heldFor === congregation.key);
  // A choice being made is not reloaded away by a downloaded update (2026-10-21).
  useAutoUpdateHold(visible, '選青少/主堂');
  if (!visible) return null;
  const unreadable = congregation.status === 'error' || (congregation.status === 'loading' && heldFor === congregation.key);
  const retrying = congregation.status === 'loading';
  const confirm = async () => {
    if (!picked || saving) return;
    setSaving(true); setFailed(false);
    try { await congregation.choose(picked); } catch { setFailed(true); } finally { setSaving(false); }
  };
  const confirmLabel = saving ? '儲存中…' : picked ? whereSentence(picked) : '請先選上面其中一個';
  return <Modal visible animationType="fade" onRequestClose={() => undefined}>
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>{QUESTION}</Text>
      {CHOICES.map((choice) => {
        const selected = picked === choice.value;
        return <Pressable
          key={choice.value}
          accessibilityRole="radio"
          accessibilityLabel={`${choice.name}，${choice.detail}`}
          accessibilityState={{ checked: selected, disabled: saving }}
          disabled={saving}
          onPress={() => { setPicked(choice.value); setFailed(false); }}
          style={({ pressed }) => [styles.choice, selected && styles.choicePicked, pressed && styles.pressed]}
        >
          <Text style={styles.choiceName}>{choice.name}</Text>
          <Text style={styles.choiceDetail}>{choice.detail}</Text>
        </Pressable>;
      })}
      <Text style={styles.hint}>選錯沒關係，積分頁上隨時可以改，以前讀的天數會一起跟過去。</Text>
      {unreadable && !retrying ? <Text accessibilityRole="alert" style={styles.error}>沒有連上網路，讀不到之前選的。可以直接選，或按「再試一次」。</Text> : null}
      {failed ? <Text accessibilityRole="alert" style={styles.error}>沒有存到，請檢查網路後再按一次。</Text> : null}
      <Pressable
        testID="congregation-confirm"
        accessibilityRole="button"
        accessibilityLabel={confirmLabel}
        accessibilityState={{ disabled: !picked || saving, busy: saving }}
        disabled={!picked || saving}
        onPress={() => { void confirm(); }}
        style={[styles.confirm, (!picked || saving) && styles.confirmOff]}
      >
        <Text style={[styles.confirmText, (!picked || saving) && styles.confirmTextOff]}>{confirmLabel}</Text>
      </Pressable>
      {unreadable ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="再試一次"
        accessibilityState={{ disabled: retrying, busy: retrying }}
        disabled={retrying}
        onPress={() => congregation.retry()}
        style={styles.retry}
      >
        <Text style={styles.retryText}>{retrying ? '讀取中…' : '再試一次'}</Text>
      </Pressable> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl, backgroundColor: theme.colors.background },
  title: { color: theme.colors.ink, fontSize: 26, lineHeight: 34, fontWeight: '800' },
  choice: { minHeight: 88, justifyContent: 'center', gap: 2, paddingHorizontal: theme.spacing.xl, borderRadius: 18, borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  choicePicked: { borderColor: theme.colors.primary, borderWidth: 3, backgroundColor: theme.colors.primarySoft },
  pressed: { backgroundColor: theme.colors.primarySoft },
  choiceName: { color: theme.colors.ink, fontSize: 26, lineHeight: 34, fontWeight: '800' },
  choiceDetail: { color: theme.colors.muted, fontSize: 17, lineHeight: 24 },
  hint: { color: theme.colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: theme.colors.danger, fontSize: 16, lineHeight: 24 },
  confirm: { minHeight: theme.control.cta, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  confirmOff: { backgroundColor: theme.colors.border },
  confirmText: { color: theme.colors.white, fontSize: 18, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
  confirmTextOff: { color: theme.colors.muted },
  retry: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  retryText: { color: theme.colors.primary, fontSize: 17, fontWeight: '800' },
});
