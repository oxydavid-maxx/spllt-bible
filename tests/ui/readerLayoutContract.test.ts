import { describe, expect, it } from 'vitest';

import { buildReaderCompletionLabel, buildReaderLayoutModel } from '../../src/ui/readerLayoutContract';

describe('focused Reader layout contract', () => {
  it('keeps the official reader readable while exposing a reachable secondary control region', () => {
    expect(buildReaderLayoutModel({ taskDate: '2026-09-09', references: ['JHN.19', 'JHN.20'] })).toEqual({
      outerScrollEnabled: false,
      readerFlexHeight: true,
      readerViewportMinHeight: 240,
      controlsMaxHeightDp: null,
      bottomTabsHidden: true,
      controlsScrollEnabled: true,
      diagnosticsInReader: false,
      attributionMode: 'compact',
      completionReachable: true,
      completionDate: '2026-09-09',
      canReturnToAssigned: true,
      // Review 121 C7 additions
      readerFlexGrow: 1,
      controlsMaxShare: 0.38,
      secondaryDetailsCollapsed: true,
      safeAreaEdges: ['top', 'bottom'],
    });
  });

  // Review 121 C7. 使用者 installed the preview and said 還是沒有沉浸式閱讀. His screenshots show the
  // scripture viewport holding only its floor while the always-on cards below took roughly half the
  // screen. A floor alone never made scripture dominant, because BOTH children were flexible and the
  // one with more content won.
  it('gives scripture the dominant share instead of only a floor', () => {
    const m = buildReaderLayoutModel({ taskDate: '2026-09-12', references: ['PSA.90'] });
    expect(m.readerFlexGrow).toBe(1);
    expect(m.controlsMaxShare).toBeLessThan(0.5);
    expect(m.controlsMaxShare).toBeGreaterThan(0);
  });

  it('starts secondary version/source/completion detail collapsed', () => {
    expect(buildReaderLayoutModel({ taskDate: '2026-09-12', references: ['PSA.90'] }).secondaryDetailsCollapsed).toBe(true);
  });

  it('declares the safe-area edges the reader must inset', () => {
    // nothing in the App used react-native-safe-area-context, so the header drew under the status bar
    // and the completion button under the navigation bar - both visible in the screenshots
    expect(buildReaderLayoutModel({ taskDate: '2026-09-12', references: ['PSA.90'] }).safeAreaEdges)
      .toEqual(['top', 'bottom']);
  });

  it('never clips the App own required reader content behind a fixed cap', () => {
    // Measured on device, RC14m at density 420 (ledger acc-20260911T050642Z, CAP-UX02-entry.xml):
    // the controls ScrollView viewport was [42,1037][1038,2139] = 419.8 dp, exactly the maxHeight 420
    // cap, while its content ran to y=2378 and needed 511 dp. The entire chapter-audio block was
    // therefore dumped with INVERTED bounds (e.g. [76,2184][1004,2139], bottom above top) and was
    // never laid out, so no claim about it could pass the visibility rule. Raising the cap to another
    // magic number just moves the clip to whatever block is added next. The App's own required
    // content gets no fixed cap; scripture is protected by its own declared floor instead.
    const m = buildReaderLayoutModel({ taskDate: '2026-09-02', references: ['JHN.13', 'JHN.14'] });
    expect(m.controlsMaxHeightDp).toBeNull();
    expect(m.readerViewportMinHeight).toBeGreaterThan(0);
  });

  it('names completion for the selected canonical task date', () => {
    expect(buildReaderCompletionLabel('2026-09-09', 'UNREPORTED')).toBe('完成所選日期讀經（2026/09/09）');
    expect(buildReaderCompletionLabel('2026-09-09', 'COMPLETED')).toBe('撤銷2026/09/09完成確認');
  });
});
