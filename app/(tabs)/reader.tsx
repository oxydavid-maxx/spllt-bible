import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildFixtureModels } from '../../src/ui/routes';
import { YouVersionReader } from '../../src/ui/YouVersionReader';
import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { JournalPanel } from '../../src/ui/JournalPanel';
import { createJournalFolderMirror } from '../../src/services/journalFolderMirror';
import { createReaderSpeedStore, DEFAULT_READER_SPEED, isReaderSpeed, type ReaderSpeed } from '../../src/services/readerSpeedPreference';
import { formatReadingDateLabel } from '../../src/ui/ReadingDateNavigator';
import { openQingmuReaderPositionStore, openQingmuRepository } from '../../src/storage/mobileDatabase';
import type { ReaderPosition } from '../../src/storage/readerPosition';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import type { CompletionRecord } from '../../src/domain/completion';
import { getYouVersionContentMetadata, getYouVersionVersionOptions } from '../../src/config/youVersionContent';
import { buildYouVersionChapterUrl } from '../../src/ui/youVersionReaderConfig';
import { createNativeReaderPreferencesStore } from '../../src/services/nativeReaderPreferences';
import { createReaderAutoplayPreferencesStore } from '../../src/services/readerAutoplayPreferences';
import type { ReaderPreferencesPatch } from '../../src/services/readerPreferences';
import { useReaderPreferences } from '../../src/ui/useReaderPreferences';
import { setSelectedReadingDate, useReadingSession } from '../../src/ui/readingSession';
import { createApiClient } from '../../src/services/apiClient';
import { isCurrentAuthSession, useAuthSnapshot } from '../../src/services/authSession';
import * as SecureStore from 'expo-secure-store';
import { createReminderScheduler } from '../../src/services/reminderScheduler';
import { syncReadingReminderForCompletion } from '../../src/services/reminderCompletion';
import { isWithinCompletionWindow, taipeiDate } from '../../src/domain/gamificationV1';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { TodayAuthGate } from '../../src/ui/TodayAuthGate';
import { UpdateBanner } from '../../src/ui/UpdateBanner';
import { runtimeConfig } from '../../src/config/runtime';
import { useOutboxRecovery } from '../../src/services/useOutboxRecovery';

let handledTodayReaderTabPressRevision = 0;

export default function ReaderScreen() {
  const chrome = useReaderChrome();
  const { selectedDate, planId, day, period, previousDate, nextDate, todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate } = useReadingSession();
  // Set when a verse is copied while the journal is open, cleared once the panel has taken it.
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const auth = useAuthSnapshot();
  const session = auth.session;
  const [reminderScheduler] = useState(() => createReminderScheduler());
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
  const repositoryRef = useRef<ReturnType<typeof openQingmuRepository> | null>(null);
  const clientRef = useRef<ReturnType<typeof createApiClient> | null>(null);
  const positionStoreRef = useRef<ReturnType<typeof openQingmuReaderPositionStore> | null>(null);
  const [readerPosition, setReaderPosition] = useState<ReaderPosition | null>(null);
  const [syncError, setSyncError] = useState(false);
  const authToken = session?.sessionToken ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim() ?? null : null);
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
  const [record, setRecord] = useState<CompletionRecord>(() => {
    const initialMemberId = memberId ?? 'signed-out';
    if (!memberId) return { memberId: initialMemberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    try {
      const repository = openQingmuRepository();
      repositoryRef.current = repository;
      return repository.get({ memberId, planId, taskDate: selectedDate }) ?? {
        memberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED',
      };
    } catch {
      return { memberId: initialMemberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    }
  });
  const completionBusy = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!memberId) {
      setRecord({ memberId: 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' });
      return () => { active = false; };
    }
    const repository = repositoryRef.current ?? openQingmuRepository();
    repositoryRef.current = repository;
    setRecord(repository.get({ memberId, planId, taskDate: selectedDate }) ?? {
      memberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED',
    });
    if (clientRef.current) {
      void repository.flush((command) => clientRef.current!.saveCompletion(command), memberId).then(() => {
        const recovered = repository.get({ memberId, planId, taskDate: selectedDate });
        if (active && recovered) setRecord(recovered);
      }).catch(() => { if (active) setSyncError(true); });
    }
    return () => { active = false; };
  }, [memberId, planId, selectedDate]));
  useEffect(() => {
    if (!ownsReader()) return;
    selectionOwner.current = owner;
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
  }, [memberId, planId, selectedDate, owner, references.join('|')]);
  useEffect(() => {
    if (!memberId) {
      clientRef.current = null;
      setSyncError(false);
    }
  }, [memberId]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const token = authToken;
      const activeMemberId = memberId;
      if (!token || !activeMemberId) return;
      clientRef.current = createApiClient({
        baseUrl: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL?.trim() || 'http://127.0.0.1:8787',
        token,
        memberId: activeMemberId,
      });
      if (repositoryRef.current) {
        await repositoryRef.current.flush((command) => clientRef.current!.saveCompletion(command), activeMemberId);
        const recovered = repositoryRef.current.get({ memberId: activeMemberId, planId, taskDate: selectedDate });
        if (active && recovered) setRecord(recovered);
      }
      if (active) setSyncError(false);
    })().catch(() => {
      if (active) setSyncError(true);
    });
    return () => { active = false; };
  }, [authToken, memberId, planId, selectedDate]);
  useOutboxRecovery({
    memberId,
    sessionToken: session?.sessionToken ?? null,
    planId,
    taskDate: selectedDate,
    getRepository: () => repositoryRef.current,
    getClient: () => clientRef.current,
    getSession: () => session,
    isCurrentAuthSession,
    onRecovered: () => {
      const repository = repositoryRef.current;
      if (!repository || !memberId || !isCurrentAuthSession(session)) return;
      const recovered = repository.get({ memberId, planId, taskDate: selectedDate });
      if (!recovered) return;
      setRecord(recovered);
      if (recovered.syncStatus === 'CONFIRMED') setSyncError(false);
      else if (recovered.syncStatus === 'SAVE_FAILED') setSyncError(true);
    },
  });
  const saveCompletionStatus = async (desiredStatus: 'COMPLETED' | 'NOT_COMPLETED') => {
    const repository = repositoryRef.current;
    if (!repository || !memberId || !ownsReader() || completionBusy.current) return;
    const identity = { memberId, planId, taskDate: selectedDate };
    const current = repository.get(identity) ?? record;
    if (current.syncStatus === 'PENDING_SAVE') return;
    if (current.syncStatus !== 'SAVE_FAILED' && desiredStatus === 'COMPLETED' && (!day || !isWithinCompletionWindow(selectedDate, taipeiDate()))) return;
    if (current.syncStatus !== 'SAVE_FAILED' && desiredStatus === 'COMPLETED' && current.status === 'COMPLETED') return;
    if (current.syncStatus !== 'SAVE_FAILED' && desiredStatus === 'NOT_COMPLETED' && current.status !== 'COMPLETED') return;
    completionBusy.current = true;
    setSyncError(false);
    if (current.syncStatus === 'SAVE_FAILED') {
      try {
        const results = await repository.flush((command) => clientRef.current!.saveCompletion(command), memberId);
        if (!ownsReader()) return;
        const recovered = repository.get(identity);
        if (recovered) {
          setRecord(recovered);
          setSyncError(recovered.syncStatus !== 'CONFIRMED');
        } else if (results.at(-1)?.ok === false) setSyncError(true);
      } catch {
        if (ownsReader()) {
          const failed = repository.get(identity);
          if (failed) setRecord(failed);
          setSyncError(true);
        }
      } finally { completionBusy.current = false; }
      return;
    }
    const next = repository.saveCompletion({
      memberId,
      planId,
      taskDate: selectedDate,
      desiredStatus,
      operationId: randomUUID(),
      expectedRevision: current.revision,
      syncStatus: 'PENDING_SAVE',
    });
    void syncReadingReminderForCompletion({ memberId, planId, taskDate: selectedDate, status: desiredStatus, scheduler: reminderScheduler, store: SecureStore });
    setRecord(next);
    try {
      if (clientRef.current) {
        const results = await repository.flush((command) => clientRef.current!.saveCompletion(command), memberId);
        if (ownsReader()) {
          const confirmed = repository.get(next);
          if (confirmed) {
            setRecord(confirmed);
            setSyncError(confirmed.syncStatus !== 'CONFIRMED');
          } else if (results.at(-1)?.ok === false) setSyncError(true);
        }
      }
    } catch {
      if (ownsReader()) {
        const failed = repository.get(identity);
        if (failed) setRecord(failed);
        setSyncError(true);
      }
    }
    finally { completionBusy.current = false; }
  };
  const requestUndo = () => {
    const dateLabel = selectedDate === taipeiDate() ? '今天' : formatReadingDateLabel(selectedDate);
    Alert.alert(`確定撤銷${dateLabel}的完成？`, '這一天的積分會一併撤回。', [
      { text: '取消', style: 'cancel' },
      { text: '撤銷', style: 'destructive', onPress: () => { void saveCompletionStatus('NOT_COMPLETED'); } },
    ]);
  };
  const onComplete = () => saveCompletionStatus('COMPLETED');
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
  }, [todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate, auth.status, auth.epoch, memberId, planId, selectedDate, day?.date, referencesKey, owner]);
  const visibleRecord = record.memberId === (memberId ?? 'signed-out') && record.planId === planId && record.taskDate === selectedDate
    ? record
    : { memberId: memberId ?? 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
  const completed = visibleRecord.status === 'COMPLETED';
  const completionPending = visibleRecord.syncStatus === 'PENDING_SAVE';
  const completionFailed = visibleRecord.syncStatus === 'SAVE_FAILED';
  const withinCompletionWindow = isWithinCompletionWindow(selectedDate, taipeiDate());
  const completionLabel = !memberId ? '登入後完成' : !day ? '無排定讀經' : !withinCompletionWindow ? '超過補登期限' : '完成讀經';
  const completionDisabled = completionPending || (!completed && !completionFailed && (!memberId || !day || !withinCompletionWindow));
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
      onVerseCopied={(quote) => setPendingQuote(quote)}
      narrationSpeed={narrationSpeed}
      renderScreen={(reader, controls) => (
        <FullscreenReaderLayout
          reader={reader}
          controls={controls}
          chrome={chrome}
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
          statusMessage={syncError ? '同步遇到問題，完成狀態已保留；連線後會重試。' : undefined}
          canOpenYouVersion={youVersionChapterUrl !== null}
          onOpenYouVersion={openYouVersionChapter}
          versionOptions={versionOptions}
          onSelectVersion={chooseVersion}
          accountEntry={<AccountEntryButton />}
          loginGate={auth.status === 'signed-in' ? undefined : <TodayAuthGate baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />}
          updateBanner={<UpdateBanner />}
          narrationSpeed={narrationSpeed}
          onSelectNarrationSpeed={(speed) => { if (isReaderSpeed(speed)) { setNarrationSpeed(speed); void speedStore.update(memberId, speed); } }}
          journal={<JournalPanel
            visible={chrome.journalOpen}
            memberId={memberId}
            planId={planId}
            taskDate={selectedDate}
            dateLabel={formatReadingDateLabel(selectedDate)}
            newOperationId={randomUUID}
            onClose={chrome.closeJournal}
            pendingQuote={pendingQuote}
            onQuoteConsumed={() => setPendingQuote(null)}
            mirror={(taskDate, body) => { void journalMirror.write(memberId, taskDate, body); }}
          />}
          metadata={contentMetadata}
        />
      )}
    />
  );
}
