import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls } from './ChapterAudioControls';
import { bookAbbreviationZhTw, formatChapterTitleZhTw, formatReferenceListZhTw } from '../domain/scriptureReference';
import { theme } from './Theme';
import type { ReaderOverlayControls } from './YouVersionReader';
import { READER_SPEEDS } from '../services/readerSpeedPreference';

export function useReaderChrome() {
  const [focused, setFocused] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false);
      setMoreOpen(false);
      setAudioOpen(false);
      setInfoOpen(false);
      setJournalOpen(false);
    };
  }, []));

  // Compatibility with the existing DOM callbacks: common controls are now persistent.
  const showTools = useCallback(() => {}, []);
  const hideTools = showTools;
  const toggleTools = showTools;
  const openMore = useCallback(() => { setMoreOpen(true); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeMore = useCallback(() => { setMoreOpen(false); showTools(); }, [showTools]);
  const openAudio = useCallback(() => { setAudioOpen(true); setMoreOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeAudio = useCallback(() => { setAudioOpen(false); showTools(); }, [showTools]);
  const openInfo = useCallback(() => { setInfoOpen(true); setMoreOpen(false); setAudioOpen(false); showTools(); }, [showTools]);
  const closeInfo = useCallback(() => { setInfoOpen(false); showTools(); }, [showTools]);
  const openJournal = useCallback(() => { setJournalOpen(true); setMoreOpen(false); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeJournal = useCallback(() => { setJournalOpen(false); showTools(); }, [showTools]);
  return { focused, toolsVisible: focused, moreOpen, audioOpen, infoOpen, journalOpen, toggleTools, hideTools, showTools,
    openMore, closeMore, openAudio, closeAudio, openInfo, closeInfo, openJournal, closeJournal };
}
export interface FullscreenReaderLayoutProps {
  reader: ReactNode;
  controls: ReaderOverlayControls;
  chrome: ReturnType<typeof useReaderChrome>;
  chapterUsfm: string;
  versionId: number | null;
  references: string[];
  onSelectReference: (index: number) => void;
  onExit: () => void;
  versionOptions?: Array<{ versionId: number; translationName: string; languageTag: string }>;
  onSelectVersion?: (versionId: number) => void | Promise<void>;
  metadata: { translationName: string; publisher: string; copyrightNotice: string; officialUrl: string; audioAttribution?: string } | null;
  /** Rendered beside the reader, never above it, so typing does not repaint the chapter. */
  journal?: ReactNode;
  narrationSpeed?: number;
  onSelectNarrationSpeed?: (speed: number) => void;
}
export function FullscreenReaderLayout({ reader, controls, chrome, chapterUsfm, versionId, references, onSelectReference, onExit, versionOptions, onSelectVersion, metadata, journal, narrationSpeed = 1, onSelectNarrationSpeed }: FullscreenReaderLayoutProps) {
  const insets = useSafeAreaInsets();
  const [versionPageOpen, setVersionPageOpen] = useState(false);
  const curatedVersions = versionOptions !== undefined && onSelectVersion !== undefined;
  useEffect(() => { if (!chrome.moreOpen) setVersionPageOpen(false); }, [chrome.moreOpen]);
  useEffect(() => {
    if (!chrome.focused) return;
    // Expo 56 writes declarative hidden values into its fallback defaults. Merely
    // popping the last NavigationBar leaves hidden=true; reset that public default
    // as this screen releases ownership, before the empty stack is applied.
    return () => NavigationBar.setHidden(false);
  }, [chrome.focused]);
  const closeVersionPage = () => { setVersionPageOpen(false); chrome.closeMore(); };
  const openOfficial = (open: () => void) => { chrome.closeMore(); open(); };
  return (
    <View style={styles.root}>
      {chrome.focused && <><StatusBar hidden style="dark" /><NavigationBar hidden style="dark" /></>}
      <SafeAreaView
        edges={['top', 'left', 'right']}
        accessibilityLabel="閱讀工具列"
        accessibilityElementsHidden={!chrome.toolsVisible}
        importantForAccessibility={chrome.toolsVisible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={chrome.toolsVisible ? 'box-none' : 'none'}
        style={styles.toolbarSurface}
      >
        {/* Single non-wrapping row: back, the one book/chapter title, journal, more. Play/pause and
            連讀 moved to the fixed bottom player bar below; daily passage chips moved to their own
            row beneath this one. Cramming all of those into one row was what forced ⋯ onto a second
            line on real devices (2026-09-22 review). */}
        <View style={styles.topRow} onTouchStart={chrome.showTools}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回今日" onPress={onExit} style={styles.iconButton}><Text style={styles.icon}>‹</Text></Pressable>
          <Text accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={styles.titleText}>{formatChapterTitleZhTw(chapterUsfm)}</Text>
          {journal ? <Pressable accessibilityRole="button" accessibilityLabel="靈修日記" onPress={chrome.openJournal} style={styles.iconButton}><Text style={styles.icon}>✎</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="更多閱讀工具" onPress={chrome.openMore} style={styles.iconButton}><Text style={styles.icon}>⋯</Text></Pressable>
        </View>
        {references.length > 0 && <View style={styles.dailyRow} onTouchStart={chrome.showTools}>
          {references.map((reference, index) => {
            const selected = isChapterInDailyReference(chapterUsfm, reference);
            return <Pressable key={`${index}:${reference}`} accessibilityRole="button" accessibilityLabel={`前往${formatReferenceListZhTw([reference])}`} accessibilityState={{ selected }} onPress={() => onSelectReference(index)} style={[styles.referenceButton, selected && styles.referenceSelected]}><Text style={[styles.referenceLabel, selected && styles.referenceLabelSelected]}>{formatReferenceListZhTw([reference])}</Text></Pressable>;
          })}
        </View>}
      </SafeAreaView>
      <ChapterAudioAutoplayNotice active={chrome.focused} />
      <View style={[styles.reader, { paddingTop: 0, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]} onTouchEnd={controls.ready ? undefined : chrome.toggleTools}>{reader}</View>
      {journal}
      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        accessibilityLabel="播放列"
        accessibilityElementsHidden={!chrome.toolsVisible}
        importantForAccessibility={chrome.toolsVisible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={chrome.toolsVisible ? 'box-none' : 'none'}
        style={styles.playerBarSurface}
      >
        <View style={styles.playerBar}>
          <ChapterAudioControls chapterUsfm={chapterUsfm} versionId={versionId} translationName={metadata?.translationName} compact active={chrome.focused} detailsVisible={chrome.audioOpen} onDetailsClose={chrome.closeAudio} />
          <ChapterAudioAutoplayToggle active={chrome.focused} />
        </View>
      </SafeAreaView>
      <Modal transparent animationType="fade" visible={chrome.moreOpen} onRequestClose={versionPageOpen ? () => setVersionPageOpen(false) : chrome.closeMore}>
        {chrome.moreOpen && <Pressable accessibilityRole="button" accessibilityLabel="關閉更多閱讀工具" onPress={versionPageOpen ? () => setVersionPageOpen(false) : chrome.closeMore} style={styles.scrim}><Pressable onPress={() => undefined} style={styles.sheetHost}><SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']} accessibilityViewIsModal>
          {versionPageOpen && curatedVersions ? <CuratedVersionChoices options={versionOptions} versionId={versionId} onSelect={onSelectVersion} onBack={() => setVersionPageOpen(false)} onClose={closeVersionPage} /> : <>
          <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.heading}>更多閱讀工具</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={chrome.closeMore} style={styles.iconButton}><Text style={styles.close}>關閉</Text></Pressable></View>
          <ScrollView style={styles.menuScroller} contentContainerStyle={styles.menuContent}>
            <MenuButton label="選擇譯本" disabled={!curatedVersions && !controls.ready} onPress={() => curatedVersions ? setVersionPageOpen(true) : openOfficial(controls.openVersionPicker)} />
            <MenuButton label="調整字體" disabled={!controls.ready} onPress={() => openOfficial(controls.openSettings)} />
            <MenuButton label="選擇其他章節" disabled={!controls.ready} onPress={() => openOfficial(controls.openChapterPicker)} />
            <Text accessibilityRole="header" style={styles.heading}>連讀是什麼？</Text>
            <Text style={styles.body}>連讀開啟後，按播放便會從目前章節開始，依序朗讀當日剩餘章節，並自動換頁；最後一章結束就停止。這不是加快語速。</Text>
            <Text style={styles.body}>工具列的「開/關」表示目前設定，點一下即可切換。關閉後會讀完目前章節再停止；開啟設定不會立即播放。遇到沒有朗讀的章節會停下並提示。</Text>
            {onSelectNarrationSpeed ? <>
              <Text accessibilityRole="header" style={styles.heading}>朗讀速度</Text>
              <View style={styles.speedRow}>
                {READER_SPEEDS.map((speed) => {
                  const selected = speed === narrationSpeed;
                  return <Pressable key={speed} accessibilityRole="button" accessibilityLabel={`朗讀速度 ${speed} 倍`} accessibilityState={{ selected }} onPress={() => onSelectNarrationSpeed(speed)} style={[styles.speedChoice, selected && styles.speedChoiceSelected]}>
                    <Text style={[styles.speedLabel, selected && styles.speedLabelSelected]}>{`${speed}x`}</Text>
                  </Pressable>;
                })}
              </View>
            </> : null}
            <MenuButton label="版本資訊" onPress={chrome.openInfo} />
          </ScrollView>
          </>}
        </SafeAreaView></Pressable></Pressable>}
      </Modal>
      <Modal transparent animationType="fade" visible={chrome.infoOpen} onRequestClose={chrome.closeInfo}>
        {chrome.infoOpen && <Pressable accessibilityRole="button" accessibilityLabel="關閉版本資訊" onPress={chrome.closeInfo} style={styles.scrim}><Pressable onPress={() => undefined} style={styles.sheetHost}><SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']} accessibilityViewIsModal>
          <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.heading}>版本資訊</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={chrome.closeInfo} style={styles.iconButton}><Text style={styles.close}>關閉</Text></Pressable></View>
          <ScrollView style={styles.menuScroller} contentContainerStyle={styles.menuContent}>
            {metadata ? <><Text style={styles.heading}>{metadata.translationName}</Text><Text selectable style={styles.body}>{metadata.publisher}</Text><Text selectable style={styles.body}>{metadata.copyrightNotice}</Text>{metadata.audioAttribution && <Text selectable style={styles.body}>{metadata.audioAttribution}</Text>}{metadata.officialUrl && <MenuButton label="開啟官方版本資訊" onPress={() => { void Linking.openURL(metadata.officialUrl).catch(() => {}); }} />}</> : <Text style={styles.body}>版本資訊尚未載入。</Text>}
          </ScrollView>
        </SafeAreaView></Pressable></Pressable>}
      </Modal>
    </View>
  );
}

function CuratedVersionChoices({ options, versionId, onSelect, onBack, onClose }: {
  options: NonNullable<FullscreenReaderLayoutProps['versionOptions']>;
  versionId: number | null;
  onSelect: NonNullable<FullscreenReaderLayoutProps['onSelectVersion']>;
  onBack: () => void;
  onClose: () => void;
}) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const select = async (nextVersionId: number) => {
    if (saving.current) return;
    saving.current = true;
    setPendingId(nextVersionId);
    setSaveFailed(false);
    try {
      await onSelect(nextVersionId);
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) {
        saving.current = false;
        setPendingId(null);
      }
    }
  };
  const groups = [
    { label: '繁體中文', options: options.filter(option => /^zh-Hant(?:-|$)/i.test(option.languageTag)) },
    { label: 'English', options: options.filter(option => /^en(?:-|$)/i.test(option.languageTag)) },
  ].filter(group => group.options.length > 0);
  return <>
    <View style={styles.sheetHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回更多閱讀工具" onPress={onBack} style={styles.iconButton}><Text style={styles.close}>返回</Text></Pressable>
      <Text accessibilityRole="header" style={styles.heading}>選擇譯本</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="關閉譯本選擇" onPress={onClose} style={styles.iconButton}><Text style={styles.close}>關閉</Text></Pressable>
    </View>
    <ScrollView style={styles.menuScroller} contentContainerStyle={styles.menuContent}>
      {groups.map(group => <View key={group.label} accessibilityRole="radiogroup" accessibilityLabel={group.label}>
        <Text accessibilityRole="header" style={styles.versionGroupHeading}>{group.label}</Text>
        {group.options.map(option => {
          const selected = option.versionId === versionId;
          return <Pressable key={option.versionId} accessibilityRole="radio" accessibilityLabel={option.translationName} accessibilityState={{ checked: selected, disabled: pendingId !== null, busy: pendingId === option.versionId }} disabled={pendingId !== null} onPress={() => { void select(option.versionId); }} style={[styles.versionOption, selected && styles.versionOptionSelected]}>
            <Text style={styles.radioMark}>{selected ? '●' : '○'}</Text><Text style={styles.versionOptionLabel}>{option.translationName}</Text>
          </Pressable>;
        })}
      </View>)}
      {groups.length === 0 && <Text style={styles.body}>目前沒有可選譯本。</Text>}
      {pendingId !== null && <Text accessibilityLiveRegion="polite" style={styles.body}>正在儲存譯本…</Text>}
      {saveFailed && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.versionError}>譯本未儲存，請再試一次。</Text>}
    </ScrollView>
  </>;
}

// Only the daily plan's single-book chapter/verse references and chapter ranges.
// Unknown or cross-book ranges intentionally produce no selected daily button.
function isChapterInDailyReference(chapterUsfm: string, reference: string): boolean {
  const chapter = chapterUsfm.trim().toUpperCase().match(/^([A-Z0-9]+)\.(\d+)$/);
  const assigned = reference.trim().toUpperCase().match(/^([A-Z0-9]+)\.(\d+)(?:-(?:([A-Z0-9]+)\.)?(\d+))?(?:\.\d+(?:-\d+)?)?$/);
  if (!chapter || !assigned || !bookAbbreviationZhTw(chapter[1]) || chapter[1] !== assigned[1] || (assigned[3] && assigned[3] !== assigned[1])) return false;
  const current = Number(chapter[2]);
  const first = Number(assigned[2]);
  const last = Number(assigned[4] ?? assigned[2]);
  return [current, first, last].every(value => Number.isSafeInteger(value) && value > 0) && first <= current && current <= last;
}

function MenuButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.menuButton, disabled && styles.disabled]}><Text style={styles.menuLabel}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  reader: { flex: 1 },
  toolbarSurface: { backgroundColor: theme.colors.surface, flexShrink: 0 },
  // Exactly one row, never wraps: back, single title, journal, more.
  topRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm },
  titleText: { flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  // Today's passage chips: a separate row below the title row, free to wrap when there are many.
  dailyRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xs },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  icon: { color: theme.colors.ink, fontSize: 28, lineHeight: 32 },
  // Fixed bottom player bar: play/pause and 連讀 only, as in the approved prototype.
  playerBarSurface: { backgroundColor: theme.colors.surface, flexShrink: 0, borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, minHeight: 64 },
  referenceButton: { minWidth: 48, minHeight: 48, flexShrink: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.radius.chip, borderWidth: 1, borderColor: theme.colors.borderStrong },
  referenceSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  referenceLabel: { color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '700', textAlign: 'center' },
  referenceLabelSelected: { color: theme.colors.white },
  disabled: { opacity: 0.4 },
  speedRow: { flexDirection: 'row', gap: theme.spacing.sm },
  speedChoice: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong },
  speedChoiceSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  speedLabel: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '700' },
  speedLabelSelected: { color: theme.colors.white },
  scrim: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  // The percentage must resolve against the full-screen scrim, not an intrinsic-height wrapper.
  // Each inner container can shrink so overflowing controls become ScrollView content, not clips.
  sheetHost: { maxHeight: '85%', flexShrink: 1 },
  sheet: { flexShrink: 1, minHeight: 0, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  sheetHeader: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  heading: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '700', flexShrink: 1 },
  close: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  menuScroller: { flexShrink: 1, minHeight: 0 },
  menuContent: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm },
  menuButton: { minHeight: 48, justifyContent: 'center', borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  menuLabel: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  versionGroupHeading: { color: theme.colors.muted, fontSize: theme.type.label.size, fontWeight: '700', paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm },
  versionOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.md, borderRadius: theme.radius.chip },
  versionOptionSelected: { backgroundColor: theme.colors.primarySoft },
  radioMark: { color: theme.colors.primary, fontSize: 20 },
  versionOptionLabel: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, flex: 1 },
  versionError: { color: theme.colors.danger, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  body: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
});
