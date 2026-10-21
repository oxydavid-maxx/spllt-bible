/**
 * Whose scroll is it? The reader page scrolls by itself in two places: read-along follows the narrated verse
 * (readAlongBridge.ts) and the day's range snaps into place (partialChapterBridge.ts). The tools' collapse and
 * reveal (readerSettingsBridge.ts) must skip those scrolls, or the reading tools and the tab bar go away while
 * nobody touches the screen.
 *
 * A scroll the page makes stays its own until the page gets where it was sent, or until a finger touches the
 * text. Never for a fixed time: iOS flow 21 (2026-10-20/21) showed why. Narration went on behind Settings, the
 * follow scroll it asked for only moved once the app was back, long after the old 1.5 s window, and its scroll
 * events then read as a finger scrolling down. tests/ui/readerOwnScroll.test.ts drives both scripts with late events.
 *
 * The returned source goes inside a script's own function: it defines `ownScroll(main, top)`, called right before
 * the script scrolls `main` to `top`, and `window[flag]()`, which readerSettingsBridge.ts asks for each scroll event.
 */
export function ownScrollGuardScript(flag: '__qingmuFollowScrolling' | '__qingmuRangeScrolling'): string {
  return `
  var ownTarget = null;
  function ownScroll(main, top) {
    var max = Math.max(0, main.scrollHeight - main.clientHeight);
    ownTarget = Math.min(max, Math.max(0, top));
  }
  window.${flag} = function () {
    if (ownTarget === null) return false;
    var main = document.querySelector('[data-yv-sdk] > main');
    // The event that arrives is still this script's; the next one is not.
    if (!main || Math.abs(main.scrollTop - ownTarget) <= 1) ownTarget = null;
    return true;
  };
  function fingerOnText(event) {
    var target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('[data-yv-sdk] > main')) ownTarget = null;
  }
  document.addEventListener('touchstart', fingerOnText, { capture: true, passive: true });
  document.addEventListener('touchmove', fingerOnText, { capture: true, passive: true });
`;
}
