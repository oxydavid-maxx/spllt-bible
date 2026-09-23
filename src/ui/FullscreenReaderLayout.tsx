import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls, type ChapterAudioControlsHandle } from './ChapterAudioControls';
import { bookAbbreviationZhTw, formatChapterTitleZhTw, formatReferenceListZhTw } from '../domain/scriptureReference';
import { theme } from './Theme';
import { formatReadingDateLabel } from './ReadingDateNavigator';
import type { ReaderOverlayControls } from './YouVersionReader';
import { READER_SPEEDS } from '../services/readerSpeedPreference';

export function useReaderChrome() {
  const [focused, setFocused] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(true);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => { if (active) setScreenReaderEnabled(enabled); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => { active = false; subscription.remove(); };
  }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    setToolsVisible(true);
    return () => {
      setFocused(false);
      setMoreOpen(false);
      setAudioOpen(false);
      setInfoOpen(false);
      setJournalOpen(false);
    };
  }, []));

  const showTools = useCallback(() => setToolsVisible(true), []);
  const hideTools = useCallback(() => { if (!screenReaderEnabled && !moreOpen && !audioOpen && !infoOpen && !journalOpen) setToolsVisible(false); }, [screenReaderEnabled, moreOpen, audioOpen, infoOpen, journalOpen]);
  const toggleTools = useCallback(() => { if (!screenReaderEnabled && !moreOpen && !audioOpen && !infoOpen && !journalOpen) setToolsVisible(value => !value); }, [screenReaderEnabled, moreOpen, audioOpen, infoOpen, journalOpen]);
  const handleCanvasScroll = useCallback(({ direction, deltaY }: { direction: 'up' | 'down'; deltaY: number }) => {
    if (!focused || screenReaderEnabled || moreOpen || audioOpen || infoOpen || journalOpen || Math.abs(deltaY) < 12) return;
    setToolsVisible(direction === 'up');
  }, [focused, screenReaderEnabled, moreOpen, audioOpen, infoOpen, journalOpen]);
  const openMore = useCallback(() => { setMoreOpen(true); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeMore = useCallback(() => { setMoreOpen(false); showTools(); }, [showTools]);
  const openAudio = useCallback(() => { setAudioOpen(true); setMoreOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeAudio = useCallback(() => { setAudioOpen(false); showTools(); }, [showTools]);
  const openInfo = useCallback(() => { setInfoOpen(true); setMoreOpen(false); setAudioOpen(false); showTools(); }, [showTools]);
  const closeInfo = useCallback(() => { setInfoOpen(false); showTools(); }, [showTools]);
  const openJournal = useCallback(() => { setJournalOpen(true); setMoreOpen(false); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeJournal = useCallback(() => { setJournalOpen(false); showTools(); }, [showTools]);
  return { focused, toolsVisible: focused && toolsVisible, screenReaderEnabled, moreOpen, audioOpen, infoOpen, journalOpen, toggleTools, hideTools, showTools, handleCanvasScroll,
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
  selectedDate: string;
  previousDate?: string;
  nextDate?: string;
  onSelectDate: (date: string) => void;
  completed?: boolean;
  completionDisabled?: boolean;
  completionPending?: boolean;
  completionFailed?: boolean;
  completionLabel?: string;
  onComplete?: () => void;
  onUndo?: () => void;
  noPlanMessage?: string;
  statusMessage?: string;
  canOpenYouVersion?: boolean;
  onOpenYouVersion?: () => void;
  versionOptions?: Array<{ versionId: number; translationName: string; languageTag: string }>;
  onSelectVersion?: (versionId: number) => void | Promise<void>;
  metadata: { translationName: string; publisher: string; copyrightNotice: string; officialUrl: string; audioAttribution?: string } | null;
  /** Rendered beside the reader, never above it, so typing does not repaint the chapter. */
  journal?: ReactNode;
  accountEntry?: ReactNode;
  loginGate?: ReactNode;
  updateBanner?: ReactNode;
  narrationSpeed?: number;
  onSelectNarrationSpeed?: (speed: number) => void;
}
export function FullscreenReaderLayout({ reader, controls, chrome, chapterUsfm, versionId, references, onSelectReference, selectedDate, previousDate, nextDate, onSelectDate, completed = false, completionDisabled = false, completionPending = false, completionFailed = false, completionLabel, onComplete, onUndo, noPlanMessage, statusMessage, canOpenYouVersion = false, onOpenYouVersion, versionOptions, onSelectVersion, metadata, journal, accountEntry, loginGate, updateBanner, narrationSpeed = 1, onSelectNarrationSpeed }: FullscreenReaderLayoutProps) {
  const insets = useSafeAreaInsets();
  const [versionPageOpen, setVersionPageOpen] = useState(false);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const audioControlRef = useRef<ChapterAudioControlsHandle | null>(null);
  const curatedVersions = versionOptions !== undefined && onSelectVersion !== undefined;
  useEffect(() => { if (!chrome.moreOpen) setVersionPageOpen(false); }, [chrome.moreOpen]);
  useEffect(() => {
    if (!chrome.focused) return;
    return () => NavigationBar.setHidden(false);
  }, [chrome.focused]);
  const closeVersionPage = () => { setVersionPageOpen(false); chrome.closeMore(); };
  const openOfficial = (open: () => void) => { setChapterPickerOpen(false); chrome.closeMore(); open(); };
  const openYouVersion = () => {
    if (!canOpenYouVersion || !onOpenYouVersion) return;
    const launch = () => openOfficial(onOpenYouVersion);
    if (!audioControlRef.current) { launch(); return; }
    void audioControlRef.current.pause().then(launch).catch(() => Alert.alert('朗讀', '暫停朗讀失敗，請再試一次。'));
  };
  const chapterTitle = formatChapterTitleZhTw(chapterUsfm) || '選擇章節';
  const completeLabel = completionPending ? '同步中' : completionFailed ? '重試同步' : completed ? '已完成' : completionLabel ?? '完成讀經';
  const openDailyChapterPicker = () => {
    chrome.showTools();
    if (references.length > 0) setChapterPickerOpen(true);
    else openOfficial(controls.openChapterPicker);
  };
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
        <View style={styles.topRow} onTouchStart={chrome.showTools}>
          <View style={styles.dateControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一個排定讀經日" disabled={!previousDate} onPress={() => previousDate && onSelectDate(previousDate)} style={styles.dateStep}>
              <MaterialCommunityIcons name="chevron-left" size={22} color={previousDate ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
            <Text accessibilityLabel={'讀經日期' + selectedDate} style={styles.dateText}>{formatReadingDateLabel(selectedDate)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="下一個排定讀經日" disabled={!nextDate} onPress={() => nextDate && onSelectDate(nextDate)} style={styles.dateStep}>
              <MaterialCommunityIcons name="chevron-right" size={22} color={nextDate ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="選擇今日章節" onPress={openDailyChapterPicker} style={styles.chapterButton}>
            <Text accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={styles.titleText}>{chapterTitle}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={theme.colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="更多閱讀工具" onPress={chrome.openMore} style={styles.iconButton}>
            <MaterialCommunityIcons name="dots-horizontal" size={24} color={theme.colors.ink} />
          </Pressable>
        </View>
      </SafeAreaView>
      {noPlanMessage ? <Text accessibilityRole="text" style={styles.statusBanner}>{noPlanMessage}</Text> : null}
      <ChapterAudioAutoplayNotice active={chrome.focused} />
      <View style={[styles.reader, { paddingTop: 0, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]} onTouchEnd={controls.ready ? undefined : chrome.toggleTools}>{reader}</View>
      {journal}
      <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityLabel="讀經控制列" style={styles.playerBarSurface}>
        {statusMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusBanner}>{statusMessage}</Text> : null}
        <View style={chrome.toolsVisible ? styles.playerBar : styles.collapsedRow}>
          <View style={chrome.toolsVisible ? styles.bottomActionSlot : styles.collapsedEmptySlot}>
            {chrome.toolsVisible ? <Pressable accessibilityRole="button" accessibilityLabel="靈修日記" onPress={chrome.openJournal} style={styles.bottomAction}>
              <MaterialCommunityIcons name="notebook-edit-outline" size={21} color={theme.colors.ink} />
              <Text style={styles.bottomActionLabel}>日記</Text>
            </Pressable> : null}
          </View>
          <View style={chrome.toolsVisible ? styles.bottomAudioCell : styles.collapsedAudioCell}>
            <ChapterAudioControls ref={audioControlRef} chapterUsfm={chapterUsfm} versionId={versionId} translationName={metadata?.translationName} bottomCell active={chrome.focused} />
          </View>
          <View style={chrome.toolsVisible ? styles.bottomActionSlot : styles.collapsedRestoreSlot}>
            {chrome.toolsVisible ? <Pressable accessibilityRole="button" accessibilityLabel={completionFailed ? '同步失敗，重試同步' : completeLabel} accessibilityState={{ disabled: completionDisabled, busy: completionPending }} disabled={completionDisabled} onPress={completionFailed ? onComplete : completed ? onUndo : onComplete} style={[styles.bottomAction, completionDisabled && styles.disabled]}>
              <MaterialCommunityIcons name={completed ? 'check-circle' : completionFailed ? 'sync-alert' : 'check-circle-outline'} size={21} color={completed ? theme.colors.primary : theme.colors.ink} />
              <Text style={[styles.bottomActionLabel, completed && styles.completedLabel]}>{completeLabel}</Text>
            </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="顯示閱讀工具" onPress={chrome.showTools} style={styles.showToolsButton}>
              <MaterialCommunityIcons name="chevron-up" size={20} color={theme.colors.primary} />
              <Text style={styles.bottomActionLabel}>顯示</Text>
            </Pressable>}
          </View>
        </View>
      </SafeAreaView>
      <Modal transparent animationType="fade" visible={chapterPickerOpen} onRequestClose={() => { setChapterPickerOpen(false); chrome.showTools(); }}>
        {chapterPickerOpen && <Pressable accessibilityRole="button" accessibilityLabel="關閉今日章節選單" onPress={() => { setChapterPickerOpen(false); chrome.showTools(); }} style={styles.scrim}><Pressable onPress={() => undefined} style={styles.sheetHost}><SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']} accessibilityViewIsModal>
          <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.heading}>今日讀經章節</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={() => { setChapterPickerOpen(false); chrome.showTools(); }} style={styles.iconButton}><Text style={styles.close}>關閉</Text></Pressable></View>
          <ScrollView style={styles.menuScroller} contentContainerStyle={styles.menuContent}>
            {references.map((reference, index) => {
              const selected = isChapterInDailyReference(chapterUsfm, reference);
              return <Pressable key={index + ':' + reference} accessibilityRole="button" accessibilityLabel={'前往' + formatReferenceListZhTw([reference])} accessibilityState={{ selected }} onPress={() => { onSelectReference(index); setChapterPickerOpen(false); }} style={[styles.dailyReferenceOption, selected && styles.dailyReferenceSelected]}>
                <Text style={[styles.dailyReferenceLabel, selected && styles.dailyReferenceLabelSelected]}>{formatReferenceListZhTw([reference])}</Text>
              </Pressable>;
            })}
          </ScrollView>
        </SafeAreaView></Pressable></Pressable>}
      </Modal>
      <Modal transparent animationType="fade" visible={chrome.moreOpen} onRequestClose={versionPageOpen ? () => setVersionPageOpen(false) : chrome.closeMore}>
        {chrome.moreOpen && <Pressable accessibilityRole="button" accessibilityLabel="關閉更多閱讀工具" onPress={versionPageOpen ? () => setVersionPageOpen(false) : chrome.closeMore} style={styles.scrim}><Pressable onPress={() => undefined} style={styles.sheetHost}><SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']} accessibilityViewIsModal>
          {versionPageOpen && curatedVersions ? <CuratedVersionChoices options={versionOptions} versionId={versionId} onSelect={onSelectVersion} onBack={() => setVersionPageOpen(false)} onClose={closeVersionPage} /> : <>
          <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.heading}>更多閱讀工具</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={chrome.closeMore} style={styles.iconButton}><Text style={styles.close}>關閉</Text></Pressable></View>
          <ScrollView style={styles.menuScroller} contentContainerStyle={styles.menuContent}>
            <MenuButton label="選擇譯本" disabled={!curatedVersions && !controls.ready} onPress={() => curatedVersions ? setVersionPageOpen(true) : openOfficial(controls.openVersionPicker)} />
            <MenuButton label="調整字體" disabled={!controls.ready} onPress={() => openOfficial(controls.openSettings)} />
            <MenuButton label="選擇其他章節" disabled={!controls.ready} onPress={() => openOfficial(controls.openChapterPicker)} />
            <MenuButton label="在 YouVersion 開啟此章" disabled={!canOpenYouVersion || !onOpenYouVersion} onPress={openYouVersion} />
            <ChapterAudioAutoplayToggle active={chrome.focused} />
            <Text accessibilityRole="header" style={styles.heading}>連讀是什麼？</Text>
            <Text style={styles.body}>開啟連讀後，按播放會從目前章節依序朗讀當日剩餘章節，最後一章結束就停止。這不是加快語速。</Text>
            <Text style={styles.body}>切換設定不會立即播放。遇到沒有朗讀的章節會停下並提示。</Text>
            {onSelectNarrationSpeed ? <>
              <Text accessibilityRole="header" style={styles.heading}>朗讀速度</Text>
              <View style={styles.speedRow}>
                {READER_SPEEDS.map((speed) => {
                  const selected = speed === narrationSpeed;
                  return <Pressable key={speed} accessibilityRole="button" accessibilityLabel={'朗讀速度 ' + speed + ' 倍'} accessibilityState={{ selected }} onPress={() => onSelectNarrationSpeed(speed)} style={[styles.speedChoice, selected && styles.speedChoiceSelected]}>
                    <Text style={[styles.speedLabel, selected && styles.speedLabelSelected]}>{String(speed) + 'x'}</Text>
                  </Pressable>;
                })}
              </View>
            </> : null}
            {accountEntry}
            {loginGate}
            {updateBanner}
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
  topRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm },
  dateControls: { flexDirection: 'row', flexShrink: 0, alignItems: 'center' },
  dateStep: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  dateText: { width: 42, color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '700', textAlign: 'center' },
  chapterButton: { flex: 1, minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xs },
  titleText: { flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  playerBarSurface: { backgroundColor: theme.colors.surface, flexShrink: 0, borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, minHeight: 48 },
  bottomActionSlot: { flex: 1, minWidth: 0 },
  bottomAction: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xxs, borderWidth: theme.control.hairline, borderColor: theme.colors.border, borderRadius: theme.radius.button, backgroundColor: theme.colors.surface },
  bottomActionLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  completedLabel: { color: theme.colors.primary },
  bottomAudioCell: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'stretch', justifyContent: 'center' },
  collapsedRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm },
  collapsedEmptySlot: { width: 0, height: 0, overflow: 'hidden' },
  collapsedAudioCell: { width: 112, minHeight: 48, alignItems: 'stretch', justifyContent: 'center' },
  collapsedRestoreSlot: { width: 72, minHeight: 48, alignItems: 'stretch', justifyContent: 'center' },
  showToolsButton: { width: 72, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xxs },
  statusBanner: { color: theme.colors.muted, backgroundColor: theme.colors.surfaceMuted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  dailyReferenceOption: { minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  dailyReferenceSelected: { backgroundColor: theme.colors.primarySoft },
  dailyReferenceLabel: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  dailyReferenceLabelSelected: { color: theme.colors.primary, fontWeight: '800' },
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
