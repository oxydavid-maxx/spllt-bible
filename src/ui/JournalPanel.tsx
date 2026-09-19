import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useJournalEntry } from './useJournalEntry';
import { theme } from './Theme';

/**
 * The half-page writing panel that slides up under the reader.
 *
 * It sits beside the reader in the tree, never above it, and it owns the typing state itself. That
 * is the whole performance design: a chapter is a web page inside a browser inside this app, and if
 * a keystroke re-rendered the screen that holds it, writing would stutter on every letter.
 *
 * Nothing here is decorative. A label, a box, one line of status, and a way out.
 */

export interface JournalPanelProps {
  visible: boolean;
  memberId: string | null;
  planId: string;
  taskDate: string;
  /** Formatted for a person: 9月19日, not 2026-09-19. */
  dateLabel: string;
  newOperationId: () => string;
  onClose: () => void;
  /** Set by the reader when a verse is copied while this panel is open. */
  pendingQuote?: string | null;
  onQuoteConsumed?: () => void;
  /** Optional copy into the member's chosen folder; see journalFolderMirror. */
  mirror?: (taskDate: string, body: string) => void;
}

export function JournalPanel({ visible, memberId, planId, taskDate, dateLabel, newOperationId, onClose, pendingQuote, onQuoteConsumed, mirror }: JournalPanelProps) {
  const entry = useJournalEntry({ memberId, planId, taskDate, newOperationId, mirror });

  // A verse copied in the reader is OFFERED here, not inserted.
  //
  // The panel covers the reader while it is open, so nobody selects a verse with it up; the real
  // sequence is read, copy, then open the journal. Inserting whatever was last copied would then
  // drop text into the page of someone who only wanted it on their clipboard. One tap, no surprise.
  const [offered, setOffered] = useState<string | null>(null);
  useEffect(() => { if (visible && pendingQuote) setOffered(pendingQuote); }, [visible, pendingQuote]);

  const close = () => { entry.flushNow(); onClose(); };

  return <Modal transparent animationType="slide" visible={visible} onRequestClose={close}>
    <Pressable accessibilityRole="button" accessibilityLabel="關閉靈修日記" onPress={close} style={styles.scrim}>
      <Pressable onPress={() => undefined} style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{`靈修日記 ${dateLabel}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="完成" onPress={close} hitSlop={8} style={styles.done}>
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput
            accessibilityLabel="靈修日記"
            multiline
            maxLength={4000}
            placeholder="今天想記下的"
            placeholderTextColor={theme.colors.muted}
            value={entry.body}
            onChangeText={entry.setBody}
            onBlur={entry.flushNow}
            style={styles.input}
            textAlignVertical="top"
          />
          {offered ? <Pressable accessibilityRole="button" accessibilityLabel="插入剛複製的經文" onPress={() => { entry.appendQuote(offered); setOffered(null); onQuoteConsumed?.(); }} style={styles.quoteOffer}>
            <Text numberOfLines={2} style={styles.quoteOfferText}>{`插入剛複製的經文：${offered}`}</Text>
          </Pressable> : null}
          {entry.conflict
            ? <View style={styles.conflict}>
                <Text style={styles.conflictText}>這一天的日記在其他裝置上已更新，你的內容尚未上傳。</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="仍要儲存" onPress={entry.resolveConflict} style={styles.conflictAction}>
                  <Text style={styles.conflictActionText}>仍要儲存</Text>
                </Pressable>
              </View>
            : entry.syncStatus === 'PENDING_SAVE'
              ? <Text style={styles.note}>尚未上傳</Text>
              : null}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheet: { height: '55%', backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, paddingBottom: theme.spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md },
  title: { flex: 1, color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' },
  done: { minHeight: theme.control.tap, minWidth: theme.control.tap, alignItems: 'flex-end', justifyContent: 'center' },
  doneText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  body: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  input: { minHeight: 180, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  quoteOffer: { minHeight: theme.control.tap, justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  quoteOfferText: { color: theme.colors.primary, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  conflict: { gap: theme.spacing.xs },
  conflictText: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  conflictAction: { minHeight: theme.control.tap, alignItems: 'flex-start', justifyContent: 'center' },
  conflictActionText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
});
