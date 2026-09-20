import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { JournalPanel } from '../../src/ui/JournalPanel';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { formatReadingDateFull } from '../../src/ui/ReadingDateNavigator';
import { getReadingPlanId } from '../../src/ui/readingSession';
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
  const today = new Date();
  const from = new Date(today.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export default function JournalScreen() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const memberId = session?.memberId ?? null;
  const [entries, setEntries] = useState<Array<{ taskDate: string; body: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [mirror] = useState(() => createJournalFolderMirror({
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  const [mirrorFolder, setMirrorFolder] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void mirror.load(memberId).then(() => { if (current) setMirrorFolder(mirror.folderUri(memberId)); });
    return () => { current = false; };
  }, [mirror, memberId]);

  // Writing the whole journal out at once: turning the setting on should bring what is already
  // written with it, not just whatever gets typed from here on.
  const mirrorEverything = async () => {
    let written = 0;
    let skipped = 0;
    for (const entry of entries) {
      const outcome = await mirror.write(memberId, entry.taskDate, entry.body);
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

  useEffect(reload, [reload, editing]);

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
    const document = buildJournalExport(entries);
    const days = countExportableDays(entries);
    const outcome = await shareJournalExport(document);
    setResult(outcome === 'shared' ? `已匯出 ${days} 天` : outcome === 'copied' ? `已複製 ${days} 天到剪貼簿` : '匯出失敗，請再試一次');
  };

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <View style={styles.toolbar}>
      <Text accessibilityRole="header" style={styles.title}>靈修日記</Text>
      <AccountEntryButton />
    </View>
    {memberId === null
      ? <Text style={styles.empty}>登入後才能看到自己的日記。</Text>
      : entries.length === 0
        ? <Text style={styles.empty}>還沒有日記。在讀經畫面右上角的筆記圖示可以開始寫。</Text>
        : <ScrollView contentContainerStyle={styles.list}>
            {entries.map((entry) => <Pressable
              key={entry.taskDate}
              accessibilityRole="button"
              accessibilityLabel={`開啟 ${formatReadingDateFull(entry.taskDate)} 的日記`}
              onPress={() => setEditing(entry.taskDate)}
              style={styles.row}
            >
              <Text style={styles.rowDate}>{formatReadingDateFull(entry.taskDate)}</Text>
              <Text numberOfLines={1} style={styles.rowPreview}>{entry.body.split('\n').find((line) => line.trim().length > 0) ?? ''}</Text>
            </Pressable>)}
          </ScrollView>}
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
    {editing ? <JournalPanel
      visible
      memberId={memberId}
      planId={getReadingPlanId(editing) ?? 'church-2026-09'}
      taskDate={editing}
      dateLabel={formatReadingDateFull(editing)}
      newOperationId={randomUUID}
      onClose={() => setEditing(null)}
      mirror={(taskDate, body) => { void mirror.write(memberId, taskDate, body); }}
    /> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  title: { color: theme.colors.ink, fontSize: theme.type.title.size, fontWeight: '800' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  list: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl, gap: theme.spacing.xs },
  row: { minHeight: theme.control.tap, justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.xxs },
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
