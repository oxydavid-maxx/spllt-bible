import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createYouVersionAdapter } from '../services/youVersionAdapter';
import type { YouVersionReaderUiModule } from '../services/youVersionAdapter';
import { theme } from './Theme';
import { formatReferenceListZhTw, formatReferenceZhTw } from '../domain/scriptureReference';
import { buildYouVersionReaderConfig, resolveReaderContentApiHost } from './youVersionReaderConfig';
import { getYouVersionContentMetadata } from '../config/youVersionContent';
import { buildReaderDomBridge, readReaderUiMessage, readReaderCanvasScrollEvent, readReaderCanvasRevealEvent, readReaderCanvasEdgeEvent, READER_SETTINGS_MESSAGE, READER_CANVAS_SCROLL_MESSAGE, READER_CANVAS_REVEAL_MESSAGE, READER_CANVAS_EDGE_MESSAGE, type ReaderCanvasInsets, type ReaderRevealReason } from './readerSettingsBridge';
import { useReaderPreferencesBinding, type ReaderPreferencesBinding } from './useReaderPreferencesBinding';
import { BibleContentPreloadHost } from './BibleContentPreloadHost';
import { ChapterAudioAutoplayContext, type ChapterAudioAutoplayContextValue } from './ChapterAudioControls';
import { createReaderAutoplayController, type AutoplayChapter, type AutoplayIntent } from '../services/readerAutoplayController';
import type { ResolutionStatus } from '../domain/chapterAudioContract';

export interface ReaderOverlayControls {
  ready: boolean;
  openSettings(): void;
  openChapterPicker(): void;
  openVersionPicker(): void;
}

function normalizeChapter(value: string): string {
  return value.trim().toUpperCase();
}

/** Daily references may include verses/ranges; audio advances by their chapter identity. */
function chapterForReference(reference: string): string | null {
  const match = reference.trim().toUpperCase().match(/^([A-Z0-9]+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function YouVersionReader({ date, references, appKey, versionId, book, chapter, allowTechnicalProbe, attributionMode = 'compact', allowedVersionIds = versionId === null ? [] : [versionId], onBookChange, onChapterChange, onVersionChange, onVersionPickerPress, activeReferenceIndex: controlledIndex, onActiveReferenceChange, fullscreen = false, onCanvasReveal, onCanvasScroll, onCanvasEdge, canvasInsets, onVerseSelectionChange, clearVerseSelectionSignal = 0, retrySignal = 0, readerPreferences, continuousPlaybackEnabled = true, onContinuousPlaybackChange, renderScreen = (reader) => reader, onVerseCopied, narrationSpeed = 1 }: { date: string; references: string[]; appKey: string | null; versionId: number | null; book?: string; chapter?: string; allowTechnicalProbe: boolean; attributionMode?: 'compact' | 'full'; allowedVersionIds?: number[]; onBookChange?: (book: string) => void; onChapterChange?: (chapter: string) => void; onVersionChange?: (versionId: number) => void; onVersionPickerPress?: () => void; activeReferenceIndex?: number; onActiveReferenceChange?: (index: number) => void; fullscreen?: boolean; onCanvasReveal?: (reason: ReaderRevealReason) => void; onCanvasScroll?: (event: { direction: 'up' | 'down'; deltaY: number }) => void; onCanvasEdge?: (event: { atEnd: boolean }) => void; canvasInsets?: ReaderCanvasInsets; onVerseSelectionChange?: (selected: boolean) => void; clearVerseSelectionSignal?: number; retrySignal?: number; readerPreferences?: ReaderPreferencesBinding; continuousPlaybackEnabled?: boolean; onContinuousPlaybackChange?: (enabled: boolean) => void | Promise<void>; renderScreen?: (reader: ReactNode, controls: ReaderOverlayControls) => ReactNode; onVerseCopied?: (quote: string) => void; narrationSpeed?: number }) {
  const [readerModule, setReaderModule] = useState<YouVersionReaderUiModule | null>(null);
  const preferencesBinding = useReaderPreferencesBinding(readerModule, readerPreferences);
  const [error, setError] = useState<string | null>(null);
  const autoplayControllerRef = useRef(createReaderAutoplayController());
  const automaticPlaybackRef = useRef<string | null>(null);
  const currentPlaybackRef = useRef<AutoplayChapter | null>(null);
  const [autoplayIntent, setAutoplayIntent] = useState<AutoplayIntent | null>(null);
  const [autoplayNotice, setAutoplayNotice] = useState<string | null>(null);
  // Verse the narrator is on, bound to its chapter so a chapter shown while another one plays never paints it.
  const [playingVerse, setPlayingVerse] = useState<{ chapter: string; verse: number } | null>(null);
  const handlePlayingVerse = useCallback((chapterUsfm: string, verse: number | null): void => {
    setPlayingVerse(verse === null ? null : { chapter: normalizeChapter(chapterUsfm), verse });
  }, []);
  const [localAutoplayEnabled, setLocalAutoplayEnabled] = useState(continuousPlaybackEnabled !== false);
  const autoplayEnabled = localAutoplayEnabled;
  useEffect(() => { setLocalAutoplayEnabled(continuousPlaybackEnabled !== false); }, [continuousPlaybackEnabled]);
  const cancelAutoplay = useCallback(() => {
    autoplayControllerRef.current.cancel();
    automaticPlaybackRef.current = null;
    currentPlaybackRef.current = null;
    setAutoplayIntent(null);
    setAutoplayNotice(null);
  }, []);
  useEffect(() => {
    autoplayControllerRef.current.setEnabled(autoplayEnabled);
    if (!autoplayEnabled) {
      setAutoplayIntent(null);
      setAutoplayNotice(null);
    } else if (currentPlaybackRef.current) {
      // Enabling while the same assigned chapter is already playing arms only its next EOF.
      autoplayControllerRef.current.begin(currentPlaybackRef.current);
    }
  }, [autoplayEnabled]);
  useEffect(() => () => {
    autoplayControllerRef.current.cancel();
    automaticPlaybackRef.current = null;
    currentPlaybackRef.current = null;
  }, []);
  useEffect(() => {
    // Any route identity change invalidates the old player's EOF handoff.
    cancelAutoplay();
    setAutoplayNotice(null);
  }, [cancelAutoplay, date, versionId, references.join('|'), readerPreferences?.ownerId]);
  // Review 120: which assigned passage is active is not private to this component - the chapter audio
  // has to resolve the SAME passage. So the owner may control it. Left uncontrolled, behaviour is
  // exactly as before.
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);
  const activeReferenceIndex = controlledIndex ?? uncontrolledIndex;
  const setActiveReferenceIndex = (index: number, automatic = false): void => {
    if (!automatic) cancelAutoplay();
    if (controlledIndex === undefined) setUncontrolledIndex(index);
    onActiveReferenceChange?.(index);
  };
  const previousControlledIndex = useRef<number | undefined>(controlledIndex);
  const autoAdvanceIndex = useRef<number | null>(null);
  const externalControlledChange = controlledIndex !== undefined
    && previousControlledIndex.current !== undefined
    && controlledIndex !== previousControlledIndex.current
    && controlledIndex !== autoAdvanceIndex.current;
  useEffect(() => {
    if (externalControlledChange) {
      autoAdvanceIndex.current = null;
      cancelAutoplay();
      setAutoplayNotice(null);
    } else if (controlledIndex !== undefined && controlledIndex === autoAdvanceIndex.current) {
      autoAdvanceIndex.current = null;
    }
    previousControlledIndex.current = controlledIndex;
  }, [cancelAutoplay, controlledIndex, externalControlledChange]);
  const currentAssignedChapter = useCallback((chapterUsfm: string): AutoplayChapter | null => {
    const reference = references[activeReferenceIndex];
    const expected = reference ? chapterForReference(reference) : null;
    // ReaderScreen controls book/chapter in both assigned and free-browse modes. A late
    // callback from the old assigned binding must not re-arm daily playback after the
    // visible Reader has moved elsewhere.
    const visibleChapter = book?.trim() && chapter?.trim() ? normalizeChapter(`${book}.${chapter}`) : null;
    if (!reference || !expected || expected !== normalizeChapter(chapterUsfm)
      || (visibleChapter !== null && visibleChapter !== expected)) return null;
    return { index: activeReferenceIndex, reference, usfm: expected };
  }, [activeReferenceIndex, book, chapter, references.join('|')]);
  const handlePlaybackStarted = useCallback((chapterUsfm: string): void => {
    const current = currentAssignedChapter(chapterUsfm);
    if (!current) {
      if (autoplayIntent) cancelAutoplay();
      return;
    }
    // Track a manually started assigned chapter even while continuous mode is off. Turning the
    // switch on during that still-playing track may arm its next EOF, but never starts playback.
    currentPlaybackRef.current = current;
    if (!autoplayEnabled) return;
    const pending = autoplayIntent;
    const intent = autoplayControllerRef.current.begin(current);
    if (!intent) return;
    automaticPlaybackRef.current = pending && autoplayControllerRef.current.isIntentCurrent(pending)
      && pending.index === current.index ? current.usfm : null;
    setAutoplayIntent(null);
    setAutoplayNotice(null);
  }, [autoplayEnabled, autoplayIntent, cancelAutoplay, currentAssignedChapter]);
  const handlePlaybackPaused = useCallback((chapterUsfm: string): void => {
    if (!currentAssignedChapter(chapterUsfm)) return;
    automaticPlaybackRef.current = null;
    currentPlaybackRef.current = null;
    cancelAutoplay();
    setAutoplayNotice(null);
  }, [cancelAutoplay, currentAssignedChapter]);
  const handlePlaybackEnded = useCallback((chapterUsfm: string): void => {
    const current = currentAssignedChapter(chapterUsfm);
    if (!current) return;
    currentPlaybackRef.current = null;
    automaticPlaybackRef.current = null;
    if (!autoplayEnabled) {
      autoplayControllerRef.current.cancel();
      setAutoplayIntent(null);
      return;
    }
    const nextReference = references[current.index + 1];
    const nextChapter = nextReference ? chapterForReference(nextReference) : null;
    const next = nextReference && nextChapter
      ? { index: current.index + 1, reference: nextReference, usfm: nextChapter }
      : null;
    const decision = autoplayControllerRef.current.onEof(current, next);
    if (decision.kind === 'advance') {
      setAutoplayNotice(null);
      setAutoplayIntent(decision.intent);
      if (controlledIndex !== undefined) autoAdvanceIndex.current = decision.intent.index;
      setActiveReferenceIndex(decision.intent.index, true);
    } else if (decision.kind === 'stop' && decision.reason === 'last') {
      setAutoplayIntent(null);
      setAutoplayNotice(null);
    }
  }, [autoplayEnabled, currentAssignedChapter, references.join('|')]);
  const handleAutoplayUnavailable = useCallback((chapterUsfm: string, status: ResolutionStatus): void => {
    const current = currentAssignedChapter(chapterUsfm);
    if (!current || !autoplayIntent || autoplayIntent.usfm !== current.usfm || !autoplayControllerRef.current.isIntentCurrent(autoplayIntent)) return;
    autoplayControllerRef.current.cancel();
    automaticPlaybackRef.current = null;
    setAutoplayIntent(null);
    setAutoplayNotice(status === 'explicit_no_audio'
      ? '這一章沒有朗讀，已停止連續播放。'
      : '朗讀暫時無法取得，已停止連續播放。');
  }, [autoplayIntent, currentAssignedChapter]);
  const handlePlaybackError = useCallback((chapterUsfm: string): void => {
    const current = currentAssignedChapter(chapterUsfm);
    if (current) currentPlaybackRef.current = null;
    const pendingAuto = autoplayIntent && currentAssignedChapter(chapterUsfm)
      && autoplayIntent.usfm === normalizeChapter(chapterUsfm)
      && autoplayControllerRef.current.isIntentCurrent(autoplayIntent);
    if (automaticPlaybackRef.current !== normalizeChapter(chapterUsfm) && !pendingAuto) return;
    automaticPlaybackRef.current = null;
    cancelAutoplay();
    setAutoplayNotice('朗讀暫時無法播放，已停止連續播放。');
  }, [autoplayIntent, cancelAutoplay, currentAssignedChapter]);
  const toggleAutoplay = useCallback((): void => {
    const next = !autoplayEnabled;
    setLocalAutoplayEnabled(next);
    autoplayControllerRef.current.setEnabled(next);
    if (!next) {
      automaticPlaybackRef.current = null;
      setAutoplayIntent(null);
      setAutoplayNotice(null);
    } else if (currentPlaybackRef.current) {
      // A live assigned track may continue uninterrupted; arming does not call player.play().
      autoplayControllerRef.current.begin(currentPlaybackRef.current);
    }
    void onContinuousPlaybackChange?.(next);
  }, [autoplayEnabled, cancelAutoplay, onContinuousPlaybackChange]);
  const autoplayContext = useMemo<ChapterAudioAutoplayContextValue>(() => ({
    available: true,
    enabled: autoplayEnabled,
    intent: externalControlledChange ? null : autoplayIntent,
    notice: autoplayNotice,
    cancel: cancelAutoplay,
    toggle: toggleAutoplay,
    onPlaybackStarted: handlePlaybackStarted,
    onPlaybackPaused: handlePlaybackPaused,
    onPlaybackEnded: handlePlaybackEnded,
    onPlaybackError: handlePlaybackError,
    onAutoplayUnavailable: handleAutoplayUnavailable,
    onPlayingVerse: handlePlayingVerse,
    speed: narrationSpeed,
  }), [narrationSpeed, handlePlayingVerse, autoplayEnabled, autoplayIntent, autoplayNotice, cancelAutoplay, toggleAutoplay, handlePlaybackStarted, handlePlaybackPaused, handlePlaybackEnded, handlePlaybackError, handleAutoplayUnavailable, externalControlledChange]);
  const [retryNonce, setRetryNonce] = useState(0);
  const configs = appKey && versionId ? references.map((reference) => buildYouVersionReaderConfig({ references: [reference], appKey, versionId, allowTechnicalProbe })) : [];
  // Assigned tasks are optional. A controlled free-browse location is sufficient
  // to initialize the official reader, including on days with no scheduled task.
  const freeBrowseConfig = appKey && versionId && book?.trim() && chapter?.trim()
    ? { book, chapter, versionId, references: [], allowTechnicalProbe }
    : null;
  const activeConfig = configs[activeReferenceIndex] ?? configs[0] ?? freeBrowseConfig;
  const displayedChapter = book !== undefined && chapter !== undefined ? normalizeChapter(`${book}.${chapter}`) : (chapterForReference(references[activeReferenceIndex] ?? '') ?? null);
  const contentMetadata = getYouVersionContentMetadata(versionId);
  const hasVersionMetadata = Boolean(contentMetadata);
  const hasConfig = Boolean(activeConfig);
  const [overlay, setOverlay] = useState<'settings' | 'chapter' | 'version' | null>(null);
  // Footnotes are shown in our own modal: the SDK's footnote sheet could not be dismissed on device
  // (backdrop tap and swipe never closed it, only the hardware back which also leaves the reader).
  const [footnote, setFootnote] = useState<{ verseNum: string; notes: string[]; reference?: string } | null>(null);
  const closeFootnote = useCallback(() => setFootnote(null), []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useLayoutEffect(() => { setOverlay(null); }, [readerPreferences?.ownerId]);
  const ready = Boolean(readerModule && preferencesBinding.ready && hasConfig && allowTechnicalProbe && appKey && versionId !== null && !error);
  const overlayControls = useMemo<ReaderOverlayControls>(() => ({
    ready,
    openSettings: () => { if (ready) setOverlay('settings'); },
    openChapterPicker: () => { if (ready) setOverlay('chapter'); },
    openVersionPicker: () => { if (ready) setOverlay('version'); },
  }), [ready]);
  const insetTop = canvasInsets?.top, insetBottom = canvasInsets?.bottom;
  const readerDom = useMemo(() => ({
    injectedJavaScript: buildReaderDomBridge(fullscreen, hasVersionMetadata, insetTop === undefined || insetBottom === undefined ? undefined : { top: insetTop, bottom: insetBottom }),
    onMessage: (event: { nativeEvent: { data: string } }) => {
      const data = event.nativeEvent.data;
      const message = readReaderUiMessage(data);
      if (message === READER_SETTINGS_MESSAGE) overlayControls.openSettings();
      else if (!fullscreen) return;
      else if (message === READER_CANVAS_SCROLL_MESSAGE) {
        const scroll = readReaderCanvasScrollEvent(data);
        if (scroll) onCanvasScroll?.(scroll);
      } else if (message === READER_CANVAS_REVEAL_MESSAGE) {
        const reason = readReaderCanvasRevealEvent(data);
        if (reason) onCanvasReveal?.(reason);
      } else if (message === READER_CANVAS_EDGE_MESSAGE) {
        const edge = readReaderCanvasEdgeEvent(data);
        if (edge) onCanvasEdge?.(edge);
      }
    },
  }), [fullscreen, hasVersionMetadata, insetTop, insetBottom, onCanvasReveal, onCanvasScroll, onCanvasEdge, overlayControls]);
  useEffect(() => {
    if (!overlay) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeOverlay();
      return true;
    });
    return () => subscription.remove();
  }, [overlay, closeOverlay]);

  useEffect(() => {
    if (controlledIndex === undefined) setUncontrolledIndex(0);
  }, [references.join('|'), controlledIndex]);

  useEffect(() => {
    let active = true;
    setReaderModule(null);
    setError(null);
    setOverlay(null);
    if (!hasConfig || !allowTechnicalProbe) return () => { active = false; };
    void createYouVersionAdapter({ appKey }).loadReaderUi().then((result) => {
      if (!active) return;
      if (result.status === 'READER_UI_READY') setReaderModule(result.module);
      else setError(result.reason);
    });
    return () => { active = false; };
  }, [allowTechnicalProbe, appKey, hasConfig, retryNonce]);

  if (!activeConfig || !allowTechnicalProbe || !appKey || versionId === null) {
    return renderScreen(<Text style={styles.pending}>官方閱讀器還在準備中，請稍後再試。</Text>, overlayControls);
  }
  if (error) return renderScreen(<View style={styles.errorBox}><Text style={styles.error}>閱讀器暫時無法開啟，請稍後再試。</Text><Pressable accessibilityRole="button" accessibilityLabel="重試開啟讀經" onPress={() => setRetryNonce((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>重試</Text></Pressable></View>, overlayControls);
  if (!readerModule) return renderScreen(<View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.pending}>正在載入官方閱讀器…</Text></View>, overlayControls);
  if (preferencesBinding.failed) return renderScreen(<View style={styles.errorBox}><Text accessibilityRole="alert" style={styles.error}>無法套用此帳號的閱讀設定，請重試。</Text><Pressable accessibilityRole="button" accessibilityLabel="重試套用帳號閱讀設定" onPress={() => setRetryNonce(value => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>重試</Text></Pressable></View>, overlayControls);
  if (!preferencesBinding.ready) return renderScreen(<View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.pending}>正在套用帳號閱讀設定…</Text></View>, overlayControls);

  const { YouVersionProvider: Provider, BibleReader, BibleReaderSettingsSheet, BibleChapterPickerSheet, BibleVersionPickerSheet } = readerModule;
  const safeIndex = Math.min(activeReferenceIndex, Math.max(0, configs.length - 1));
  const selectedConfig = configs[safeIndex] ?? activeConfig;
  const surface = (
    <View style={fullscreen ? styles.fullscreen : styles.reader} accessibilityLabel={`YouVersion原生閱讀器：${formatReferenceListZhTw(references)}`}>
      {!fullscreen && <View style={styles.selector} accessibilityRole="tablist">
        <ScrollView horizontal style={styles.selectorScroller} contentContainerStyle={styles.selectorButtons} showsHorizontalScrollIndicator={false}>
          {references.map((reference, index) => <Pressable key={reference} accessibilityRole="tab" accessibilityState={{ selected: index === safeIndex }} accessibilityLabel={`選擇${formatReferenceZhTw(reference)}`} onPress={() => setActiveReferenceIndex(index)} style={[styles.selectorButton, index === safeIndex && styles.selectorButtonActive]}><Text style={[styles.selectorButtonText, index === safeIndex && styles.selectorButtonTextActive]}>{formatReferenceZhTw(reference)}</Text></Pressable>)}
        </ScrollView>
        {safeIndex < references.length - 1 && <Pressable accessibilityRole="button" accessibilityLabel="下一段指定經文" onPress={() => setActiveReferenceIndex(safeIndex + 1)} style={styles.nextButton}><Text style={styles.nextButtonText}>下一段 ›</Text></Pressable>}
      </View>}
        <View style={fullscreen ? styles.fullscreen : styles.passage}>
          <BibleReader key={book === undefined && chapter === undefined ? `${date}-${references[safeIndex]}-${versionId}` : 'controlled-reader'} dom={readerDom} book={book} chapter={chapter} defaultBook={selectedConfig.book} defaultChapter={selectedConfig.chapter} versionId={versionId ?? undefined} defaultVersionId={versionId ?? undefined} onBookChange={onBookChange ? async (nextBook) => { cancelAutoplay(); onBookChange(nextBook); } : undefined} onChapterChange={onChapterChange ? async (nextChapter) => { cancelAutoplay(); onChapterChange(nextChapter); } : undefined} onVersionChange={onVersionChange ? async (nextVersionId) => { cancelAutoplay(); onVersionChange(nextVersionId); } : undefined} onVersionPickerPress={onVersionPickerPress ? async () => { cancelAutoplay(); onVersionPickerPress(); } : undefined} onFootnotePress={async (data) => { setFootnote({ verseNum: data.verseNum, notes: data.notes, reference: data.reference }); }} onVerseSelect={onVerseSelectionChange ? async (selection) => { onVerseSelectionChange(selection.verses.length > 0); } : undefined} clearSelectionSignal={clearVerseSelectionSignal} retrySignal={retrySignal} onCopy={(data) => { void copyVerses(data); }} showToolbar={!fullscreen} theme="light" playingVerse={playingVerse && playingVerse.chapter === displayedChapter ? playingVerse.verse : null} />
        </View>
      {!fullscreen && <Text style={styles.attribution} numberOfLines={2}>{attributionMode === 'compact'
        ? `${contentMetadata?.translationName ?? `YouVersion ${versionId}`}／${contentMetadata?.publisher ?? '官方內容'}`
        : `日期：${date}。指定範圍：${formatReferenceListZhTw(references)}。版本：${contentMetadata ? `${contentMetadata.translationName}（${contentMetadata.versionId}）／${contentMetadata.publisher}` : `YouVersion ${versionId}`}`}</Text>}
    </View>
  );
  /**
   * The reader's own Copy button, intercepted.
   *
   * Two things make this necessary rather than optional. The SDK's verse action list is not
   * configurable from here — `verseActions` is excluded from the props it accepts — so Copy is the
   * only place a selected verse's TEXT is ever handed to us; `onVerseSelect` gives numbers only.
   * And supplying `onCopy` REPLACES the SDK's own clipboard fallback, so if we did not write to the
   * clipboard ourselves we would silently break copying for everyone who just wanted to copy.
   *
   * So: always copy, and additionally hand the quote to the journal when it is listening.
   */
  const copyVerses = async (data: { text: string; reference: string; verseText: string }) => {
    // Loaded on demand, the way this app already loads expo-notifications: a native module imported
    // at the top of a screen has to exist before the screen can render at all, including under test.
    try {
      const clipboard = await import('expo-clipboard');
      await clipboard.setStringAsync(data.text);
    } catch { /* copying is best effort; the quote below still reaches the journal */ }
    onVerseCopied?.(`「${data.verseText}」${data.reference}`);
  };

  const footnotePanel = footnote ? <Modal transparent animationType="fade" visible onRequestClose={closeFootnote}>
    <Pressable accessibilityRole="button" accessibilityLabel="關閉註腳" onPress={closeFootnote} style={styles.footnoteScrim}>
      <Pressable onPress={() => undefined} style={styles.footnoteHost} accessibilityViewIsModal>
        {/* The bottom edge keeps the notes above a three-button navigation bar, which otherwise
            covered everything under the title (2026-09-26). */}
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footnoteSheet}>
        <View style={styles.footnoteHeader}><Text accessibilityRole="header" style={styles.footnoteTitle}>{`${footnote.reference ?? formatReferenceZhTw(references[activeReferenceIndex] ?? '')} 第 ${footnote.verseNum} 節 註腳`}</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={closeFootnote} hitSlop={8} style={styles.footnoteClose}><Text style={styles.footnoteCloseText}>關閉</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.footnoteBody}>{footnote.notes.map((note, index) => <Text key={index} style={styles.footnoteNote}>{`${String.fromCharCode(97 + index)}. ${stripHtml(note)}`}</Text>)}</ScrollView>
        </SafeAreaView>
      </Pressable>
    </Pressable>
  </Modal> : null;
  return (
    <ChapterAudioAutoplayContext.Provider value={autoplayContext}>
      <View style={styles.host}>
        {footnotePanel}
        {/* The tracked SDK patch also carries apiHost across the native-to-DOM provider boundary. */}
        <Provider appKey={appKey} apiHost={resolveReaderContentApiHost(process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL)} locale="zh-Hant-TW" permittedVersionIds={allowedVersionIds}>
          <View style={styles.host} accessibilityElementsHidden={Boolean(overlay)} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}>
            {renderScreen(surface, overlayControls)}
          </View>
          <BibleContentPreloadHost
            enabled={Boolean(readerModule && preferencesBinding.ready && hasConfig && allowTechnicalProbe && appKey && versionId !== null)}
            versionId={versionId}
            references={references}
            activeReferenceIndex={safeIndex}
            generationKey={`${date}:${versionId ?? 'none'}:${references.join('|')}`}
          />
          {/* NativeSheet issues one snap when activated. Keep its native host mounted
              while closed so layout/detents can settle before that opening command. */}
          <BibleReaderSettingsSheet isSettingsSheetOpen={overlay === 'settings'} onClose={closeOverlay} />
          <BibleChapterPickerSheet isOpen={overlay === 'chapter'} onClose={closeOverlay} book={book ?? selectedConfig.book} chapter={chapter ?? selectedConfig.chapter} versionId={versionId} theme="light" onSelect={(next) => {
            if (!allowedVersionIds.includes(next.versionId)) return;
            cancelAutoplay();
            onBookChange?.(next.book);
            onChapterChange?.(next.chapter);
            onVersionChange?.(next.versionId);
            closeOverlay();
          }} />
          <BibleVersionPickerSheet isOpen={overlay === 'version'} onClose={closeOverlay} versionId={versionId} theme="light" onSelect={(nextVersionId) => {
            if (!allowedVersionIds.includes(nextVersionId)) return;
            cancelAutoplay();
            onVersionChange?.(nextVersionId);
            closeOverlay();
          }} />
          {overlay && <SafeAreaView edges={['top']} style={styles.settingsHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="完成設定，返回閱讀" onPress={closeOverlay} style={styles.settingsDone}>
              <Text style={styles.settingsDoneText}>完成，返回閱讀</Text>
            </Pressable>
          </SafeAreaView>}
        </Provider>
      </View>
    </ChapterAudioAutoplayContext.Provider>
  );
}

/** Footnote HTML from the provider is a short inline fragment; show it as plain text. */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

const styles = StyleSheet.create({
  footnoteScrim: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  footnoteHost: { maxHeight: '60%' },
  footnoteSheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, paddingBottom: theme.spacing.lg },
  footnoteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md },
  footnoteTitle: { flex: 1, color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' },
  footnoteClose: { minHeight: theme.control.tap, minWidth: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  footnoteCloseText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  footnoteBody: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  footnoteNote: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  host: { flex: 1, minHeight: 0 },
  fullscreen: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface },
  settingsHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2001, elevation: 20, backgroundColor: theme.colors.surface },
  settingsDone: { minWidth: theme.control.tap, minHeight: theme.control.tap, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, alignItems: 'flex-end', justifyContent: 'center' },
  settingsDoneText: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  reader: { flex: 1, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, backgroundColor: theme.colors.surface },
  // One 44dp band of app chrome above the official renderer instead of a 100dp block
  // plus a duplicate passage label. The active chip already names the passage.
  selector: {
    minHeight: theme.control.tapCompact,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: theme.control.hairline,
    backgroundColor: theme.colors.surfaceMuted,
  },
  selectorTitle: { color: theme.colors.muted, fontSize: theme.type.micro.size, fontWeight: '800' },
  selectorScroller: { flex: 1 },
  selectorButtons: { flexDirection: 'row', gap: theme.spacing.xs },
  // minWidth added because the zh-TW abbreviations are SHORT: 詩88 is three glyphs, so the tab
  // collapsed to 46.5dp wide once the labels stopped being PSA.88. Height was already fixed by the
  // tapCompact change; this is the width half, and it is a side effect of my own label change.
  selectorButton: { minHeight: theme.control.tapCompact, minWidth: theme.control.tap, alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  selectorButtonActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  selectorButtonText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '700' },
  selectorButtonTextActive: { color: theme.colors.white },
  nextButton: { minHeight: theme.control.tapCompact, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  nextButtonText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
  passage: { flex: 1, borderBottomColor: theme.colors.border, borderBottomWidth: theme.control.hairline },
  attribution: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, padding: theme.spacing.md },
  pending: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, padding: theme.spacing.md },
  error: { color: theme.colors.danger, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, paddingHorizontal: theme.spacing.md },
  errorBox: { minHeight: 120, justifyContent: 'center', padding: theme.spacing.md, gap: theme.spacing.sm },
  retryButton: { alignSelf: 'flex-start', minHeight: theme.control.tap, borderColor: theme.colors.primary, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, justifyContent: 'center', paddingHorizontal: theme.spacing.xl },
  retryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
});
