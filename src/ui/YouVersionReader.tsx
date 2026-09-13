import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createYouVersionAdapter } from '../services/youVersionAdapter';
import type { YouVersionReaderUiModule } from '../services/youVersionAdapter';
import { theme } from './Theme';
import { formatReferenceListZhTw, formatReferenceZhTw } from '../domain/scriptureReference';
import { buildYouVersionReaderConfig } from './youVersionReaderConfig';
import { getYouVersionContentMetadata } from '../config/youVersionContent';
import { buildReaderDomBridge, readReaderUiMessage, READER_SETTINGS_MESSAGE, READER_CANVAS_TAP_MESSAGE, READER_CANVAS_SCROLL_MESSAGE } from './readerSettingsBridge';
import { useReaderPreferencesBinding, type ReaderPreferencesBinding } from './useReaderPreferencesBinding';

export interface ReaderOverlayControls {
  ready: boolean;
  openSettings(): void;
  openChapterPicker(): void;
  openVersionPicker(): void;
}

export function YouVersionReader({ date, references, appKey, versionId, book, chapter, allowTechnicalProbe, attributionMode = 'compact', allowedVersionIds = versionId === null ? [] : [versionId], onBookChange, onChapterChange, onVersionChange, onVersionPickerPress, activeReferenceIndex: controlledIndex, onActiveReferenceChange, fullscreen = false, onCanvasTap, onCanvasScroll, readerPreferences, renderScreen = (reader) => reader }: { date: string; references: string[]; appKey: string | null; versionId: number | null; book?: string; chapter?: string; allowTechnicalProbe: boolean; attributionMode?: 'compact' | 'full'; allowedVersionIds?: number[]; onBookChange?: (book: string) => void; onChapterChange?: (chapter: string) => void; onVersionChange?: (versionId: number) => void; onVersionPickerPress?: () => void; activeReferenceIndex?: number; onActiveReferenceChange?: (index: number) => void; fullscreen?: boolean; onCanvasTap?: () => void; onCanvasScroll?: () => void; readerPreferences?: ReaderPreferencesBinding; renderScreen?: (reader: ReactNode, controls: ReaderOverlayControls) => ReactNode }) {
  const [readerModule, setReaderModule] = useState<YouVersionReaderUiModule | null>(null);
  const preferencesBinding = useReaderPreferencesBinding(readerModule, readerPreferences);
  const [error, setError] = useState<string | null>(null);
  // Review 120: which assigned passage is active is not private to this component - the chapter audio
  // has to resolve the SAME passage. So the owner may control it. Left uncontrolled, behaviour is
  // exactly as before.
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);
  const activeReferenceIndex = controlledIndex ?? uncontrolledIndex;
  const setActiveReferenceIndex = (index: number): void => {
    if (controlledIndex === undefined) setUncontrolledIndex(index);
    onActiveReferenceChange?.(index);
  };
  const [retryNonce, setRetryNonce] = useState(0);
  const configs = appKey && versionId ? references.map((reference) => buildYouVersionReaderConfig({ references: [reference], appKey, versionId, allowTechnicalProbe })) : [];
  // Assigned tasks are optional. A controlled free-browse location is sufficient
  // to initialize the official reader, including on days with no scheduled task.
  const freeBrowseConfig = appKey && versionId && book?.trim() && chapter?.trim()
    ? { book, chapter, versionId, references: [], allowTechnicalProbe }
    : null;
  const activeConfig = configs[activeReferenceIndex] ?? configs[0] ?? freeBrowseConfig;
  const contentMetadata = getYouVersionContentMetadata(versionId);
  const permittedLanguageTags = Array.from(new Set(allowedVersionIds.flatMap(id => {
    const tag = getYouVersionContentMetadata(id)?.languageTag;
    return tag ? [tag] : [];
  })));
  const hasVersionMetadata = Boolean(contentMetadata);
  const hasConfig = Boolean(activeConfig);
  const [overlay, setOverlay] = useState<'settings' | 'chapter' | 'version' | null>(null);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useLayoutEffect(() => { setOverlay(null); }, [readerPreferences?.ownerId]);
  const ready = Boolean(readerModule && preferencesBinding.ready && hasConfig && allowTechnicalProbe && appKey && versionId !== null && !error);
  const overlayControls = useMemo<ReaderOverlayControls>(() => ({
    ready,
    openSettings: () => { if (ready) setOverlay('settings'); },
    openChapterPicker: () => { if (ready) setOverlay('chapter'); },
    openVersionPicker: () => { if (ready) setOverlay('version'); },
  }), [ready]);
  const readerDom = useMemo(() => ({
    injectedJavaScript: buildReaderDomBridge(fullscreen, hasVersionMetadata),
    onMessage: (event: { nativeEvent: { data: string } }) => {
      const message = readReaderUiMessage(event.nativeEvent.data);
      if (message === READER_SETTINGS_MESSAGE) overlayControls.openSettings();
      else if (fullscreen && message === READER_CANVAS_TAP_MESSAGE) onCanvasTap?.();
      else if (fullscreen && message === READER_CANVAS_SCROLL_MESSAGE) onCanvasScroll?.();
    },
  }), [fullscreen, hasVersionMetadata, onCanvasTap, onCanvasScroll, overlayControls]);
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
          <BibleReader key={book === undefined && chapter === undefined ? `${date}-${references[safeIndex]}-${versionId}` : 'controlled-reader'} dom={readerDom} book={book} chapter={chapter} defaultBook={selectedConfig.book} defaultChapter={selectedConfig.chapter} versionId={versionId ?? undefined} defaultVersionId={versionId ?? undefined} onBookChange={onBookChange ? async (nextBook) => { onBookChange(nextBook); } : undefined} onChapterChange={onChapterChange ? async (nextChapter) => { onChapterChange(nextChapter); } : undefined} onVersionChange={onVersionChange ? async (nextVersionId) => { onVersionChange(nextVersionId); } : undefined} onVersionPickerPress={onVersionPickerPress ? async () => { onVersionPickerPress(); } : undefined} showToolbar={!fullscreen} theme="light" />
        </View>
      {!fullscreen && <Text style={styles.attribution} numberOfLines={2}>{attributionMode === 'compact'
        ? `${contentMetadata?.translationName ?? `YouVersion ${versionId}`}／${contentMetadata?.publisher ?? '官方內容'}`
        : `日期：${date}。指定範圍：${formatReferenceListZhTw(references)}。版本：${contentMetadata ? `${contentMetadata.translationName}（${contentMetadata.versionId}）／${contentMetadata.publisher}` : `YouVersion ${versionId}`}`}</Text>}
    </View>
  );
  return (
    <View style={styles.host}>
      <Provider appKey={appKey} locale="zh-Hant-TW" permittedVersionIds={allowedVersionIds} permittedLanguageTags={permittedLanguageTags.length ? permittedLanguageTags : undefined}>
        <View style={styles.host} accessibilityElementsHidden={Boolean(overlay)} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}>
          {renderScreen(surface, overlayControls)}
        </View>
        {/* NativeSheet issues one snap when activated. Keep its native host mounted
            while closed so layout/detents can settle before that opening command. */}
        <BibleReaderSettingsSheet isSettingsSheetOpen={overlay === 'settings'} onClose={closeOverlay} />
        <BibleChapterPickerSheet isOpen={overlay === 'chapter'} onClose={closeOverlay} book={book ?? selectedConfig.book} chapter={chapter ?? selectedConfig.chapter} versionId={versionId} theme="light" onSelect={(next) => {
          if (!allowedVersionIds.includes(next.versionId)) return;
          onBookChange?.(next.book);
          onChapterChange?.(next.chapter);
          onVersionChange?.(next.versionId);
          closeOverlay();
        }} />
        <BibleVersionPickerSheet isOpen={overlay === 'version'} onClose={closeOverlay} versionId={versionId} theme="light" onSelect={(nextVersionId) => {
          if (!allowedVersionIds.includes(nextVersionId)) return;
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
  );
}

const styles = StyleSheet.create({
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
