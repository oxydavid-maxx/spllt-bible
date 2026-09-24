import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { useAuthSnapshot } from '../../src/services/authSession';
import { runtimeConfig } from '../../src/config/runtime';
import { createJournalApiClient } from '../../src/services/journalApiClient';
import { openQingmuJournalStore } from '../../src/storage/mobileDatabase';
import { buildJournalExport, countExportableDays } from '../../src/domain/journalExport';
import { describeFolderUri } from '../../src/domain/folderPath';
import { shareJournalExport } from '../../src/ui/journalShare';
import * as SecureStore from 'expo-secure-store';
import { createJournalFolderMirror } from '../../src/services/journalFolderMirror';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { ReaderAudioBridgeButton } from '../../src/ui/ReaderAudioBridgeButton';
import { formatReadingDateFull, formatReadingDateLabel } from '../../src/ui/ReadingDateNavigator';
import { consumePendingJournalQuote, getReadingPlanId, useReadingSession } from '../../src/ui/readingSession';
import { taipeiDate } from '../../src/domain/gamificationV1';
import { useJournalEntry } from '../../src/ui/useJournalEntry';
import { useAndroidKeyboardVisible } from '../../src/ui/useAndroidKeyboardVisible';
import { theme } from '../../src/ui/Theme';

/**
 * Every entry in one place: read back, reopen to edit, take the whole thing away.
 *
 * The list is local-first. The device already holds what was written here, so it renders instantly
 * and works with no signal; the server copy is merged in afterwards for anything written on another
 * phone. Export reads the same merged list, which is why it is on this screen rather than buried in
 * account settings — this is where the journal lives.
 */

const RANGE_DAYS = 400;

function rangeEndingToday(): { from: string; to: string } {
  const today = new Date(`${taipeiDate()}T12:00:00.000Z`);
  const from = new Date(today.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export default function JournalScreen() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const memberId = session?.memberId ?? null;
  const reading = useReadingSession();
  const [editorDate, setEditorDate] = useState(() => reading.journalEntryDate ?? taipeiDate());
  const launchRevision = useRef(reading.journalEntryRevision);
  const [entries, setEntries] = useState<Array<{ taskDate: string; body: string }>>([]);
  const [result, setResult] = useState<string | null>(null);
  const [mirror] = useState(() => createJournalFolderMirror({
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  const [mirrorFolder, setMirrorFolder] = useState<string | null>(null);
  const keyboardUp = useAndroidKeyboardVisible();
  const planId = getReadingPlanId(editorDate) ?? 'church-2026-09';
  const entry = useJournalEntry({
    memberId,
    planId,
    taskDate: editorDate,
    newOperationId: randomUUID,
    mirror: (taskDate, body) => { void mirror.write(memberId, taskDate, body); },
  });
  useEffect(() => {
    let current = true;
    void mirror.load(memberId).then(() => { if (current) setMirrorFolder(mirror.folderUri(memberId)); });
    return () => { current = false; };
  }, [mirror, memberId]);

  // Writing the whole journal out at once: turning the setting on should bring what is already
  // written with it, not just whatever gets typed from here on.
  const mirrorEverything = async () => {
    flushEditor();
    let written = 0;
    let skipped = 0;
    const allEntries = memberId ? openQingmuJournalStore().list(memberId) : [];
    for (const saved of allEntries) {
      const outcome = await mirror.write(memberId, saved.taskDate, saved.body);
      if (outcome.ok) written += 1;
      else if (outcome.reason === 'FOREIGN_FILE') skipped += 1;
    }
    setResult(skipped > 0
      ? `已寫入 ${written} 天；${skipped} 天因為資料夾裡已經有同名檔案而跳過`
      : `已寫入 ${written} 天到你選的資料夾`);
  };

  const chooseFolder = async () => {
    const chosen = await mirror.choose(memberId);
    if (!chosen) { setResult('沒有選擇資料夾'); return; }
    setMirrorFolder(chosen);
    await mirrorEverything();
  };

  const reload = useCallback(() => {
    if (!memberId) { setEntries([]); return; }
    const local = openQingmuJournalStore().list(memberId);
    setEntries(local.map((entry) => ({ taskDate: entry.taskDate, body: entry.body })));
  }, [memberId]);

  useEffect(reload, [reload, editorDate]);
  useEffect(() => {
    const refresh = setTimeout(reload, 2_050);
    return () => clearTimeout(refresh);
  }, [entry.body, editorDate, reload]);

  const flushEditor = useCallback((): void => {
    const hasSavedEntry = entries.some(saved => saved.taskDate === editorDate);
    if (entry.body.length > 0 || hasSavedEntry) entry.flushNow();
    reload();
  }, [entries, editorDate, entry.body, entry.flushNow, reload]);

  // A tab entry carries the Reader's selected task date. Flush whichever diary was open before
  // switching the editor; this local date never mutates the Reader's selected date or audio chapter.
  useEffect(() => {
    if (launchRevision.current === reading.journalEntryRevision) return;
    launchRevision.current = reading.journalEntryRevision;
    const nextDate = reading.journalEntryDate;
    if (!nextDate) return;
    flushEditor();
    setEditorDate(nextDate);
  }, [reading.journalEntryDate, reading.journalEntryRevision, flushEditor]);

  const changeEditorDate = (nextDate: string): void => {
    if (nextDate === editorDate || nextDate > taipeiDate()) return;
    flushEditor();
    setEditorDate(nextDate);
  };

  const moveEditorDate = (delta: number): void => {
    const next = new Date(`${editorDate}T12:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + delta);
    changeEditorDate(next.toISOString().slice(0, 10));
  };

  // The server copy only adds days written elsewhere; a local entry always wins, because it may be
  // newer and is certainly what the person in front of the screen last typed.
  useEffect(() => {
    if (!memberId || !session) return;
    let current = true;
    const client = createJournalApiClient({
      baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl,
      token: session.sessionToken,
      memberId,
    });
    const { from, to } = rangeEndingToday();
    void client.listEntries(from, to).then((remote) => {
      if (!current || !remote) return;
      openQingmuJournalStore().adoptRemote(memberId, remote, getReadingPlanId(to) ?? 'church-2026-09');
      reload();
    });
    return () => { current = false; };
  }, [memberId, session, reload]);

  const exportAll = async () => {
    flushEditor();
    const currentEntries = memberId ? openQingmuJournalStore().list(memberId) : entries;
    const document = buildJournalExport(currentEntries);
    const days = countExportableDays(currentEntries);
    const outcome = await shareJournalExport(document);
    setResult(outcome === 'shared' ? `已匯出 ${days} 天` : outcome === 'copied' ? `已複製 ${days} 天到剪貼簿` : '匯出失敗，請再試一次');
  };

  const canMoveForward = editorDate < taipeiDate();
  const pendingQuote = reading.pendingJournalQuote;
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView style={styles.page} behavior="padding" enabled={Platform.OS !== 'android' || keyboardUp}>
      <View style={styles.toolbar}>
        <View style={styles.dateNavigation}>
          <Pressable accessibilityRole="button" accessibilityLabel="前一天日記" onPress={() => moveEditorDate(-1)} style={styles.dateButton}>
            <Text style={styles.dateArrow}>‹</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{`靈修日記 ${formatReadingDateLabel(editorDate)}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="後一天日記" accessibilityState={{ disabled: !canMoveForward }} disabled={!canMoveForward} onPress={() => moveEditorDate(1)} style={[styles.dateButton, !canMoveForward && styles.disabled]}>
            <Text style={styles.dateArrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.toolbarActions}>
          <ReaderAudioBridgeButton />
          <AccountEntryButton />
        </View>
      </View>
      {memberId === null ? <Text style={styles.empty}>登入後才能查看和保存自己的日記。</Text> : null}
      <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
        <TextInput
          accessibilityLabel="靈修日記"
          multiline
          maxLength={4000}
          editable={memberId !== null}
          placeholder="今天想記下的"
          placeholderTextColor={theme.colors.muted}
          value={entry.ready ? entry.body : ''}
          onChangeText={entry.setBody}
          onBlur={flushEditor}
          style={styles.editor}
          textAlignVertical="top"
        />
        {pendingQuote ? <Pressable accessibilityRole="button" accessibilityLabel="插入剛複製的經文" onPress={() => { entry.appendQuote(pendingQuote); consumePendingJournalQuote(); }} style={styles.quoteOffer}>
          <Text numberOfLines={2} style={styles.quoteOfferText}>{`插入剛複製的經文：${pendingQuote}`}</Text>
        </Pressable> : null}
        {entry.conflict ? <View style={styles.conflict}>
          <Text style={styles.conflictText}>這一天的日記在其他裝置上已更新，你的內容尚未上傳。</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="仍要儲存" onPress={entry.resolveConflict} style={styles.conflictAction}>
            <Text style={styles.conflictActionText}>仍要儲存</Text>
          </Pressable>
        </View> : entry.syncStatus === 'PENDING_SAVE' ? <Text accessibilityLiveRegion="polite" style={styles.note}>尚未上傳</Text> : null}
        <Text accessibilityRole="header" style={styles.historyHeading}>歷史記錄</Text>
        {entries.length === 0
          ? <Text style={styles.empty}>還沒有其他日記。寫下第一篇後，會保存在這裡。</Text>
          : entries.map((saved) => <Pressable
              key={saved.taskDate}
              accessibilityRole="button"
              accessibilityLabel={`開啟 ${formatReadingDateFull(saved.taskDate)} 的日記`}
              accessibilityState={{ selected: saved.taskDate === editorDate }}
              onPress={() => changeEditorDate(saved.taskDate)}
              style={[styles.row, saved.taskDate === editorDate && styles.selectedRow]}
            >
              <Text style={styles.rowDate}>{formatReadingDateFull(saved.taskDate)}</Text>
              <Text numberOfLines={1} style={styles.rowPreview}>{saved.body.split('\n').find((line) => line.trim().length > 0) ?? ''}</Text>
            </Pressable>)}
      </ScrollView>
      {memberId !== null && entries.length > 0 ? <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityLabel="匯出靈修日記" onPress={() => { void exportAll(); }} style={styles.exportButton}>
          <Text style={styles.exportText}>匯出全部</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={mirrorFolder ? '更換同步資料夾' : '同時存到我選的資料夾'} onPress={() => { void chooseFolder(); }} style={styles.exportButton}>
          <Text style={styles.exportText}>{mirrorFolder ? '更換同步資料夾' : '同時存到我選的資料夾'}</Text>
        </Pressable>
        {mirrorFolder ? <Text accessibilityLabel="同步資料夾" numberOfLines={1} style={styles.folderPath}>{describeFolderUri(mirrorFolder) ?? ''}</Text> : null}
        {mirrorFolder ? <Pressable accessibilityRole="button" accessibilityLabel="停止同步到資料夾" onPress={() => { void mirror.forget(memberId).then(() => { setMirrorFolder(null); setResult('已停止同步；已經寫出去的檔案留在原地'); }); }} style={styles.stopButton}>
          <Text style={styles.stopText}>停止同步</Text>
        </Pressable> : null}
        {result ? <Text accessibilityLiveRegion="polite" style={styles.result}>{result}</Text> : null}
      </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  page: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  dateNavigation: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs },
  dateButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  dateArrow: { color: theme.colors.primary, fontSize: 28, lineHeight: 32, fontWeight: '600' },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  title: { color: theme.colors.ink, fontSize: theme.type.title.size, fontWeight: '800' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  pageContent: { flexGrow: 1, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm },
  editor: { minHeight: 180, color: theme.colors.ink, backgroundColor: theme.colors.surface, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, padding: theme.spacing.md, borderRadius: theme.radius.card },
  quoteOffer: { minHeight: theme.control.tap, justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  quoteOfferText: { color: theme.colors.primary, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  conflict: { gap: theme.spacing.xs },
  conflictText: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  conflictAction: { minHeight: theme.control.tap, alignItems: 'flex-start', justifyContent: 'center' },
  conflictActionText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  historyHeading: { color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800', paddingTop: theme.spacing.xs },
  row: { minHeight: theme.control.tap, justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.xxs },
  selectedRow: { borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  disabled: { opacity: 0.4 },
  rowDate: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800' },
  rowPreview: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  footer: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, gap: theme.spacing.xs },
  exportButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  exportText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  folderPath: { color: theme.colors.muted, fontSize: theme.type.caption.size, textAlign: 'center' },
  stopButton: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  stopText: { color: theme.colors.muted, fontSize: theme.type.caption.size },
  result: { color: theme.colors.muted, fontSize: theme.type.caption.size, textAlign: 'center' },
});
