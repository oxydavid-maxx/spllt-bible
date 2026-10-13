/**
 * Half-chapter days inside the reader's WebView (maintainer 2026-10-01/02; docs/features/reader.md).
 *
 * Native writes the day's reference onto <html> as data-qingmu-range (PSA.119.1-88) when the passage on
 * screen reads part of its chapter, and removes it otherwise. The whole chapter stays on screen; this
 * script, once per range and only after the reader shows that chapter (not while it is aria-busy):
 *
 * - opens at the range: the heading over its first verse, or its first verse, goes to the top of the
 *   reading band (the chapter top when the range starts the chapter). It is a jump the app makes, so the
 *   toolbar neither collapses nor reveals (window.__qingmuRangeScrolling).
 * - greys every verse unit outside the range, and each heading that leads into one. Once the member's
 *   own finger scrolls the range off the reading line (a third down the band), the grey is gone for
 *   good; a range from verse 1 only leaves it downwards, past its last verse. Scrolls the app makes
 *   (this jump, the read-along follow) never count.
 * - reports whether the range's last verse has been reached (its bottom inside the band, or above it),
 *   with the range it belongs to, whenever that changes; native grows 完成今日讀經 from it.
 *
 * No timers run while idle: it wakes on the attribute, new chapter content, touches and scrolls.
 */

export const READING_RANGE_END_MESSAGE = 'qingmu.reader.range.end';
/** Text outside the day's range: the reader's ink, faded. */
export const READING_RANGE_OUTSIDE_COLOUR = '#a8b0ab';

export interface ReadingRangeEnd { range: string; atEnd: boolean }

export function readingRangeScript(insets: { top: number; bottom: number }): string {
  const top = Math.max(0, Math.round(insets.top));
  const bottom = Math.max(0, Math.round(insets.bottom));
  const renderer = ':is([data-slot=yv-bible-renderer],[data-yv-sdk-bible-reader])';
  const css = `${renderer} .qingmu-outside, ${renderer} .qingmu-outside * { color: ${READING_RANGE_OUTSIDE_COLOUR} !important; }`;
  return `
(function () {
  if (window.__qingmuReadingRange || !window.ReactNativeWebView) return;
  window.__qingmuReadingRange = true;
  var TOP = ${top}, BOTTOM = ${bottom}, DRAG = 10, READING_LINE = 1 / 3;
  var root = document.documentElement;
  var style = document.createElement('style');
  style.id = 'qingmu-reading-range';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
  function send(data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${READING_RANGE_END_MESSAGE}', data: data }));
  }
  function container() { return document.querySelector('[data-yv-sdk] > main'); }
  function parse(key) {
    var m = /^[0-9A-Z]+\\.\\d+\\.(\\d+)(?:-(\\d+))?$/.exec(key || '');
    if (!m) return null;
    var first = Number(m[1]), last = m[2] ? Number(m[2]) : first;
    return first >= 1 && last >= first ? { first: first, last: last } : null;
  }
  function inside(v, range) {
    var m = /^(\\d+)(?:-(\\d+))?$/.exec(v || '');
    if (!m) return true;
    var first = Number(m[1]), last = m[2] ? Number(m[2]) : first;
    return last >= range.first && first <= range.last;
  }
  // The range in this document: which key it is for, and what has been done for it.
  var key = null, opened = false, released = false, lastEnd = null, units = [], greyed = [];
  var ownScrollUntil = 0, fingerScrolled = false;
  window.__qingmuRangeScrolling = function () { return Date.now() < ownScrollUntil; };
  function appScrolling() {
    return Date.now() < ownScrollUntil || Boolean(window.__qingmuFollowScrolling && window.__qingmuFollowScrolling());
  }
  function clearGrey() {
    for (var i = 0; i < greyed.length; i++) greyed[i].classList.remove('qingmu-outside');
    greyed = [];
  }
  function band(main) {
    var box = main.getBoundingClientRect();
    var bandTop = box.top + TOP, bandBottom = box.top + main.clientHeight - BOTTOM;
    return { top: bandTop, bottom: Math.max(bandTop + 1, bandBottom) };
  }
  // The range's verse units in order, or null while the reader is loading another chapter.
  function rangeUnits(range) {
    var renderer = document.querySelector('${renderer}');
    if (!renderer || renderer.closest('[aria-busy="true"]')) return null;
    var all = renderer.querySelectorAll('.yv-v[v], .yv-h');
    var list = [], inRange = [], next = null;
    for (var i = all.length - 1; i >= 0; i--) {
      var el = all[i], isUnit = el.classList.contains('yv-v') && el.hasAttribute('v');
      // A heading belongs with the verse after it.
      var within = isUnit ? inside(el.getAttribute('v'), range) : (next === null ? false : next);
      if (isUnit) next = within;
      list.unshift({ el: el, unit: isUnit, within: within });
    }
    for (var j = 0; j < list.length; j++) if (list[j].unit && list[j].within) inRange.push(list[j].el);
    if (!inRange.length) return null;
    var firstUnit = null;
    for (var k = 0; k < list.length; k++) if (list[k].unit) { firstUnit = list[k].el; break; }
    var start = inRange[0];
    for (var h = 0; h < list.length; h++) {
      if (list[h].el === inRange[0]) { if (h > 0 && !list[h - 1].unit && list[h - 1].within) start = list[h - 1].el; break; }
    }
    return { list: list, first: inRange[0], last: inRange[inRange.length - 1], start: start, atChapterStart: firstUnit === inRange[0] };
  }
  function paint(found) {
    clearGrey();
    if (released) return;
    for (var i = 0; i < found.list.length; i++) {
      if (found.list[i].within) continue;
      found.list[i].el.classList.add('qingmu-outside');
      greyed.push(found.list[i].el);
    }
  }
  function open(found, main) {
    var target = found.atChapterStart ? 0 : main.scrollTop + (found.start.getBoundingClientRect().top - band(main).top);
    ownScrollUntil = Date.now() + 400;
    fingerScrolled = false;
    main.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
  }
  function report(found, main) {
    var b = band(main);
    var atEnd = found.last.getBoundingClientRect().bottom <= b.bottom + 1;
    if (atEnd === lastEnd) return;
    lastEnd = atEnd;
    send({ range: key, atEnd: atEnd });
  }
  function update() {
    var next = root.getAttribute('data-qingmu-range');
    if (next !== key) { key = next; opened = false; released = false; lastEnd = null; clearGrey(); }
    var range = parse(key), main = container();
    if (!range || !main) { units = []; return; }
    var found = rangeUnits(range);
    if (!found) { units = []; clearGrey(); return; }
    units = found;
    paint(found);
    if (!opened) { opened = true; open(found, main); }
    report(found, main);
  }
  // A scroll the member made: give the colour back once the range has left the reading line. A range
  // from the chapter's first verse has nothing above it to scroll into, and it can open with its first
  // verse already below the line (a tall chapter title, a large font): only reading on past its last
  // verse counts there.
  function onScroll() {
    var main = container();
    if (!key || !units || !units.list || !main) return;
    if (!units.first.isConnected) { schedule(); return; }
    report(units, main);
    if (released || appScrolling() || !fingerScrolled) return;
    var b = band(main), line = b.top + (b.bottom - b.top) * READING_LINE;
    var aboveRange = !units.atChapterStart && units.start.getBoundingClientRect().top > line;
    if (aboveRange || units.last.getBoundingClientRect().bottom < line) {
      released = true;
      clearGrey();
    }
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; update(); }, 0);
  }
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['data-qingmu-range'] });
  new MutationObserver(function () { if (key) schedule(); }).observe(document.body || root, { childList: true, subtree: true });
  document.addEventListener('scroll', onScroll, true);
  var startX = null, startY = null;
  function onText(target) { return target && typeof target.closest === 'function' && target.closest('[data-yv-sdk] > main'); }
  document.addEventListener('touchstart', function (event) {
    var t = event.touches && event.touches[0];
    if (!t || event.touches.length !== 1 || !onText(event.target)) { startY = null; return; }
    startX = t.clientX; startY = t.clientY;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function (event) {
    var t = event.touches && event.touches[0];
    if (startY === null || !t) return;
    if (Math.abs(t.clientY - startY) < DRAG && Math.abs(t.clientX - startX) < DRAG) return;
    // A finger on the text: what scrolls from here is the member's, even right after the opening jump.
    fingerScrolled = true;
    ownScrollUntil = 0;
  }, { capture: true, passive: true });
  schedule();
})();
true;
`;
}

export function readReadingRangeMessage(data: string): ReadingRangeEnd | null {
  try {
    const message = JSON.parse(data);
    const range = message?.data?.range, atEnd = message?.data?.atEnd;
    return message?.type === READING_RANGE_END_MESSAGE && typeof range === 'string' && range !== '' && typeof atEnd === 'boolean' ? { range, atEnd } : null;
  } catch { return null; }
}
