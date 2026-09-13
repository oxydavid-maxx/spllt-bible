// Qingmu youth design tokens — direction "經頁邊註 / Marginalia".
// The app chrome behaves like the ruled margin of a printed reading-plan sheet:
// quiet, dense, ruled. Scripture (official YouVersion renderer) is the page.
// Contrast evidence: uiux-lane/analysis/contrast-report.txt (WCAG 2.2 AA).
export const theme = {
  colors: {
    // paper + surfaces. background is deeper than RC13 #F4F7F3 so white cards read
    // as cards without spending extra whitespace to separate them.
    background: '#EDF1EA',
    surface: '#FFFFFF',
    surfaceMuted: '#F4F7F2',
    // ink
    ink: '#15302A', // 14.11:1 on surface
    muted: '#4C5F57', // 6.81:1 on surface, 5.96:1 on background
    // evergreen = system and actions
    primary: '#1A5544', // 8.65:1 on surface
    primaryDeep: '#123B30', // pinned completion bar; white text 12.40:1
    primarySoft: '#DAE8DE',
    // clay = "needs you": pending sync, undo, blocked permission
    accent: '#8A4A19', // 6.83:1 on surface
    accentSoft: '#F8E9D6',
    warning: '#8A4A19', // accent alias kept for existing call sites
    warningSoft: '#F8E9D6',
    danger: '#8C2F2F', // 8.19:1 on surface
    // rules
    border: '#C6D5C9', // decorative hairline only (no 3:1 requirement)
    borderStrong: '#768D7E', // control boundary: 3.57:1 on surface, 3.12:1 on background (WCAG 1.4.11)
    white: '#FFFFFF',
  },
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
