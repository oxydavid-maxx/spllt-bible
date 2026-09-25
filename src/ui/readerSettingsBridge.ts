export const READER_SETTINGS_MESSAGE = 'qingmu.reader.settings.open';
export const READER_CANVAS_SCROLL_MESSAGE = 'qingmu.reader.canvas.scroll';
export const READER_CANVAS_REVEAL_MESSAGE = 'qingmu.reader.canvas.reveal';
export const READER_CANVAS_EDGE_MESSAGE = 'qingmu.reader.canvas.edge';

export type ReaderRevealReason = 'up' | 'top' | 'end';
export interface ReaderCanvasInsets { top: number; bottom: number }

// Bound to platform-react-ui 2.12.0's official settings labels. Expo handles its
// own messages before forwarding this custom message through its public DOM API.
export const READER_SETTINGS_BRIDGE = `
(function () {
  if (window.__qingmuReaderSettingsBridge || !window.ReactNativeWebView) return;
  window.__qingmuReaderSettingsBridge = true;
  var selector = '[data-yv-sdk] button[aria-label="設定"], [data-yv-sdk] button[aria-label="Settings"]';
  var style = document.createElement('style');
  style.textContent = selector + ' { min-width: 48px; min-height: 48px; }';
  document.head.appendChild(style);
  document.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && typeof target.closest === 'function' ? target.closest(selector) : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'qingmu.reader.settings.open', data: null }));
  }, true);
})();
true;
`;

// Immersion events come from inside the WebView, where the real scroll container lives (YouVersion
// rules): a new downward gesture asks to collapse; a real reverse scroll, arriving at the chapter top
// or arriving at the chapter end asks to reveal. Each is sent once per gesture or arrival. Native owns
// the state and ignores repeats, so a reveal made natively (Back, the collapsed bar) needs no reply
// and the next downward gesture collapses again. Taps are never intercepted: tapping scripture
// selects a verse.
const READER_CANVAS_BRIDGE = `
(function () {
  if (window.__qingmuReaderCanvasBridge || !window.ReactNativeWebView) return;
  window.__qingmuReaderCanvasBridge = true;
  var HIDE_MIN_TOP = 48, REVEAL_UP = 120, EDGE = 24, STEP = 12, NEW_GESTURE_MS = 400;
  var anchor = null, run = null, sentInRun = false, upAccum = 0, lastScroll = 0, atTop = null, atEnd = null;
  var canvasSelector = '[data-slot="yv-bible-renderer"], [data-yv-sdk] > main';
  function closest(target, selector) {
    return target && typeof target.closest === 'function' ? target.closest(selector) : null;
  }
  function send(type, data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data === undefined ? null : data }));
  }
  function reportEdges(container) {
    var top = container.scrollTop <= EDGE;
    var end = container.scrollTop + container.clientHeight >= container.scrollHeight - EDGE;
    if (end !== atEnd) {
      var arrivedAtEnd = end && atEnd === false;
      atEnd = end;
      send('qingmu.reader.canvas.edge', { atEnd: end });
      if (arrivedAtEnd) send('qingmu.reader.canvas.reveal', { reason: 'end' });
    }
    if (top !== atTop) {
      var arrivedAtTop = top && atTop === false;
      atTop = top;
      if (arrivedAtTop) send('qingmu.reader.canvas.reveal', { reason: 'top' });
    }
    return end;
  }
  // New chapter content: report the end state again even if it did not change, because native
  // forgets it when the chapter changes (a short chapter can fit without any scroll).
  window.__qingmuReportEdge = function () {
    var container = document.querySelector('[data-yv-sdk] > main');
    if (!container) return;
    if (anchor === null) anchor = container.scrollTop;
    atEnd = null;
    reportEdges(container);
  };
  document.addEventListener('scroll', function (event) {
    var target = event.target;
    if (!closest(target, canvasSelector) || typeof target.scrollTop !== 'number') return;
    var now = Date.now();
    if (now - lastScroll > NEW_GESTURE_MS) run = null;
    lastScroll = now;
    var top = target.scrollTop;
    var end = reportEdges(target);
    if (anchor === null) anchor = 0;
    var delta = top - anchor;
    if (Math.abs(delta) < STEP) return;
    anchor = top;
    var direction = delta > 0 ? 'down' : 'up';
    if (direction !== run) { run = direction; sentInRun = false; upAccum = 0; }
    if (direction === 'down') {
      if (!sentInRun && top > HIDE_MIN_TOP && !end) {
        sentInRun = true;
        send('qingmu.reader.canvas.scroll', { direction: 'down', deltaY: delta });
      }
      return;
    }
    upAccum -= delta;
    if (!sentInRun && upAccum >= REVEAL_UP) {
      sentInRun = true;
      send('qingmu.reader.canvas.reveal', { reason: 'up' });
    }
  }, true);
})();
true;
`;

// Layout-only rules for the fullscreen reader: room under the overlay chrome, a clearer section
// heading, and no stray chapter-number line (the header chips already name the chapter).
// Text, verse numbers and poetry structure are untouched.
function readerLayoutScript(css: string): string {
  return `
(function () {
  document.documentElement.setAttribute('data-qingmu-reader-fullscreen', 'true');
  var style = document.getElementById('qingmu-reader-fullscreen-layout') || document.createElement('style');
  style.id = 'qingmu-reader-fullscreen-layout';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
  var digitsOnly = new RegExp('^\\\\s*\\\\d+\\\\s*$');
  function hideChapterNumbers() {
    var renderers = document.querySelectorAll('[data-slot="yv-bible-renderer"]');
    for (var r = 0; r < renderers.length; r++) {
      var renderer = renderers[r];
      var firstVerse = renderer.querySelector('.yv-v');
      var blocks = renderer.querySelectorAll('div, p');
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (firstVerse && (block.compareDocumentPosition(firstVerse) & Node.DOCUMENT_POSITION_PRECEDING)) break;
        if (block.querySelector('.yv-v, .yv-vlbl') || block.closest('.yv-v')) continue;
        if (digitsOnly.test(block.textContent || '')) block.style.setProperty('display', 'none', 'important');
      }
    }
    if (window.__qingmuReportEdge) window.__qingmuReportEdge();
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; hideChapterNumbers(); }, 0);
  }
  hideChapterNumbers();
  new MutationObserver(schedule).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
true;
`;
}

export function buildReaderDomBridge(fullscreen: boolean, hasVersionMetadata = false, insets?: ReaderCanvasInsets): string {
  if (!fullscreen) return READER_SETTINGS_BRIDGE;
  // The native SDK also injects an unlayered !important padding-bottom rule.
  // The document guard adds specificity, so this wins even if that rule arrives
  // later. Only the Reader DOM receives this script; official sheets do not.
  const scope = 'html[data-qingmu-reader-fullscreen="true"] [data-yv-sdk] > main';
  const renderer = 'html[data-qingmu-reader-fullscreen="true"] :is([data-slot=yv-bible-renderer],[data-yv-sdk-bible-reader])';
  const top = Math.max(0, Math.round(insets?.top ?? 12));
  const bottom = Math.max(0, Math.round(insets?.bottom ?? 12));
  const css = `${scope} { padding: ${top}px 16px ${bottom}px !important; }`
    + `${renderer} .s, ${renderer} .s1 { font-weight: 600 !important; }`
    + (hasVersionMetadata ? `${scope} > footer { display: none !important; }` : '');
  // Canvas listeners first so the edge reporter exists when the layout pass runs.
  return READER_SETTINGS_BRIDGE + READER_CANVAS_BRIDGE + readerLayoutScript(css);
}

export function readReaderUiMessage(data: string): string | null {
  try {
    const message = JSON.parse(data);
    if (message?.type === READER_CANVAS_SCROLL_MESSAGE) return readReaderCanvasScrollEvent(data) ? message.type : null;
    if (message?.type === READER_CANVAS_REVEAL_MESSAGE) return readReaderCanvasRevealEvent(data) ? message.type : null;
    if (message?.type === READER_CANVAS_EDGE_MESSAGE) return readReaderCanvasEdgeEvent(data) ? message.type : null;
    return message?.data === null && message.type === READER_SETTINGS_MESSAGE ? message.type : null;
  } catch { return null; }
}

export function readReaderCanvasScrollEvent(data: string): { direction: 'up' | 'down'; deltaY: number } | null {
  try {
    const message = JSON.parse(data);
    const scroll = message?.data;
    if (message?.type !== READER_CANVAS_SCROLL_MESSAGE || (scroll?.direction !== 'up' && scroll?.direction !== 'down')
      || !Number.isFinite(scroll.deltaY) || Math.abs(scroll.deltaY) < 12
      || (scroll.direction === 'down' && scroll.deltaY <= 0) || (scroll.direction === 'up' && scroll.deltaY >= 0)) return null;
    return { direction: scroll.direction, deltaY: scroll.deltaY };
  } catch { return null; }
}

export function readReaderCanvasRevealEvent(data: string): ReaderRevealReason | null {
  try {
    const message = JSON.parse(data);
    const reason = message?.data?.reason;
    return message?.type === READER_CANVAS_REVEAL_MESSAGE && ['up', 'top', 'end'].includes(reason) ? reason : null;
  } catch { return null; }
}

export function readReaderCanvasEdgeEvent(data: string): { atEnd: boolean } | null {
  try {
    const message = JSON.parse(data);
    return message?.type === READER_CANVAS_EDGE_MESSAGE && typeof message?.data?.atEnd === 'boolean' ? { atEnd: message.data.atEnd } : null;
  } catch { return null; }
}

export function isReaderSettingsMessage(data: string): boolean {
  return readReaderUiMessage(data) === READER_SETTINGS_MESSAGE;
}
