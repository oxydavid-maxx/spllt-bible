// Qingmu youth design tokens — direction "經頁邊註 / Marginalia".
// The app chrome behaves like the ruled margin of a printed reading-plan sheet:
// quiet, dense, ruled. Scripture (official YouVersion renderer) is the page.
// Contrast evidence: uiux-lane/analysis/contrast-report.txt (WCAG 2.2 AA); both palettes are checked by
// scripts/check-contrast.ts (tests/ui/themeContrast.test.ts).
//
// Colours are not on `theme`: they follow 夜間模式 (docs/features/night-mode.md), so a screen reads them while it
// renders, through src/ui/useAppTheme.ts (makeStyles, useColors). A colour read when a file loads would stay
// light after the app turns dark; tests/tools/themeGuard.test.ts fails on that and on hard-coded colours.
export const theme = {
  // 4dp grid. lg (16) is the screen gutter, md (12) the section gap,
  // sm (8) the intra-card gap. Whitespace groups; it is never the default.
  spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radius: { card: 14, button: 12, chip: 10, pill: 999 },
  // One type scale, eight steps. Numbers carry the display weight; prose never does.
  type: {
    display: { size: 22, line: 30 },
    title: { size: 20, line: 28 },
    heading: { size: 17, line: 24 },
    body: { size: 15, line: 22 },
    label: { size: 14, line: 20 },
    caption: { size: 13, line: 18 },
    micro: { size: 12, line: 16 },
    metric: { size: 24, line: 30 },
  },
  // Touch: primary actions 48dp, secondary never below 44dp.
  // tapCompact was 44. On a 420dpi device 44dp rounds down to 43.8dp, so every control using it
  // measured BELOW even the 44dp floor: the date navigator, the reader's 指定經文 tabs, 下一段,
  // and 確認今日已完成讀經. 48 is the accessibility minimum, so a "compact" tap target smaller than
  // that is not a legitimate variant; the token stays for its 15 call sites but no longer undershoots.
  control: { tap: 48, tapCompact: 48, cta: 52, rail: 3, hairline: 1 },
} as const;

export type ColorScheme = 'light' | 'dark';

export const lightColors = {
  // paper + surfaces. background is deeper than RC13 #F4F7F3 so white cards read
  // as cards without spending extra whitespace to separate them.
  background: '#EDF1EA',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F7F2',
  // The reader's page and its floating tools sit on the scripture itself: white like the page in light, and the
  // YouVersion reader's own dark page (#121212) in dark, so the tools never stand out as grey bands over it.
  readerSurface: '#FFFFFF',
  // ink
  ink: '#15302A', // 14.11:1 on surface
  muted: '#4C5F57', // 6.81:1 on surface, 5.96:1 on background
  // evergreen = system and actions. Light uses one green for words and for filled buttons; dark needs a light
  // green for words and outlines and a deeper one under white words, so a screen names which one it means.
  primary: '#1A5544', // 8.65:1 on surface
  primaryFill: '#1A5544',
  primaryDeep: '#123B30', // the large numbers
  primaryDeepFill: '#123B30', // pinned completion bar; white text 12.40:1
  primarySoft: '#DAE8DE',
  // clay = "needs you": pending sync, undo, blocked permission
  accent: '#8A4A19', // 6.83:1 on surface
  accentFill: '#8A4A19',
  accentSoft: '#F8E9D6',
  warning: '#8A4A19', // accent alias kept for existing call sites
  warningSoft: '#F8E9D6',
  danger: '#8C2F2F', // 8.19:1 on surface
  dangerFill: '#8C2F2F',
  // Gold is reserved for devotional calendar marks and chart dashes, never action buttons
  gold: '#9A6B0F', // legacy palette value; actions use primary
  goldText: '#8A5F0A', // gold words on white, 5.4:1
  goldOnPrimary: '#F0C75E', // gold marks on a green cell or bar
  goldLine: '#D2A645', // the dashed 靈修 line on charts (decorative)
  // rules
  border: '#C6D5C9', // decorative hairline only (no 3:1 requirement)
  borderStrong: '#768D7E', // control boundary: 3.57:1 on surface, 3.12:1 on background (WCAG 1.4.11)
  // Words and icons on a filled control (primaryFill, primaryDeepFill, accentFill, dangerFill).
  onFill: '#FFFFFF',
  onFillMuted: 'rgba(255,255,255,0.86)',
  // Behind a panel or dialog, and the shadow under floating buttons.
  // A message laid over the page in the opposite scheme (the undo snackbar, the award line, the 靈修 banner).
  inverse: '#15302A',
  onInverse: '#FFFFFF',
  // The narrated paragraph of the 靈修 tab, the reader's own read-along fill.
  readAlong: '#D5DDD8',
  // The 詩歌 card: a dark media frame in both schemes.
  mediaStage: '#15302A',
  onMediaSoft: '#DAE8DE',
  scrim: 'rgba(0,0,0,0.4)',
  scrimSoft: 'rgba(21,48,42,0.28)',
  shadow: '#15302A',
  // The first frame before sign-in is known matches the native launch screen, which an OTA update cannot change.
  launchBackground: '#FFFFFF',
  // The 週刊 full-screen viewer is a dark photo stage in both schemes.
  viewerStage: '#111111',
  viewerBar: 'rgba(0,0,0,0.65)',
  viewerButton: 'rgba(255,255,255,0.18)',
  viewerHint: 'rgba(0,0,0,0.7)',
  viewerRetry: 'rgba(0,0,0,0.75)',
  onViewer: '#FFFFFF',
  // Scanned paper (週刊) is never inverted at night, only dimmed to 0.82 brightness (光佑 2026-11-04).
  imageDim: 'transparent',
  imagePlaceholder: '#DDE4DC',
  // A friend QR stays black on white in both schemes so every camera can read it.
  qrBackground: '#FFFFFF',
  qrInk: '#000000',
  googleBlue: '#4285F4',
  // The YouVersion reader's own words (--yv-foreground, --yv-muted-foreground), for text laid out like its scripture.
  scriptureInk: '#121212',
  scriptureMuted: '#636161',
  // Charts and calendars
  heatHigh: '#A9CDB7',
  futureText: '#B5C2B9',
  track: 'rgba(0,0,0,0.08)',
  shelfSelected: 'rgba(0,0,0,0.28)',
  // The app's own bottom sheet (src/ui/sheet/bottomSheet.tsx) for the reader SDK's panels.
  grabber: 'rgba(0,0,0,0.75)',
  sheetBackdrop: '#000000',
  overImageButton: 'rgba(255,255,255,0.18)',
  // The two small screens on the 新功能 card, drawn in each scheme (src/ui/NightModeNews.tsx).
  sketchLine: '#C9D3CD',
  sketchFrame: '#768D7E',
  sunMark: '#B7791F',
  moonMark: '#E8D9A8',
} as const;

export type AppColors = { readonly [K in keyof typeof lightColors]: string };

// Dark: deep grey, not black (光佑 2026-11-04; Material dark theme), and the scripture uses the YouVersion reader's own
// dark page. Values follow the approved mock's colour table (recolor.py PALETTE of the 2026-11-04 mock).
export const darkColors: AppColors = {
  background: '#121212',
  surface: '#232121',
  surfaceMuted: '#1C1A1A',
  readerSurface: '#121212',
  ink: '#F2F4F3',
  muted: '#A9B4AE',
  primary: '#7DC8AB',
  primaryFill: '#2F7A62',
  primaryDeep: '#7DC8AB',
  primaryDeepFill: '#24604F',
  primarySoft: '#1F3A31',
  accent: '#E0A06A',
  accentFill: '#8A4A19',
  accentSoft: '#3A2A1C',
  warning: '#E0A06A',
  warningSoft: '#3A2A1C',
  danger: '#F08A8A',
  dangerFill: '#A33A3A',
  gold: '#D9A93A',
  goldText: '#E0B860',
  goldOnPrimary: '#F0C75E',
  goldLine: '#D2A645',
  border: '#353333',
  borderStrong: '#7A7777',
  onFill: '#FFFFFF',
  onFillMuted: 'rgba(255,255,255,0.86)',
  inverse: '#F2F4F3',
  onInverse: '#121212',
  // 20% of the light fill over the dark page, as the reader mixes it (readAlongBridge.ts, --yv-highlight-mix-p).
  readAlong: '#3A3B3A',
  mediaStage: '#1C1A1A',
  onMediaSoft: '#DAE8DE',
  scrim: 'rgba(0,0,0,0.5)',
  scrimSoft: 'rgba(0,0,0,0.5)',
  shadow: '#000000',
  launchBackground: '#FFFFFF',
  viewerStage: '#111111',
  viewerBar: 'rgba(0,0,0,0.65)',
  viewerButton: 'rgba(255,255,255,0.18)',
  viewerHint: 'rgba(0,0,0,0.7)',
  viewerRetry: 'rgba(0,0,0,0.75)',
  onViewer: '#FFFFFF',
  imageDim: 'rgba(0,0,0,0.18)',
  imagePlaceholder: '#353333',
  qrBackground: '#FFFFFF',
  qrInk: '#000000',
  googleBlue: '#4285F4',
  scriptureInk: '#FFFFFF',
  scriptureMuted: '#EDEBEB',
  heatHigh: '#2A5246',
  futureText: '#5C6661',
  track: 'rgba(255,255,255,0.12)',
  shelfSelected: 'rgba(255,255,255,0.24)',
  grabber: 'rgba(255,255,255,0.6)',
  sheetBackdrop: '#000000',
  overImageButton: 'rgba(255,255,255,0.18)',
  sketchLine: '#5A5858',
  sketchFrame: '#7A7777',
  sunMark: '#B7791F',
  moonMark: '#E8D9A8',
};

export function colorsFor(scheme: ColorScheme): AppColors {
  return scheme === 'dark' ? darkColors : lightColors;
}

/**
 * CSS custom properties for both schemes, for a script injected into the reader's page. The page switches itself
 * by the YouVersion reader's own `data-yv-theme="dark"`, so the injected script stays the same string in both
 * schemes: a changed script would make the reader's WebView reload back to the chapter top.
 */
export function webThemeCss(names: ReadonlyArray<keyof AppColors>): string {
  const block = (colors: AppColors) => names.map((name) => `--qm-${name}:${colors[name]};`).join('');
  return `[data-yv-sdk]{${block(lightColors)}}[data-yv-sdk][data-yv-theme=dark]{${block(darkColors)}}`;
}
