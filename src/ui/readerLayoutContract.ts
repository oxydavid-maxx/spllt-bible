// Scripture floor, in dp. The reader budget rule is that App chrome is charged against scripture,
// but RC14m had it backwards: the controls region held a guaranteed maxHeight of 420 dp while the
// scripture viewport declared a floor of 0. Measured on device at density 420 that produced a 319 dp
// scripture viewport under a 420 dp control panel, and the control panel still clipped its own tail.
// The floor is what scripture is owed; the controls take what is left and no more.
export const READER_SCRIPTURE_FLOOR_DP = 240;

/**
 * Review 121 C7. A floor alone did NOT produce immersive reading.
 *
 * 使用者 installed the preview and reported 還是沒有沉浸式閱讀. His screenshots show why: the scripture
 * viewport held only its 240 dp floor while the controls region, capped at null, expanded to fit every
 * permanent card. Measured off Photo 2, scripture occupied roughly a sixth of the screen and the
 * always-on cards below it roughly half. Both children were flexible, so the one with more content won.
 *
 * Scripture is no longer merely floored, it is given the majority SHARE, and the controls region is
 * bounded by a fraction of the reader area rather than by nothing. This is deliberately a ratio and not
 * the old fixed 420 dp cap, which was the RC14m defect: a fixed cap clips the App's own required
 * content, while a ratio shrinks with the screen and scrolls internally beyond it.
 */
export const READER_CONTROLS_MAX_SHARE = 0.38;

/** Secondary detail is available on demand; it does not get to hold the screen by default. */
export const READER_SECONDARY_COLLAPSED_BY_DEFAULT = true;

export function buildReaderLayoutModel(input: { taskDate: string; references: string[] }) {
  return {
    outerScrollEnabled: false,
    readerFlexHeight: true,
    readerViewportMinHeight: READER_SCRIPTURE_FLOOR_DP,
    /** scripture takes the remaining height; it is the dominant child, not a floored one */
    readerFlexGrow: 1,
    /**
     * null was the previous value and it is what let the controls out-grow scripture. The controls
     * region now may not exceed this share of the reader area, and scrolls internally past it.
     */
    controlsMaxHeightDp: null,
    controlsMaxShare: READER_CONTROLS_MAX_SHARE,
    /** version / copyright / content-status / official-link detail starts collapsed (C7) */
    secondaryDetailsCollapsed: READER_SECONDARY_COLLAPSED_BY_DEFAULT,
    /**
     * Review 121 C7 safe area. Nothing in the App used react-native-safe-area-context, so the reader
     * header drew under the Android status bar and the completion button sat under the navigation bar -
     * both visible in the screenshots. The reader declares the edges it must inset.
     */
    safeAreaEdges: ['top', 'bottom'] as const,
    bottomTabsHidden: true,
    controlsScrollEnabled: true,
    diagnosticsInReader: false,
    attributionMode: 'compact' as const,
    completionReachable: true,
    completionDate: input.taskDate,
    canReturnToAssigned: input.references.length > 0,
  } as const;
}

export function buildReaderCompletionLabel(taskDate: string, status: 'COMPLETED' | 'NOT_COMPLETED' | 'UNREPORTED'): string {
  const displayDate = taskDate.replaceAll('-', '/');
  return status === 'COMPLETED' ? `撤銷${displayDate}完成確認` : `完成所選日期讀經（${displayDate}）`;
}
