/** Restrict the SDK's transformed verse units. No second scripture renderer and no idle polling. */
export function partialChapterScript(): string {
  return `
(function () {
  if (window.__qingmuPartialChapter || !window.ReactNativeWebView) return;
  window.__qingmuPartialChapter = true;
  var root = document.documentElement, key = null, expanded = false, firstUnit = null, lastRange = null;
  var hidden = [], head = null, tail = null, audio = null;
  var ownScrollUntil = 0;
  window.__qingmuRangeScrolling = function () { return Date.now() < ownScrollUntil; };
  var style = document.createElement('style');
  style.textContent = '[data-qingmu-range-hidden]{display:none!important}'
    + '[data-qingmu-range-head],[data-qingmu-range-tail],[data-qingmu-range-audio]{color:#4c5f57;background:#fff;font:14px/1.6 system-ui,sans-serif;}'
    + '[data-qingmu-range-head]{display:flex;align-items:center;flex-wrap:wrap;gap:0 4px;margin-bottom:12px;}'
    + '[data-qingmu-range-tail]{text-align:center;border-top:1px solid #d5ddd8;padding-top:16px;margin-top:20px;}'
    + '[data-qingmu-range-audio]{margin:8px 0;}'
    + '[data-qingmu-range-control]{font:inherit;color:#1a5544;background:transparent;border:0;min-width:44px;min-height:44px;padding:0 4px;cursor:pointer;}'
    + '[data-qingmu-range-control]:focus-visible{outline:2px solid #1a5544;outline-offset:2px;}';
  document.head.appendChild(style);
  function readRange() {
    try {
      var r = JSON.parse(root.getAttribute('data-qingmu-passage-range') || 'null');
      return r && typeof r.key === 'string' && typeof r.label === 'string'
        && Number.isInteger(r.firstVerse) && Number.isInteger(r.lastVerse)
        && r.firstVerse > 0 && r.lastVerse >= r.firstVerse ? r : null;
    } catch (_) { return null; }
  }
  function bounds(el) {
    var m = /^(\\d+)(?:-(\\d+))?$/.exec(el.getAttribute('v') || '');
    return m ? [Number(m[1]), Number(m[2] || m[1])] : null;
  }
  function overlaps(el, range) {
    var b = bounds(el);
    return b && b[0] <= range.lastVerse && b[1] >= range.firstVerse;
  }
  function hide(el) { el.setAttribute('data-qingmu-range-hidden', ''); hidden.push(el); }
  function clear() {
    hidden.forEach(function (el) { el.removeAttribute('data-qingmu-range-hidden'); }); hidden = [];
    if (head) head.remove(); if (tail) tail.remove();
    head = tail = null;
  }
  function button(text) {
    var el = document.createElement('button'); el.type = 'button'; el.textContent = text;
    el.setAttribute('data-qingmu-range-control', '');
    el.addEventListener('click', function () {
      // Keep the first visible verse anchored while restoring the surrounding chapter.
      var main = document.querySelector('[data-yv-sdk] > main');
      var units = document.querySelectorAll('.yv-v[v]'), anchor = null, offset = 0;
      for (var i = 0; i < units.length; i++) {
        if (units[i].getClientRects().length && units[i].getBoundingClientRect().bottom >= (main ? main.getBoundingClientRect().top : 0)) { anchor = units[i]; offset = anchor.getBoundingClientRect().top; break; }
      }
      ownScrollUntil = Date.now() + 400;
      expanded = true; clear();
      if (anchor && main) main.scrollTop += anchor.getBoundingClientRect().top - offset;
      if (window.__qingmuReportEdge) window.__qingmuReportEdge();
    });
    return el;
  }
  function notice(renderer) {
    var text = root.getAttribute('data-qingmu-passage-audio-notice');
    if (audio && (!text || !renderer || !audio.isConnected)) { audio.remove(); audio = null; }
    if (!text || !renderer) return;
    if (!audio) { audio = document.createElement('p'); audio.setAttribute('data-qingmu-range-audio', ''); audio.setAttribute('role', 'status'); renderer.before(audio); }
    if (audio.textContent !== text) audio.textContent = text;
  }
  function update() {
    var range = readRange(), renderer = document.querySelector('[data-slot="yv-bible-renderer"]');
    notice(renderer);
    var nextKey = range ? range.key : null;
    if (key !== nextKey) { key = nextKey; expanded = false; firstUnit = null; lastRange = null; clear(); }
    if (!renderer) { clear(); firstUnit = null; lastRange = null; return; }
    var units = Array.from(renderer.querySelectorAll('.yv-v[v]'));
    var currentFirst = units[0] || null;
    var rangeValue = range ? JSON.stringify(range) : null;
    if (currentFirst === firstUnit && rangeValue === lastRange) return;
    var changedContent = currentFirst !== firstUnit;
    firstUnit = currentFirst; lastRange = rangeValue;
    clear();
    if (!range || expanded || !units.length) return;
    var kept = units.filter(function (el) { return overlaps(el, range); });
    units.forEach(function (el) { if (kept.indexOf(el) < 0) hide(el); });
    function nextUnit(el) { return units.find(function (unit) { return !!(el.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING); }); }
    // A heading belongs to the next verse, not the previous paragraph's trailing verse marker.
    Array.from(renderer.querySelectorAll('.yv-h,.s,.s1,.s2,.s3,.s4,.ms,.ms1,.ms2,.r,.qa')).forEach(function (el) {
      if (el.closest('.yv-v[v]')) return;
      var next = nextUnit(el); if (!next || kept.indexOf(next) < 0) hide(el);
    });
    // Remove the actual empty paragraph boxes too, including poetry q1/q2 and enclosing sections.
    Array.from(renderer.querySelectorAll('div,p')).forEach(function (el) {
      if (el.closest('.yv-v[v]') || el.matches('.yv-h') || el.querySelector('.yv-h')) return;
      var children = Array.from(el.querySelectorAll('.yv-v[v]'));
      if (children.length ? !children.some(function (unit) { return kept.indexOf(unit) >= 0; }) : !kept.includes(nextUnit(el))) hide(el);
    });
    if (range.firstVerse > 1) {
      head = document.createElement('div'); head.setAttribute('data-qingmu-range-head', '');
      var label = document.createElement('span'); label.textContent = range.label + ' · ';
      head.append(label, button('看整章')); renderer.before(head);
    }
    var chapterEnd = units.reduce(function (max, el) { var b = bounds(el); return Math.max(max, b ? b[1] : 0); }, 0);
    if (range.lastVerse < chapterEnd) {
      tail = document.createElement('div'); tail.setAttribute('data-qingmu-range-tail', '');
      var end = document.createElement('div'); end.textContent = '今天讀到第 ' + range.lastVerse + ' 節';
      tail.append(end, button('看整章 ›')); renderer.after(tail);
    }
    // Filtering collapses preceding paragraphs: the assigned first verse is at the start, with its
    // range hint visible. Re-run when async SDK content arrives, never on ordinary scrolling.
    var main = document.querySelector('[data-yv-sdk] > main');
    if (main && changedContent) { ownScrollUntil = Date.now() + 400; main.scrollTop = 0; }
    if (window.__qingmuReportEdge) window.__qingmuReportEdge();
  }
  var scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; setTimeout(function () { scheduled = false; update(); }, 0); }
  new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ['data-qingmu-passage-range', 'data-qingmu-passage-audio-notice'] });
  new MutationObserver(schedule).observe(document.body || root, { childList: true, subtree: true });
  schedule();
})();
true;
`;
}
