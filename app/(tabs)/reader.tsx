import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildFixtureModels } from '../../src/ui/routes';
import { YouVersionReader } from '../../src/ui/YouVersionReader';
import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { createJournalFolderMirror } from '../../src/services/journalFolderMirror';
import { createReaderSpeedStore, DEFAULT_READER_SPEED, isReaderSpeed, type ReaderSpeed } from '../../src/services/readerSpeedPreference';
import { formatReadingDateLabel } from '../../src/ui/ReadingDateNavigator';
import { openQingmuReaderPositionStore } from '../../src/storage/mobileDatabase';
import type { ReaderPosition } from '../../src/storage/readerPosition';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import { getYouVersionContentMetadata, getYouVersionVersionOptions } from '../../src/config/youVersionContent';
import { buildYouVersionChapterUrl } from '../../src/ui/youVersionReaderConfig';
import { createNativeReaderPreferencesStore } from '../../src/services/nativeReaderPreferences';
import { createReaderAutoplayPreferencesStore } from '../../src/services/readerAutoplayPreferences';
import type { ReaderPreferencesPatch } from '../../src/services/readerPreferences';
import { useReaderPreferences } from '../../src/ui/useReaderPreferences';
import { setPendingJournalQuote, setSelectedReadingDate, useReadingSession } from '../../src/ui/readingSession';
import { useAuthSnapshot } from '../../src/services/authSession';
import * as SecureStore from 'expo-secure-store';
import { isWithinCompletionWindow, taipeiDate } from '../../src/domain/gamificationV1';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { TodayAuthGate } from '../../src/ui/TodayAuthGate';
import { UpdateBanner } from '../../src/ui/UpdateBanner';
import { runtimeConfig } from '../../src/config/runtime';
import { useCompletionController } from '../../src/services/useCompletionController';
import type { CompletionAwardEvent } from '../../src/services/completionController';
import { CompletionAwardFeedback } from '../../src/ui/CompletionAwardFeedback';

let handledTodayReaderTabPressRevision = 0;

export default function ReaderScreen() {
  const chrome = useReaderChrome();
  const pathname = usePathname();
  // The Reader tab route remains mounted underneath Diary so the one native player and its queue
  // survive that tab transition. Other tabs still release the audio binding as before.
  const sharedAudioActive = chrome.focused || pathname === '/journal';
  const { selectedDate, planId, day, period, previousDate, nextDate, todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate, todayReaderTabPressResetToAssignedStart } = useReadingSession();
  const auth = useAuthSnapshot();
  const session = auth.session;
  const memberId = session?.memberId ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? fixtureProfile.memberId : null);
  const model = buildFixtureModels(selectedDate);
  const references = day?.references ?? model.reader.references;
  const referencesKey = references.join('|');
  const [preferencesStore] = useState(createNativeReaderPreferencesStore);
  const preferences = useReaderPreferences(memberId, preferencesStore);
  const [speedStore] = useState(() => createReaderSpeedStore({
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  const [narrationSpeed, setNarrationSpeed] = useState<ReaderSpeed>(DEFAULT_READER_SPEED);
  const [journalMirror] = useState(() => createJournalFolderMirror({
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  useEffect(() => { void journalMirror.load(memberId); }, [journalMirror, memberId]);
  useEffect(() => {
    let current = true;
    void speedStore.load(memberId).then(() => { if (current) setNarrationSpeed(speedStore.getSpeed(memberId)); });
    return () => { current = false; };
  }, [speedStore, memberId]);
  const [autoplayPreferencesStore] = useState(() => createReaderAutoplayPreferencesStore({
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }));
  const autoplaySnapshot = useSyncExternalStore(
    autoplayPreferencesStore.subscribe,
    useCallback(() => autoplayPreferencesStore.getSnapshot(memberId), [autoplayPreferencesStore, memberId]),
    useCallback(() => autoplayPreferencesStore.getSnapshot(memberId), [autoplayPreferencesStore, memberId]),
  );
  useEffect(() => { void autoplayPreferencesStore.load(memberId); }, [autoplayPreferencesStore, memberId]);
  const selectedVersionId = preferences.preferences.versionId;
  const versionOptions = getYouVersionVersionOptions();
  const allowedVersionIds = versionOptions.map((option) => option.versionId);
  const ownerRef = useRef({ memberId, epoch: auth.epoch ?? 0, date: selectedDate });
  if (ownerRef.current.memberId !== memberId || ownerRef.current.epoch !== (auth.epoch ?? 0) || ownerRef.current.date !== selectedDate) {
    ownerRef.current = { memberId, epoch: auth.epoch ?? 0, date: selectedDate };
  }
  const owner = ownerRef.current;
  const ownsReader = () => ownerRef.current === owner;
  // More owns its inline save feedback. SDK callbacks use the existing Alert path.
  const moreSaveOwner = useRef<typeof owner | null>(null);
  const updatePreferences = async (patch: ReaderPreferencesPatch): Promise<void> => {
    if (!ownsReader()) return;
    moreSaveOwner.current = null;
    try { await preferencesStore.update(memberId, patch); }
    catch { if (ownsReader()) Alert.alert('閱讀設定', '這項閱讀設定暫時無法保存，請再試一次。'); }
  };
  const updateAutoplayPreference = async (enabled: boolean): Promise<void> => {
    if (!ownsReader()) return;
    try { await autoplayPreferencesStore.update(memberId, enabled); }
    catch { if (ownsReader()) Alert.alert('連續播放', '這項設定暫時無法保存，請再試一次。'); }
  };
  const chooseVersion = async (nextVersionId: number): Promise<void> => {
    if (!ownsReader() || !allowedVersionIds.includes(nextVersionId)) throw new Error('閱讀設定已變更，請重新選擇。');
    moreSaveOwner.current = owner;
    try { await preferencesStore.update(memberId, { versionId: nextVersionId }); }
    catch { throw new Error('譯本未儲存，請再試一次。'); }
    if (!ownsReader()) throw new Error('閱讀設定已變更，請重新選擇。');
    // Storage I/O failure intentionally resolves in the store contract; inspect its result flag.
    if (preferencesStore.getSnapshot(memberId).saveError) throw new Error('譯本未儲存，請再試一次。');
  };
  const shownPreferenceError = useRef<{ owner: typeof owner; kind: 'read' | 'save' } | null>(null);
  useEffect(() => {
    if (!preferences.ready || !ownsReader()) return;
    const kind = preferences.saveError ? 'save' : preferences.readError ? 'read' : null;
    if (!kind) { shownPreferenceError.current = null; return; }
    if (kind === 'save' && moreSaveOwner.current === owner) return;
    if (shownPreferenceError.current?.owner === owner && shownPreferenceError.current.kind === kind) return;
    shownPreferenceError.current = { owner, kind };
    Alert.alert('閱讀設定', kind === 'save' ? '閱讀設定尚未保存，請重試。' : '暫時無法載入閱讀設定，已先使用預設值。', [
      { text: '稍後', style: 'cancel' },
      { text: kind === 'save' ? '重試儲存' : '重試載入', onPress: () => {
        if (!ownsReader()) return;
        void (kind === 'save' ? preferencesStore.retrySave(memberId) : preferencesStore.load(memberId));
      } },
    ]);
  }, [preferences.ready, preferences.readError, preferences.saveError, owner, preferencesStore, memberId]);
  const contentMetadata = getYouVersionContentMetadata(selectedVersionId);
  const positionStoreRef = useRef<ReturnType<typeof openQingmuReaderPositionStore> | null>(null);
  const [readerPosition, setReaderPosition] = useState<ReaderPosition | null>(null);
  const saveReaderPosition = (next: ReaderPosition): void => {
    if (!ownsReader() || next.memberId !== memberId) return;
    const store = positionStoreRef.current ?? openQingmuReaderPositionStore();
    positionStoreRef.current = store;
    store.save(next);
    setReaderPosition(next);
  };
  const rememberBook = (book: string, chapter: string, versionId?: number): void => {
    if (!ownsReader() || !memberId) return;
    saveReaderPosition({ memberId, planId, taskDate: selectedDate, versionId: versionId ?? preferencesStore.getSnapshot(memberId).preferences.versionId, book, chapter, reference: `${book}.${chapter}`, mode: 'FREE_BROWSE', updatedAt: new Date().toISOString() });
  };

  // ── THE SINGLE READER SELECTION AUTHORITY (review 120) ──────────────────────────────────────────
  // Before this, the current chapter lived in three places that never agreed: readerPosition (what the
  // official reader shows), YouVersionReader's private activeReferenceIndex (which assigned passage the
  // reader picked), and model.reader.references[0] (what the audio was given). The audio read the only
  // one that never changes, so it correctly resolved the wrong chapter.
  //
  // One value now decides, and BOTH the official reader and the audio read it.
  type ReaderSelection =
    | { source: 'ASSIGNED'; index: number }
    | { source: 'FREE'; book: string; chapter: string };
  // Keep the schedule empty on rest days; this is a free Bible location, not a task.
  // JHN.1 is the official SDK's existing default and must also drive chapter audio.
  const initialSelection = (): ReaderSelection => references.length
    ? { source: 'ASSIGNED', index: 0 }
    : { source: 'FREE', book: 'JHN', chapter: '1' };
  const [selection, setSelection] = useState<ReaderSelection>(initialSelection);
  const selectionOwner = useRef(owner);

  const assignedIndex = selection.source === 'ASSIGNED'
    ? Math.min(selection.index, Math.max(0, references.length - 1))
    : 0;
  const assignedReference = references[assignedIndex] ?? '';
  const [assignedBook = '', assignedChapter = ''] = assignedReference.split('.');
  const currentBook = selection.source === 'FREE' ? selection.book : assignedBook;
  const currentChapter = selection.source === 'FREE' ? selection.chapter : assignedChapter;
  const currentUsfm = currentBook && currentChapter ? `${currentBook}.${currentChapter}` : '';

  // Free-browse moves arrive as SEPARATE book and chapter callbacks from the SDK, often within one
  // batch. Reading the other half out of the render closure produced old-book + new-chapter, because
  // neither callback had re-rendered yet. A ref settles synchronously, so the second call in a batch
  // sees what the first just set. (A functional setState updater would also see it, but running the
  // persistence side effect inside an updater is unsafe - StrictMode may invoke it twice.)
  const freePositionRef = useRef<{ book: string; chapter: string } | null>(null);
  const moveFreely = (patch: { book?: string; chapter?: string }, versionId?: number): void => {
    if (!ownsReader()) return;
    const base = freePositionRef.current
      ?? { book: currentBook || 'JHN', chapter: currentChapter || '1' };
    const next = { book: patch.book ?? base.book, chapter: patch.chapter ?? base.chapter };
    freePositionRef.current = next;
    setSelection({ source: 'FREE', ...next });
    rememberBook(next.book, next.chapter, versionId);
  };

  // Review 121 C4. A version change arrives as its OWN callback, often in the SAME batch as a book and
  // chapter change. Reading currentBook/currentChapter from the render closure here persisted the
  // chapter the reader had BEFORE that batch, so the immediate audio request looked right while the
  // SAVED position was stale - and a remount then restored the wrong chapter. The ref settles
  // synchronously, so it already holds whatever moveFreely just wrote in this same batch.
  const rememberCurrentAt = (versionId: number): void => {
    if (!ownsReader()) return;
    const at = freePositionRef.current
      ?? (currentBook && currentChapter ? { book: currentBook, chapter: currentChapter } : null);
    if (at) rememberBook(at.book, at.chapter, versionId);
  };
  const returnToAssignedRange = (): void => {
    if (!ownsReader() || !memberId || references.length === 0) return;
    const store = positionStoreRef.current ?? openQingmuReaderPositionStore();
    positionStoreRef.current = store;
    store.resetToAssigned(memberId, planId, selectedDate, references);
    setReaderPosition(store.get(memberId, planId, selectedDate) ?? null);
    freePositionRef.current = null;
    setSelection({ source: 'ASSIGNED', index: 0 });
  };
  const [awardEvent, setAwardEvent] = useState<CompletionAwardEvent | null>(null);
  const completion = useCompletionController({
    planId,
    taskDate: selectedDate,
    canComplete: Boolean(memberId && day),
    onAward: (event) => setAwardEvent(event),
  });
  const record = completion.record;
  const syncError = completion.syncError;
  useEffect(() => {
    if (!ownsReader()) return;
    selectionOwner.current = owner;
    const externalTodayResetPending = todayReaderTabPressRevision > handledTodayReaderTabPressRevision
      && todayReaderTabPressResetToAssignedStart
      && todayReaderTabPressTargetDate === selectedDate
      && todayReaderTabPressMemberId === memberId
      && todayReaderTabPressAuthEpoch === (auth.epoch ?? 0)
      && auth.status !== 'hydrating'
      && Boolean(day && references.length > 0);
    if (externalTodayResetPending) {
      if (memberId) {
        const store = positionStoreRef.current ?? openQingmuReaderPositionStore();
        positionStoreRef.current = store;
        store.resetToAssigned(memberId, planId, selectedDate, references);
        setReaderPosition(store.get(memberId, planId, selectedDate) ?? null);
      } else {
        setReaderPosition(null);
      }
      freePositionRef.current = null;
      setSelection({ source: 'ASSIGNED', index: 0 });
      handledTodayReaderTabPressRevision = todayReaderTabPressRevision;
      return;
    }
    if (!memberId) { setReaderPosition(null); freePositionRef.current = null; setSelection(initialSelection()); return; }
    const store = positionStoreRef.current ?? openQingmuReaderPositionStore();
    positionStoreRef.current = store;
    const saved = store.get(memberId, planId, selectedDate);
    setReaderPosition(saved ?? null);
    const hasSavedFreePosition = saved?.mode === 'FREE_BROWSE'
      && typeof saved.book === 'string' && saved.book.trim().length > 0
      && typeof saved.chapter === 'string' && saved.chapter.trim().length > 0;
    const savedAssignedIndex = saved?.mode === 'ASSIGNED'
      ? references.findIndex(reference => reference === saved.reference)
      : -1;
    freePositionRef.current = hasSavedFreePosition
      ? { book: saved.book, chapter: saved.chapter }
      : null;
    setSelection(savedAssignedIndex >= 0
      ? { source: 'ASSIGNED', index: savedAssignedIndex }
      : hasSavedFreePosition
        ? { source: 'FREE', book: saved.book, chapter: saved.chapter }
        : initialSelection());
  }, [memberId, planId, selectedDate, owner, references.join('|'), todayReaderTabPressRevision, todayReaderTabPressResetToAssignedStart, todayReaderTabPressTargetDate, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, auth.status, auth.epoch, day?.date]);
  const selectAssigned = (index: number) => {
    if (!ownsReader()) return;
    freePositionRef.current = null;
    setSelection({ source: 'ASSIGNED', index });
    const reference = references[index];
    const [book, chapter = ''] = reference?.split('.') ?? [];
    if (memberId && reference && book && chapter) {
      saveReaderPosition({ memberId, planId, taskDate: selectedDate, versionId: selectedVersionId, book, chapter, reference, mode: 'ASSIGNED', updatedAt: new Date().toISOString() });
    }
  };
  useEffect(() => {
    if (todayReaderTabPressRevision <= handledTodayReaderTabPressRevision) return;
    if (todayReaderTabPressTargetDate !== selectedDate) {
      handledTodayReaderTabPressRevision = todayReaderTabPressRevision;
      return;
    }
    if (auth.status === 'hydrating') return;
    if (todayReaderTabPressMemberId !== memberId || todayReaderTabPressAuthEpoch !== (auth.epoch ?? 0)) {
      handledTodayReaderTabPressRevision = todayReaderTabPressRevision;
      return;
    }
    if (!ownsReader() || selectionOwner.current !== owner || !day) return;
    if (references.length === 0) {
      handledTodayReaderTabPressRevision = todayReaderTabPressRevision;
      return;
    }

    let assignedIndex = -1;
    if (memberId) {
      const store = positionStoreRef.current ?? openQingmuReaderPositionStore();
      positionStoreRef.current = store;
      const saved = store.get(memberId, planId, selectedDate);
      if (saved?.mode === 'ASSIGNED') {
        assignedIndex = references.findIndex(reference => reference === saved.reference);
      } else if (saved?.mode === 'FREE_BROWSE') {
        const savedReference = saved.reference || saved.book + '.' + saved.chapter;
        assignedIndex = references.findIndex(reference => reference === savedReference);
      }
    } else if (todayReaderTabPressSameDate && selectionOwner.current === owner && selection.source === 'ASSIGNED') {
      assignedIndex = selection.index;
    }

    selectAssigned(assignedIndex >= 0 ? assignedIndex : 0);
    handledTodayReaderTabPressRevision = todayReaderTabPressRevision;
  }, [todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate, todayReaderTabPressResetToAssignedStart, auth.status, auth.epoch, memberId, planId, selectedDate, day?.date, referencesKey, owner]);
  const visibleRecord = record.memberId === (memberId ?? 'signed-out') && record.planId === planId && record.taskDate === selectedDate
    ? record
    : { memberId: memberId ?? 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
  const completed = visibleRecord.status === 'COMPLETED';
  const completionPending = completion.pending;
  const completionFailed = completion.syncError || completion.retryable;
  const withinCompletionWindow = isWithinCompletionWindow(selectedDate, taipeiDate());
  const completionLabel = !memberId ? '登入後完成' : !day ? '無排定讀經' : !withinCompletionWindow ? '超過補登期限' : '完成讀經';
  const completionDisabled = completionPending || (!completed && !completionFailed && (!memberId || !day || !withinCompletionWindow));
  const onComplete = () => { void completion.complete(); };
  const requestUndo = completion.requestUndo;
  const youVersionChapterUrl = buildYouVersionChapterUrl(selectedVersionId, currentUsfm);
  const openYouVersionChapter = () => {
    if (!youVersionChapterUrl || !ownsReader()) return;
    const reference = selection.source === 'ASSIGNED' ? references[assignedIndex] ?? currentUsfm : currentUsfm;
    if (memberId && currentBook && currentChapter) {
      saveReaderPosition({
        memberId, planId, taskDate: selectedDate, versionId: selectedVersionId,
        book: currentBook, chapter: currentChapter, reference,
        mode: selection.source === 'ASSIGNED' ? 'ASSIGNED' : 'FREE_BROWSE',
        updatedAt: new Date().toISOString(),
      });
    }
    void Linking.openURL(youVersionChapterUrl).catch(() => Alert.alert('YouVersion', '目前無法開啟本章，請稍後再試。'));
  };
  if (!preferences.ready || !autoplaySnapshot.ready || selectionOwner.current !== owner) return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 }}>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}><AccountEntryButton /></View>
      <Text accessibilityLiveRegion="polite">正在載入閱讀設定…</Text>
    </SafeAreaView>
  );
  return (
    <YouVersionReader
      key={selectedDate}
      references={references}
      date={selectedDate}
      appKey={process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY ?? null}
      versionId={selectedVersionId}
      book={currentBook || undefined}
      chapter={currentChapter || undefined}
      activeReferenceIndex={assignedIndex}
      onActiveReferenceChange={selectAssigned}
      allowedVersionIds={allowedVersionIds}
      onBookChange={(book) => moveFreely({ book })}
      onChapterChange={(chapter) => moveFreely({ chapter })}
      onVersionChange={(versionId) => { if (!ownsReader() || !allowedVersionIds.includes(versionId)) return; void updatePreferences({ versionId }); rememberCurrentAt(versionId); }}
      readerPreferences={{ ownerId: memberId, settings: preferences.preferences.settings, onChange: next => { void updatePreferences({ settings: next }); } }}
      continuousPlaybackEnabled={autoplaySnapshot.preferences.enabled}
      onContinuousPlaybackChange={enabled => { void updateAutoplayPreference(enabled); }}
      allowTechnicalProbe={process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE === 'true'}
      fullscreen
      onCanvasTap={chrome.toggleTools}
      onCanvasScroll={chrome.handleCanvasScroll}
      // Held whether or not the journal is open: the panel covers the reader, so a verse is always
      // copied with it closed. The panel offers it on the next open rather than inserting it.
      onVerseCopied={setPendingJournalQuote}
      narrationSpeed={narrationSpeed}
      renderScreen={(reader, controls) => (
        <FullscreenReaderLayout
          reader={reader}
          controls={controls}
          chrome={chrome}
          audioOwnerActive={sharedAudioActive}
          selectionSource={selection.source}
          activeReferenceIndex={assignedIndex}
          chapterUsfm={currentUsfm}
          versionId={selectedVersionId}
          references={references}
          onSelectReference={selectAssigned}
          selectedDate={selectedDate}
          previousDate={previousDate}
          nextDate={nextDate}
          onSelectDate={setSelectedReadingDate}
          completed={completed}
          completionDisabled={completionDisabled}
          completionPending={completionPending}
          completionFailed={completionFailed}
          completionLabel={completionLabel}
          onComplete={onComplete}
          onUndo={requestUndo}
          noPlanMessage={!day ? `這一天沒有排定讀經。${formatReadingDateLabel(selectedDate)}仍可自由閱讀。` : undefined}
          statusMessage={syncError ? '同步遇到問題，完成狀態已保留；連線後會重試。' : completionPending ? '已記錄，等待同步。同步成功後才會顯示加分。' : undefined}
          completionFeedback={<CompletionAwardFeedback
            event={awardEvent}
            onFinished={(operationId) => setAwardEvent(current => current?.operationId === operationId ? null : current)}
          />}
          canOpenYouVersion={youVersionChapterUrl !== null}
          onOpenYouVersion={openYouVersionChapter}
          versionOptions={versionOptions}
          onSelectVersion={chooseVersion}
          accountEntry={<AccountEntryButton />}
          loginGate={auth.status === 'signed-in' ? undefined : <TodayAuthGate baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />}
          updateBanner={<UpdateBanner />}
          narrationSpeed={narrationSpeed}
          onSelectNarrationSpeed={(speed) => { if (isReaderSpeed(speed)) { setNarrationSpeed(speed); void speedStore.update(memberId, speed); } }}
          metadata={contentMetadata}
        />
      )}
    />
  );
}
