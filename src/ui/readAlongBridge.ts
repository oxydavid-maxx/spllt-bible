/**
 * Read-along inside the reader's WebView (docs/superpowers/plans/2026-09-29-read-along-follow.md).
 *
 * Native writes what it knows onto <html>: data-qingmu-playing-verse (the narrated verse, absent when
 * nothing is narrated), data-qingmu-follow (1 while the page follows the narration),
 * data-qingmu-follow-request (bumped by 回到朗讀處) and data-qingmu-reduce-motion. This script owns
 * the rest, in one place for both platforms:
 *
 * - It paints every verse unit that holds the narrated verse. The unit, not the number: 詩105:5-6 is
 *   one unit v="5-6", and one recording times that stretch as verse 6, which the SDK's own paint (a
 *   parseInt of v) never found (2026-09-29).
 * - While following, a unit that leaves the reading band (the lowest quarter, or above the top) is
 *   scrolled to a third of the band. A button press scrolls there at once.
 * - A finger drag on the text lets go of following: one message per gesture. Scroll events are not
 *   used for that, because the SDK scrolls on a chapter change and the text reflows on a font change.
 * - While not following it reports whether the narrated unit is above, below or on screen, for the
 *   button's arrow, only when that changes.
 *
 * No timers run while idle: it wakes on attribute changes, new chapter content, touches and scrolls.
 */

export const READ_ALONG_RELEASE_MESSAGE = 'qingmu.reader.follow.release';
export const READ_ALONG_POSITION_MESSAGE = 'qingmu.reader.follow.position';
/** The narration highlight colour, the one the SDK extension used (PLAYING_VERSE_HIGHLIGHT_COLOR). */
export const READ_ALONG_HIGHLIGHT = 'd5ddd8';

export type ReadAlongPosition = 'above' | 'below' | 'visible';
export type ReadAlongMessage = { kind: 'release' } | { kind: 'position'; position: ReadAlongPosition };

export function readAlongScript(insets: { top: number; bottom: number }): string {
  const top = Math.max(0, Math.round(insets.top));
  const bottom = Math.max(0, Math.round(insets.bottom));
  const renderer = ':is([data-slot=yv-bible-renderer],[data-yv-sdk-bible-reader])';
  // Same fill as the SDK's own highlights, over any highlight of the member's own while it is read.
  const css = `${renderer} .yv-v.qingmu-playing { background-color: color-mix(in srgb, #${READ_ALONG_HIGHLIGHT} calc(var(--yv-highlight-mix-p) * 100%), var(--yv-background)) !important; }`
    + `${renderer} .yv-v.qingmu-playing .yv-vlbl { color: inherit !important; }`;
  return `
(function () {
  if (window.__qingmuReadAlong || !window.ReactNativeWebView) return;
  window.__qingmuReadAlong = true;
  var TOP = ${top}, BOTTOM = ${bottom}, DRAG = 10, FOLLOW_AT = 0.75;
  var root = document.documentElement;
  var style = document.createElement('style');
  style.id = 'qingmu-read-along';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
  function send(type, data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data === undefined ? null : data }));
  }
  function attr(name) { return root.getAttribute('data-qingmu-' + name); }
  function playing() { var n = parseInt(attr('playing-verse') || '', 10); return n > 0 ? n : null; }
  function following() { return attr('follow') === '1'; }
  function holds(v, n) {
    var m = /^(\\d+)(?:-(\\d+))?$/.exec(v || '');
    if (!m) return false;
    var first = Number(m[1]), last = m[2] ? Number(m[2]) : first;
    return first <= n && n <= last;
  }
  function units(n) {
    var out = [];
    if (n === null) return out;
    var all = document.querySelectorAll('.yv-v[v]');
    for (var i = 0; i < all.length; i++) if (holds(all[i].getAttribute('v'), n)) out.push(all[i]);
    return out;
  }
  var painted = [];
  function paint() {
    var next = units(playing());
    for (var i = 0; i < painted.length; i++) if (next.indexOf(painted[i]) < 0) painted[i].classList.remove('qingmu-playing');
    for (var j = 0; j < next.length; j++) next[j].classList.add('qingmu-playing');
    painted = next;
    return next;
  }
  function container() { return document.querySelector('[data-yv-sdk] > main'); }
  function extent(list) {
    var first = list[0].getBoundingClientRect(), last = list[list.length - 1].getBoundingClientRect();
    return { top: first.top, bottom: last.bottom };
  }
  function band(main) {
    var box = main.getBoundingClientRect();
    var bandTop = box.top + TOP, bandBottom = box.top + main.clientHeight - BOTTOM;
    return { top: bandTop, height: Math.max(1, bandBottom - bandTop) };
  }
  // The immersion bridge reads this so a scroll made here never collapses or reveals the toolbar.
  var ownScrollUntil = 0;
  window.__qingmuFollowScrolling = function () { return Date.now() < ownScrollUntil; };
  function scrollToNarration(list, main, always) {
    var at = extent(list), b = band(main);
    if (!always && at.top >= b.top && at.bottom <= b.top + b.height * FOLLOW_AT) return;
    var target = at.bottom - at.top > b.height * 2 / 3 ? b.top : b.top + b.height / 3;
    var delta = at.top - target;
    if (Math.abs(delta) < 2) return;
    var smooth = attr('reduce-motion') !== '1';
    ownScrollUntil = Date.now() + (smooth ? 1500 : 400);
    main.scrollTo({ top: main.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' });
  }
  var lastRequest, lastPosition = null;
  function report(list, main) {
    var at = extent(list), b = band(main);
    var position = at.bottom <= b.top ? 'above' : at.top >= b.top + b.height ? 'below' : 'visible';
    if (position === lastPosition) return;
    lastPosition = position;
    send('${READ_ALONG_POSITION_MESSAGE}', { position: position });
  }
  function update() {
    var list = paint(), main = container();
    var request = attr('follow-request');
    if (lastRequest === undefined) lastRequest = request;
    var requested = request !== lastRequest;
    lastRequest = request;
    if (!list.length || !main) { lastPosition = null; return; }
    if (following()) { lastPosition = null; scrollToNarration(list, main, requested); return; }
    report(list, main);
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; update(); }, 0);
  }
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['data-qingmu-playing-verse', 'data-qingmu-follow', 'data-qingmu-follow-request'] });
  new MutationObserver(schedule).observe(document.body || root, { childList: true, subtree: true });
  document.addEventListener('scroll', function () { if (!following() && playing() !== null) schedule(); }, true);
  var startX = null, startY = null, released = false;
  function onText(target) { return target && typeof target.closest === 'function' && target.closest('[data-yv-sdk] > main'); }
  document.addEventListener('touchstart', function (event) {
    var t = event.touches && event.touches[0];
    if (!t || event.touches.length !== 1 || !onText(event.target)) { startY = null; return; }
    startX = t.clientX; startY = t.clientY; released = false;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function (event) {
    var t = event.touches && event.touches[0];
    if (startY === null || released || !t) return;
    if (Math.abs(t.clientY - startY) < DRAG && Math.abs(t.clientX - startX) < DRAG) return;
    released = true;
    if (following() && playing() !== null) send('${READ_ALONG_RELEASE_MESSAGE}');
  }, { capture: true, passive: true });
  function endTouch() { startX = null; startY = null; }
  document.addEventListener('touchend', endTouch, { capture: true, passive: true });
  document.addEventListener('touchcancel', endTouch, { capture: true, passive: true });
  schedule();
})();
true;
`;
}

export function readReadAlongMessage(data: string): ReadAlongMessage | null {
  try {
    const message = JSON.parse(data);
    if (message?.type === READ_ALONG_RELEASE_MESSAGE) return { kind: 'release' };
    const position = message?.data?.position;
    if (message?.type === READ_ALONG_POSITION_MESSAGE && (position === 'above' || position === 'below' || position === 'visible')) return { kind: 'position', position };
    return null;
  } catch { return null; }
}
