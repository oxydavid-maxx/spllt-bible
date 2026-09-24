import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls, type ChapterAudioControlsHandle } from './ChapterAudioControls';
import { bookAbbreviationZhTw, formatChapterTitleZhTw, formatDailyReferenceRangeZhTw, formatReferenceListZhTw } from '../domain/scriptureReference';
import { theme } from './Theme';
import { formatReadingDateHeader, formatReadingDateLabel } from './ReadingDateNavigator';
import { setReaderImmersed } from './readerImmersionState';
import type { ReaderOverlayControls } from './YouVersionReader';
import { READER_SPEEDS } from '../services/readerSpeedPreference';
import { taipeiDate } from '../domain/gamificationV1';

export function useReaderChrome() {
  const [focused, setFocused] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(true);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
    if (screenReaderEnabled || moreOpen || audioOpen || infoOpen) return;
    setToolsVisible(false);
    setReaderImmersed(true);
  }, [screenReaderEnabled, moreOpen, audioOpen, infoOpen]);
  const toggleTools = useCallback(() => {
    if (screenReaderEnabled || moreOpen || audioOpen || infoOpen) return;
    setToolsVisible(value => !value);
    setReaderImmersed(toolsVisible);
  }, [screenReaderEnabled, moreOpen, audioOpen, infoOpen, toolsVisible]);
  const handleCanvasScroll = useCallback(({ direction, deltaY }: { direction: 'up' | 'down'; deltaY: number }) => {
    if (!focused || screenReaderEnabled || moreOpen || audioOpen || infoOpen || Math.abs(deltaY) < 12) return;
    const show = direction === 'up';
    setToolsVisible(show);
    setReaderImmersed(!show);
  }, [focused, screenReaderEnabled, moreOpen, audioOpen, infoOpen]);
  const openMore = useCallback(() => { setMoreOpen(true); setAudioOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeMore = useCallback(() => { setMoreOpen(false); showTools(); }, [showTools]);
  const openAudio = useCallback(() => { setAudioOpen(true); setMoreOpen(false); setInfoOpen(false); showTools(); }, [showTools]);
  const closeAudio = useCallback(() => { setAudioOpen(false); showTools(); }, [showTools]);
  const openInfo = useCallback(() => { setInfoOpen(true); setMoreOpen(false); setAudioOpen(false); showTools(); }, [showTools]);
  const closeInfo = useCallback(() => { setInfoOpen(false); showTools(); }, [showTools]);
  return { focused, toolsVisible: focused && toolsVisible, screenReaderEnabled, moreOpen, audioOpen, infoOpen, toggleTools, hideTools, showTools, handleCanvasScroll,
    openMore, closeMore, openAudio, closeAudio, openInfo, closeInfo };
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
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
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
  const dailyRangeSummary = formatDailyReferenceRangeZhTw(references) || chapterTitle;
  const selectedDateHeader = formatReadingDateHeader(selectedDate, taipeiDate());
  const widestAdjacentDate = Math.max(formatReadingDateLabel(previousDate ?? '').length, formatReadingDateLabel(nextDate ?? '').length);
  const adjacentDateTextWidth = widestAdjacentDate * theme.type.caption.size * fontScale * 0.56;
  const nextDateControlWidth = Math.max(theme.control.tap, adjacentDateTextWidth + 18 + theme.spacing.xxs * 2);
  const headerColumnWidth = (windowWidth - insets.left - insets.right - theme.spacing.xxs * 4) / 3;
  const showAdjacentDateLabels = headerColumnWidth >= theme.control.tap + nextDateControlWidth;
  const completionAccessibilityLabel = completionFailed ? '同步失敗，重試同步' : completionPending ? '同步中' : completed ? '已完成，可撤銷完成確認' : completionDisabled ? completionLabel ?? '目前無法完成' : '完成讀經';
  const completionActionDisabled = completionDisabled || completionPending;
  const selectedReferenceIndex = selectionSource === 'ASSIGNED' && references.length > 0
    ? Math.max(0, Math.min(activeReferenceIndex, references.length - 1))
    : -1;
  const chapterPositionLabel = selectionSource === 'FREE'
    ? '自由閱讀'
    : references.length > 0 ? `${selectedReferenceIndex + 1}/${references.length}` : '自由閱讀';
  const chapterCapsuleLabel = selectionSource === 'FREE'
    ? `${chapterTitle}，自由閱讀`
    : `第${selectedReferenceIndex + 1}項，共${references.length}項，${chapterTitle}`;
  const openDailyChapterPicker = () => {
    chrome.showTools();
    if (references.length > 0) setChapterPickerOpen(true);
    else openOfficial(controls.openChapterPicker);
  };
  const moveReference = (delta: number) => {
    if (selectionSource !== 'ASSIGNED' || references.length === 0) return;
    const target = selectedReferenceIndex + delta;
    if (target >= 0 && target < references.length) onSelectReference(target);
  };
  return (
    <View style={styles.root}>
      {chrome.focused && <><StatusBar hidden style="dark" /><NavigationBar hidden style="dark" /></>}
      {chrome.toolsVisible ? <SafeAreaView edges={['top', 'left', 'right']} accessibilityLabel="閱讀工具列" style={styles.toolbarSurface}>
        <View style={styles.toolbarRows}>
        <View accessibilityLabel="閱讀日期工具列" style={styles.topRow} onTouchStart={chrome.showTools}>
          <View style={styles.headerSide}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一個排定讀經日" accessibilityHint={previousDate ? `前往${formatReadingDateLabel(previousDate)}` : undefined} disabled={!previousDate} onPress={() => previousDate && onSelectDate(previousDate)} style={[styles.dateStep, !previousDate && styles.disabled]}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={previousDate ? theme.colors.primary : theme.colors.muted} />
              {previousDate && showAdjacentDateLabels ? <Text numberOfLines={1} style={styles.sideDateText}>{formatReadingDateLabel(previousDate)}</Text> : null}
            </Pressable>
          </View>
          <Text accessibilityRole="header" accessibilityLabel={`目前閱讀日期${selectedDateHeader}`} numberOfLines={1} ellipsizeMode="tail" style={styles.selectedDateTitle}>{selectedDateHeader}</Text>
          <View style={[styles.headerSide, styles.trailingSide]}>
            <Pressable accessibilityRole="button" accessibilityLabel="下一個排定讀經日" accessibilityHint={nextDate ? `前往${formatReadingDateLabel(nextDate)}` : undefined} disabled={!nextDate} onPress={() => nextDate && onSelectDate(nextDate)} style={[styles.dateStep, styles.nextDateStep, !nextDate && styles.disabled]}>
              {nextDate && showAdjacentDateLabels ? <Text numberOfLines={1} style={styles.sideDateText}>{formatReadingDateLabel(nextDate)}</Text> : null}
              <MaterialCommunityIcons name="chevron-right" size={18} color={nextDate ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
          </View>
        </View>
        <View accessibilityLabel="今日讀經範圍" style={styles.rangeRow} onTouchStart={chrome.showTools}>
          <Text accessibilityRole="header" accessibilityLabel={`今日讀經範圍：${dailyRangeSummary}`} numberOfLines={1} ellipsizeMode="tail" style={styles.rangeTitle}>{dailyRangeSummary}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="更多閱讀工具" onPress={chrome.openMore} android_ripple={{ color: theme.colors.primarySoft }} style={styles.iconButton}>
            <MaterialCommunityIcons name="dots-horizontal" size={24} color={theme.colors.ink} />
          </Pressable>
        </View>
        </View>
      </SafeAreaView> : null}
      {noPlanMessage ? <Text accessibilityRole="text" style={styles.statusBanner}>{noPlanMessage}</Text> : null}
      <ChapterAudioAutoplayNotice active={chrome.focused} />
      <View style={[styles.reader, { paddingTop: chrome.toolsVisible ? 0 : insets.top, paddingBottom: chrome.toolsVisible ? insets.bottom : insets.bottom + 56, paddingLeft: insets.left, paddingRight: insets.right }]} onTouchEnd={controls.ready ? undefined : chrome.toggleTools}>{reader}</View>
      {chrome.toolsVisible ? <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityLabel="讀經控制列" style={styles.playerBarSurface}>
        {statusMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusBanner}>{statusMessage}</Text> : null}
        <View style={styles.playerBar}>
          <View style={styles.chapterCapsule}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一個讀經章節" accessibilityState={{ disabled: selectedReferenceIndex <= 0 }} disabled={selectedReferenceIndex <= 0} onPress={() => moveReference(-1)} android_ripple={{ color: theme.colors.primarySoft }} style={styles.capsuleArrow}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={selectedReferenceIndex > 0 ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="選擇今日章節清單" accessibilityHint={`目前${chapterCapsuleLabel}，開啟當日讀經清單`} onPress={openDailyChapterPicker} android_ripple={{ color: theme.colors.primarySoft }} style={styles.capsuleSelection}>
              <Text numberOfLines={1} style={styles.capsuleTitle}>{chapterTitle}</Text>
              <View style={styles.capsuleMeta}>
                <Text numberOfLines={1} style={selectionSource === 'FREE' ? styles.freeBrowseLabel : styles.capsulePosition}>{chapterPositionLabel}</Text>
                <MaterialCommunityIcons name="chevron-down" size={16} color={theme.colors.ink} />
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一個讀經章節" accessibilityState={{ disabled: selectedReferenceIndex < 0 || selectedReferenceIndex >= references.length - 1 }} disabled={selectedReferenceIndex < 0 || selectedReferenceIndex >= references.length - 1} onPress={() => moveReference(1)} android_ripple={{ color: theme.colors.primarySoft }} style={styles.capsuleArrow}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={selectedReferenceIndex >= 0 && selectedReferenceIndex < references.length - 1 ? theme.colors.primary : theme.colors.muted} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={completionAccessibilityLabel}
            accessibilityHint={completed ? '長按查看說明；點按可撤銷所選日期的完成確認' : '長按查看完成狀態說明'}
            accessibilityState={{ disabled: completionActionDisabled, busy: completionPending, checked: completed }}
            disabled={completionActionDisabled}
            onPress={completionFailed ? onComplete : completed ? onUndo : onComplete}
            onLongPress={() => Alert.alert('讀經完成狀態', completed ? '已完成所選日期的讀經。點按可依確認流程撤銷。' : completionPending ? '完成記錄正在同步。同步成功前不會顯示加分。' : completionDisabled ? completionLabel ?? '目前無法完成此日期。' : '點按圓圈完成所選日期的讀經。')}
            android_ripple={{ color: theme.colors.primarySoft }}
            style={[styles.completionAction, completed && styles.completionActionComplete, completionActionDisabled && styles.disabled]}
          >
            <MaterialCommunityIcons name={completionPending ? 'clock-outline' : completionFailed ? 'sync-alert' : completed ? 'check' : 'checkbox-blank-circle-outline'} size={28} color={completed ? theme.colors.white : completionActionDisabled ? theme.colors.muted : theme.colors.primary} />
          </Pressable>
          <View accessible={false} style={styles.bottomAudioPlaceholder} />
        </View>
      </SafeAreaView> : statusMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.statusBanner}>{statusMessage}</Text> : null}
      <View
        accessibilityLabel={chrome.toolsVisible ? '讀經播放控制' : '沉浸播放控制'}
        accessible={false}
        pointerEvents="box-none"
        style={[styles.audioOverlay, { left: insets.left, right: insets.right, bottom: insets.bottom + (chrome.toolsVisible ? 0 : 8) }]}
      >
        <View accessible={false} pointerEvents="none" style={chrome.toolsVisible ? styles.audioLeadingSpacer : styles.audioOverlaySide} />
        <View accessible={false} pointerEvents="none" style={chrome.toolsVisible ? styles.audioCompletionSpacer : styles.audioHiddenSpacer} />
        <View accessible={false} style={styles.bottomAudioCell}>
          <ChapterAudioControls ref={audioControlRef} chapterUsfm={chapterUsfm} versionId={versionId} translationName={metadata?.translationName} bottomCell={false} readerAction active={audioOwnerActive} sharedOwner />
        </View>
        <View accessible={false} pointerEvents="none" style={chrome.toolsVisible ? styles.audioTrailingSpacer : styles.audioOverlaySide} />
      </View>
      {completionFeedback}
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
  toolbarRows: { flexDirection: 'column', flexShrink: 0 },
  topRow: { minHeight: 48, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xxs },
  selectedDateTitle: { flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800', textAlign: 'center' },
  rangeRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.xs },
  rangeTitle: { flex: 1, minWidth: 0, color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '700' },
  headerSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  trailingSide: { justifyContent: 'flex-end' },
  dateStep: { minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: theme.spacing.xxs, paddingHorizontal: theme.spacing.xxs },
  nextDateStep: { justifyContent: 'flex-end' },
  sideDateText: { color: theme.colors.primary, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  playerBarSurface: { backgroundColor: theme.colors.surface, flexShrink: 0, borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border },
  playerBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.sm, minHeight: 64, paddingVertical: theme.spacing.xs },
  chapterCapsule: { flex: 1, minWidth: 0, height: 56, flexDirection: 'row', alignItems: 'center', borderRadius: 28, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.white, elevation: 2, shadowColor: '#1B3B33', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 3 },
  capsuleArrow: { width: 48, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  capsuleSelection: { flex: 1, minWidth: 0, height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xxs },
  capsuleTitle: { maxWidth: '100%', color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '700', textAlign: 'center' },
  capsuleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  capsulePosition: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '600' },
  freeBrowseLabel: { color: theme.colors.primary, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '800' },
  completionAction: { width: 56, height: 56, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 28, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface },
  completionActionComplete: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  bottomAudioCell: { width: 56, height: 56, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  bottomAudioPlaceholder: { width: 56, height: 56, flexShrink: 0 },
  audioOverlay: { position: 'absolute', height: 56, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.sm, zIndex: 2 },
  audioLeadingSpacer: { flex: 1, minWidth: 0, height: 56 },
  audioCompletionSpacer: { width: 56, height: 56, flexShrink: 0 },
  audioHiddenSpacer: { width: 0, height: 56, flexShrink: 0 },
  audioTrailingSpacer: { width: 0, height: 56, flexShrink: 0 },
  audioOverlaySide: { flex: 1, minWidth: 0, height: 56 },
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
