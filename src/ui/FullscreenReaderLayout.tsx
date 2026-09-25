import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, BackHandler, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls, type ChapterAudioControlsHandle } from './ChapterAudioControls';
import { formatChapterTitleZhTw, formatReferenceZhTw } from '../domain/scriptureReference';
import { theme } from './Theme';
import { formatReadingDateHeader, formatReadingDateLabel } from './ReadingDateNavigator';
import { setReaderImmersed } from './readerImmersionState';
import type { ReaderOverlayControls } from './YouVersionReader';
import type { ReaderCanvasInsets, ReaderRevealReason } from './readerSettingsBridge';
import { READER_SPEEDS } from '../services/readerSpeedPreference';
import { taipeiDate } from '../domain/gamificationV1';

// Layout A (docs/design/reader-page.md §5, §5.1), in dp. Every tool floats over the scripture, so the
// reader never changes size between normal and collapsed; the canvas keeps room under the tools.
const ROW = 48; // header date row, chapter chips row, collapsed bar
const TAB_BAR = 49; // bottom tabs above the system inset (expo-router's tab bar height)
const ACTION = 56; // ○ and ▶
const GAP = 12;
const CARD_ROOM = 64; // chapter-end card above ○ ▶

/** Room the scripture keeps under the overlays, from insets taken with the system bars showing. */
export function readerCanvasInsets(insets: { top: number; bottom: number }): ReaderCanvasInsets {
  return {
    top: Math.round(insets.top + ROW * 2 + GAP),
    bottom: Math.round(TAB_BAR + insets.bottom + GAP + ACTION + GAP + CARD_ROOM),
  };
}

export function useReaderChrome() {
  const liveInsets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(true);
  const [atChapterEnd, setAtChapterEnd] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const collapsed = focused && !toolsVisible;
  // Hiding the system bars while collapsed shrinks the live insets, and they grow back a few frames
  // after the tools reappear. ▶ and the scripture keep the largest insets seen with the tools showing
  // (the app is portrait-only): a smaller inset would move ▶, and a changed canvas inset changes the
  // reader page script, which makes the WebView reload the page back to the chapter top.
  const settled = useRef(liveInsets);
  if (!collapsed) {
    const kept = settled.current;
    if (liveInsets.top > kept.top || liveInsets.bottom > kept.bottom || liveInsets.left > kept.left || liveInsets.right > kept.right) {
      settled.current = { top: Math.max(kept.top, liveInsets.top), bottom: Math.max(kept.bottom, liveInsets.bottom), left: Math.max(kept.left, liveInsets.left), right: Math.max(kept.right, liveInsets.right) };
    }
  }
  // The reader's messages arrive through stable callbacks; they read the latest guards from here.
  const guards = useRef({ focused, screenReaderEnabled, popupOpen: false });
  guards.current = { focused, screenReaderEnabled, popupOpen: moreOpen || audioOpen || infoOpen };
  useEffect(() => {
    let active = true;
    let latestEvent: boolean | null = null;
    const applyScreenReaderState = (enabled: boolean) => {
      if (!active) return;
      setScreenReaderEnabled(enabled);
      if (enabled) {
        setToolsVisible(true);
        setReaderImmersed(false);
      }
    };
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', enabled => {
      latestEvent = enabled;
      applyScreenReaderState(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => applyScreenReaderState(latestEvent ?? enabled)).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    setToolsVisible(true);
    setReaderImmersed(false);
    return () => {
      setFocused(false);
      setToolsVisible(true);
      setReaderImmersed(false);
      setMoreOpen(false);
      setAudioOpen(false);
      setInfoOpen(false);
    };
  }, []));

  const showTools = useCallback(() => { setToolsVisible(true); setReaderImmersed(false); }, []);
  const hideTools = useCallback(() => {
    const { focused: isFocused, screenReaderEnabled: talkBack, popupOpen } = guards.current;
    if (!isFocused || talkBack || popupOpen) return;
    setToolsVisible(false);
    setReaderImmersed(true);
  }, []);
  const revealTools = useCallback((_reason?: ReaderRevealReason) => showTools(), [showTools]);
  const handleCanvasScroll = useCallback(({ direction, deltaY }: { direction: 'up' | 'down'; deltaY: number }) => {
    if (Math.abs(deltaY) < 12) return;
    if (direction === 'down') hideTools();
    else showTools();
  }, [hideTools, showTools]);
  const handleCanvasEdge = useCallback(({ atEnd }: { atEnd: boolean }) => setAtChapterEnd(atEnd), []);
  // Collapsed, Back brings the tools back and stays on the page (YouVersion). Visible, Back is untouched.
  useEffect(() => {
    if (!collapsed) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { showTools(); return true; });
    return () => subscription.remove();
  }, [collapsed, showTools]);
  const openMore = useCallback(() => { setMoreOpen(true); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeMore = useCallback(() => { setMoreOpen(false); showTools(); }, [showTools]);
  const openAudio = useCallback(() => { setAudioOpen(true); setMoreOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeAudio = useCallback(() => { setAudioOpen(false); showTools(); }, [showTools]);
  const openInfo = useCallback(() => { setInfoOpen(true); setMoreOpen(false); setAudioOpen(false); showTools(); }, [showTools]);
  const closeInfo = useCallback(() => { setInfoOpen(false); showTools(); }, [showTools]);
  return { focused, toolsVisible: focused && toolsVisible, collapsed, atChapterEnd, settledInsets: settled.current, screenReaderEnabled, moreOpen, audioOpen, infoOpen,
    hideTools, showTools, revealTools, handleCanvasScroll, handleCanvasEdge, openMore, closeMore, openAudio, closeAudio, openInfo, closeInfo };
}
export interface FullscreenReaderLayoutProps {
  reader: ReactNode;
  controls: ReaderOverlayControls;
  chrome: ReturnType<typeof useReaderChrome>;
  audioOwnerActive?: boolean;
  selectionSource?: 'ASSIGNED' | 'FREE';
  activeReferenceIndex?: number;
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
  completionFeedback?: ReactNode;
  onComplete?: () => void;
  onUndo?: () => void;
  noPlanMessage?: string;
  statusMessage?: string;
  canOpenYouVersion?: boolean;
  onOpenYouVersion?: () => void;
  versionOptions?: Array<{ versionId: number; translationName: string; languageTag: string }>;
  onSelectVersion?: (versionId: number) => void | Promise<void>;
  metadata: { translationName: string; publisher: string; copyrightNotice: string; officialUrl: string; audioAttribution?: string } | null;
  accountEntry?: ReactNode;
  loginGate?: ReactNode;
  updateBanner?: ReactNode;
  narrationSpeed?: number;
  onSelectNarrationSpeed?: (speed: number) => void;
}
export function FullscreenReaderLayout({ reader, controls, chrome, audioOwnerActive = chrome.focused, selectionSource = 'ASSIGNED', activeReferenceIndex = 0, chapterUsfm, versionId, references, onSelectReference, selectedDate, previousDate, nextDate, onSelectDate, completed = false, completionDisabled = false, completionPending = false, completionFailed = false, completionLabel, completionFeedback, onComplete, onUndo, noPlanMessage, statusMessage, canOpenYouVersion = false, onOpenYouVersion, versionOptions, onSelectVersion, metadata, accountEntry, loginGate, updateBanner, narrationSpeed = 1, onSelectNarrationSpeed }: FullscreenReaderLayoutProps) {
  const insets = chrome.settledInsets;
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [versionPageOpen, setVersionPageOpen] = useState(false);
  const audioControlRef = useRef<ChapterAudioControlsHandle | null>(null);
  const curatedVersions = versionOptions !== undefined && onSelectVersion !== undefined;
  const { handleCanvasEdge } = chrome;
  useEffect(() => { if (!chrome.moreOpen) setVersionPageOpen(false); }, [chrome.moreOpen]);
  useEffect(() => {
    if (!chrome.focused) return;
    return () => NavigationBar.setHidden(false);
  }, [chrome.focused]);
  // A new chapter starts away from its end; the reader reports the end again once its text is laid out.
  useEffect(() => { handleCanvasEdge({ atEnd: false }); }, [chapterUsfm, handleCanvasEdge]);
  const closeVersionPage = () => { setVersionPageOpen(false); chrome.closeMore(); };
  const openOfficial = (open: () => void) => { chrome.closeMore(); open(); };
  const openYouVersion = () => {
    if (!canOpenYouVersion || !onOpenYouVersion) return;
    const launch = () => openOfficial(onOpenYouVersion);
    if (!audioControlRef.current) { launch(); return; }
    void audioControlRef.current.pause().then(launch).catch(() => Alert.alert('朗讀', '暫停朗讀失敗，請再試一次。'));
  };
  const chapterTitle = formatChapterTitleZhTw(chapterUsfm) || '選擇章節';
  const selectedDateHeader = formatReadingDateHeader(selectedDate, taipeiDate());
  const widestAdjacentDate = Math.max(formatReadingDateLabel(previousDate ?? '').length, formatReadingDateLabel(nextDate ?? '').length);
  const adjacentDateTextWidth = widestAdjacentDate * theme.type.caption.size * fontScale * 0.56;
  const nextDateControlWidth = Math.max(theme.control.tap, adjacentDateTextWidth + 18 + theme.spacing.xxs * 2);
  const headerColumnWidth = (windowWidth - insets.left - insets.right - theme.spacing.xxs * 4) / 3;
  const showAdjacentDateLabels = headerColumnWidth >= theme.control.tap + nextDateControlWidth;
  const completionAccessibilityLabel = completionFailed ? '同步失敗，重試同步' : completionPending ? '同步中' : completed ? '已完成，可撤銷完成確認' : completionDisabled ? completionLabel ?? '目前無法完成' : '完成讀經';
  const completionActionDisabled = completionDisabled || completionPending;
  const assignedIndex = selectionSource === 'ASSIGNED' && references.length > 0
    ? Math.max(0, Math.min(activeReferenceIndex, references.length - 1))
    : -1;
  const nextIndex = assignedIndex >= 0 && assignedIndex < references.length - 1 ? assignedIndex + 1 : -1;
  const atEnd = !chrome.collapsed && chrome.atChapterEnd;
  // The last chapter read to its end: the same ○ grows into the day's completion call (one button, one record).
  const completionExpanded = atEnd && assignedIndex >= 0 && nextIndex < 0 && !completed && !completionActionDisabled && !completionFailed;
  const nextReference = atEnd && nextIndex >= 0 ? references[nextIndex] : undefined;
  const currentChipLabel = assignedIndex >= 0 ? formatReferenceZhTw(references[assignedIndex]) : `自由 ${formatReferenceZhTw(chapterUsfm)}`;
  const actionBottom = TAB_BAR + insets.bottom + GAP;
  const aboveActions = actionBottom + ACTION + GAP;
  const collapsedGroupWidth = Math.floor(windowWidth * 0.4) - theme.spacing.lg;
  const openChapterPicker = () => { if (controls.ready) openOfficial(controls.openChapterPicker); };
  const continueReading = () => {
    if (nextIndex < 0) return;
    handleCanvasEdge({ atEnd: false });
    onSelectReference(nextIndex);
  };
  const feedback = isValidElement<{ bottomOffset?: number }>(completionFeedback) ? cloneElement(completionFeedback, { bottomOffset: aboveActions }) : completionFeedback;
  return (
    <View style={styles.root}>
      {chrome.focused && <><StatusBar hidden={chrome.collapsed} style="dark" /><NavigationBar hidden={chrome.collapsed} style="dark" /></>}
      <View accessibilityLabel="經文" style={[styles.surface, { paddingLeft: insets.left, paddingRight: insets.right }, !controls.ready && { paddingTop: insets.top + ROW * 2, paddingBottom: aboveActions }]}>{reader}</View>
      {chrome.collapsed ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="展開閱讀工具"
        accessibilityHint={assignedIndex >= 0 ? `目前${chapterTitle}，今日第${assignedIndex + 1}段，共${references.length}段` : `目前自由閱讀${chapterTitle}`}
        onPress={chrome.showTools}
        style={[styles.collapsedBar, { paddingLeft: theme.spacing.lg + insets.left, paddingRight: theme.spacing.xs + insets.right }]}
      >
        <View style={[styles.collapsedGroup, { maxWidth: collapsedGroupWidth }]}>
          <View style={styles.collapsedChip}><Text numberOfLines={1} style={styles.collapsedChipText}>{currentChipLabel}</Text></View>
          {assignedIndex >= 0 ? <>
            <View style={styles.segments}>{references.map((reference, index) => <View key={`${index}:${reference}`} style={[styles.segment, index === assignedIndex && styles.segmentOn]} />)}</View>
            <Text numberOfLines={1} style={styles.collapsedPosition}>{`${assignedIndex + 1}/${references.length}`}</Text>
          </> : null}
        </View>
        <View style={styles.collapsedExpand}><MaterialCommunityIcons name="chevron-down" size={26} color={theme.colors.muted} /></View>
      </Pressable> : <SafeAreaView edges={['top', 'left', 'right']} accessibilityLabel="閱讀工具列" style={styles.header}>
        <View accessibilityLabel="閱讀日期工具列" style={styles.dateRow}>
          <View style={styles.headerSide}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一個排定讀經日" accessibilityHint={previousDate ? `前往${formatReadingDateLabel(previousDate)}` : undefined} disabled={!previousDate} onPress={() => previousDate && onSelectDate(previousDate)} style={[styles.dateStep, !previousDate && styles.disabled]}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={previousDate ? theme.colors.primary : theme.colors.muted} />
              {previousDate && showAdjacentDateLabels ? <Text numberOfLines={1} style={styles.sideDateText}>{formatReadingDateLabel(previousDate)}</Text> : null}
            </Pressable>
          </View>
          <Text accessibilityRole="header" accessibilityLabel={`目前閱讀日期${selectedDateHeader}`} numberOfLines={1} ellipsizeMode="tail" style={styles.dateTitle}>{selectedDateHeader}</Text>
          <View style={[styles.headerSide, styles.trailingSide]}>
            <Pressable accessibilityRole="button" accessibilityLabel="下一個排定讀經日" accessibilityHint={nextDate ? `前往${formatReadingDateLabel(nextDate)}` : undefined} disabled={!nextDate} onPress={() => nextDate && onSelectDate(nextDate)} style={[styles.dateStep, styles.nextDateStep, !nextDate && styles.disabled]}>
              {nextDate && showAdjacentDateLabels ? <Text numberOfLines={1} style={styles.sideDateText}>{formatReadingDateLabel(nextDate)}</Text> : null}
              <MaterialCommunityIcons name="chevron-right" size={18} color={nextDate ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
          </View>
        </View>
        <View accessibilityLabel="今日讀經章節" style={styles.chipsRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroller} contentContainerStyle={styles.chipsContent}>
            {assignedIndex < 0 ? <ReaderChip label={currentChipLabel} accessibilityLabel={`自由閱讀：${chapterTitle}`} accessibilityHint="選擇其他章節" selected onPress={openChapterPicker} /> : null}
            {references.map((reference, index) => {
              const selected = index === assignedIndex;
              return <ReaderChip
                key={`${index}:${reference}`}
                label={formatReferenceZhTw(reference)}
                accessibilityLabel={`${formatChapterTitleZhTw(reference)}，今日第${index + 1}段，共${references.length}段`}
                accessibilityHint={selected ? '選擇其他章節' : undefined}
                selected={selected}
                onPress={selected ? openChapterPicker : () => onSelectReference(index)}
              />;
            })}
            {noPlanMessage ? <Text accessibilityRole="text" numberOfLines={2} style={styles.noPlanText}>{noPlanMessage}</Text> : null}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="更多閱讀工具" onPress={chrome.openMore} android_ripple={{ color: theme.colors.primarySoft }} style={styles.iconButton}>
            <MaterialCommunityIcons name="dots-horizontal" size={24} color={theme.colors.ink} />
          </Pressable>
        </View>
      </SafeAreaView>}
      <View pointerEvents="box-none" style={[styles.aboveActions, { left: theme.spacing.lg + insets.left, right: theme.spacing.lg + insets.right, bottom: aboveActions }]}>
        <ChapterAudioAutoplayNotice active={chrome.focused} />
        {statusMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusBanner}>{statusMessage}</Text> : null}
        {nextReference ? <Pressable accessibilityRole="button" accessibilityLabel={`繼續讀 ${formatChapterTitleZhTw(nextReference)}`} onPress={continueReading} android_ripple={{ color: theme.colors.primarySoft }} style={styles.nextCard}>
          <Text numberOfLines={1} style={styles.nextCardText}>{`繼續讀 ${formatReferenceZhTw(nextReference)} ›`}</Text>
        </Pressable> : null}
      </View>
      <View accessibilityLabel="讀經動作" accessible={false} pointerEvents="box-none" style={[styles.actionRow, { right: theme.spacing.sm + insets.right, bottom: actionBottom }]}>
        {chrome.collapsed ? null : <Pressable
          accessibilityRole="button"
          accessibilityLabel={completionAccessibilityLabel}
          accessibilityHint={completed ? '長按查看說明；點按可撤銷所選日期的完成確認' : '長按查看完成狀態說明'}
          accessibilityState={{ disabled: completionActionDisabled, busy: completionPending, checked: completed }}
          disabled={completionActionDisabled}
          onPress={completionFailed ? onComplete : completed ? onUndo : onComplete}
          onLongPress={() => Alert.alert('讀經完成狀態', completed ? '已完成所選日期的讀經。點按可依確認流程撤銷。' : completionPending ? '完成記錄正在同步。同步成功前不會顯示加分。' : completionDisabled ? completionLabel ?? '目前無法完成此日期。' : '點按圓圈完成所選日期的讀經。')}
          android_ripple={{ color: theme.colors.primarySoft }}
          style={[styles.completionAction, completionExpanded && styles.completionExpanded, completed && styles.completionActionComplete, completionActionDisabled && styles.disabled]}
        >
          <MaterialCommunityIcons name={completionPending ? 'clock-outline' : completionFailed ? 'sync-alert' : completed ? 'check' : 'checkbox-blank-circle-outline'} size={completionExpanded ? 26 : 28} color={completed ? theme.colors.white : completionActionDisabled ? theme.colors.muted : theme.colors.primary} />
          {completionExpanded ? <Text style={styles.completionExpandedText}>完成今日讀經</Text> : null}
        </Pressable>}
        <View accessible={false} style={styles.audioCell}>
          <ChapterAudioControls ref={audioControlRef} chapterUsfm={chapterUsfm} versionId={versionId} translationName={metadata?.translationName} bottomCell={false} readerAction active={audioOwnerActive} sharedOwner />
        </View>
      </View>
      {feedback}
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

function ReaderChip({ label, accessibilityLabel, accessibilityHint, selected, onPress }: { label: string; accessibilityLabel: string; accessibilityHint?: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} accessibilityState={{ selected }} onPress={onPress} style={styles.chipTouch}>
    <View style={[styles.chip, selected && styles.chipSelected]}><Text numberOfLines={1} style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></View>
  </Pressable>;
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

function MenuButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.menuButton, disabled && styles.disabled]}><Text style={styles.menuLabel}>{label}</Text></Pressable>;
}

const floating = { elevation: 4, shadowColor: '#15302A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 8 } as const;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  surface: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: theme.colors.surface, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  dateRow: { minHeight: ROW, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xxs },
  dateTitle: { flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  headerSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  trailingSide: { justifyContent: 'flex-end' },
  dateStep: { minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xxs },
  nextDateStep: { justifyContent: 'flex-end' },
  sideDateText: { color: theme.colors.primary, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  chipsRow: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingLeft: theme.spacing.sm, paddingRight: theme.spacing.xs },
  chipsScroller: { flex: 1, minWidth: 0 },
  chipsContent: { alignItems: 'center', gap: theme.spacing.sm },
  chipTouch: { minHeight: ROW, justifyContent: 'center' },
  chip: { height: 34, justifyContent: 'center', paddingHorizontal: theme.spacing.lg, borderRadius: 17, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.white },
  chipSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  chipText: { color: theme.colors.ink, fontSize: 16, lineHeight: 20, fontWeight: '700' },
  chipTextSelected: { color: theme.colors.white },
  noPlanText: { maxWidth: 240, color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  collapsedBar: { position: 'absolute', top: 0, left: 0, right: 0, height: ROW, zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.surface, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  collapsedGroup: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  collapsedChip: { flexShrink: 0, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.colors.primary },
  collapsedChipText: { color: theme.colors.white, fontSize: 14, lineHeight: 16, fontWeight: '700' },
  segments: { flexShrink: 1, minWidth: 0, flexDirection: 'row', gap: 3 },
  segment: { flexShrink: 1, width: 18, minWidth: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.border },
  segmentOn: { backgroundColor: theme.colors.primary },
  collapsedPosition: { flexShrink: 0, color: theme.colors.muted, fontSize: 13, lineHeight: 16, fontWeight: '600' },
  collapsedExpand: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  aboveActions: { position: 'absolute', zIndex: 3, gap: theme.spacing.sm },
  statusBanner: { alignSelf: 'flex-end', color: theme.colors.ink, backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.chip, overflow: 'hidden', fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  nextCard: { height: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.lg, borderRadius: 26, backgroundColor: theme.colors.primary, ...floating },
  nextCardText: { color: theme.colors.white, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  actionRow: { position: 'absolute', zIndex: 3, flexDirection: 'row', alignItems: 'center', gap: GAP },
  completionAction: { width: ACTION, height: ACTION, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: ACTION / 2, backgroundColor: theme.colors.white, ...floating },
  completionExpanded: { width: 'auto', paddingLeft: theme.spacing.lg, paddingRight: theme.spacing.xl },
  completionActionComplete: { backgroundColor: theme.colors.primary },
  completionExpandedText: { color: theme.colors.primary, fontSize: 16, lineHeight: 20, fontWeight: '700' },
  audioCell: { width: ACTION, height: ACTION, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: ACTION / 2, backgroundColor: theme.colors.primary, ...floating },
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
