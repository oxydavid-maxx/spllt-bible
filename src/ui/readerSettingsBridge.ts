export const READER_SETTINGS_MESSAGE = 'qingmu.reader.settings.open';
export const READER_CANVAS_TAP_MESSAGE = 'qingmu.reader.canvas.tap';
export const READER_CANVAS_SCROLL_MESSAGE = 'qingmu.reader.canvas.scroll';

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

// Native toolbar visibility is app-owned. Only a short, stationary pointer tap on
// ordinary scripture is consumed; selection, long press, scrolling and links keep
// the SDK/browser interaction. This is only appended for fullscreen readers.
const READER_CANVAS_BRIDGE = `
(function () {
  if (window.__qingmuReaderCanvasBridge || !window.ReactNativeWebView) return;
  window.__qingmuReaderCanvasBridge = true;
  var gesture = null;
  var lastScroll = -Infinity;
  var canvasSelector = '[data-slot="yv-bible-renderer"], [data-yv-sdk] > main';
  var interactiveSelector = 'button,a,input,textarea,select,option,label,[role="button"],[role="link"],[contenteditable="true"],[data-footnote],[data-slot*="footnote"],sup';
  function closest(target, selector) {
    return target && typeof target.closest === 'function' ? target.closest(selector) : null;
  }
  function hasSelection() {
    var selection = window.getSelection && window.getSelection();
    return !!(selection && selection.toString());
  }
  function isPlainCanvas(target) {
    return !!closest(target, canvasSelector) && !closest(target, interactiveSelector);
  }
  function send(type) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: null }));
  }
  document.addEventListener('pointerdown', function (event) {
    gesture = event.isPrimary !== false && event.button === 0 && isPlainCanvas(event.target) && !hasSelection()
      ? { x: event.clientX, y: event.clientY, time: Date.now(), dragged: false } : null;
  }, true);
  document.addEventListener('pointermove', function (event) {
    if (gesture && (Math.abs(event.clientX - gesture.x) > 10 || Math.abs(event.clientY - gesture.y) > 10)) gesture.dragged = true;
  }, true);
  document.addEventListener('pointercancel', function () { gesture = null; }, true);
  document.addEventListener('click', function (event) {
    var tap = gesture;
    gesture = null;
    if (!tap || tap.dragged || event.detail > 1 || Date.now() - tap.time > 350 || Math.abs(event.clientX - tap.x) > 10 || Math.abs(event.clientY - tap.y) > 10 || !isPlainCanvas(event.target) || hasSelection()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('qingmu.reader.canvas.tap');
  }, true);
  document.addEventListener('scroll', function (event) {
    gesture = null;
    if (!closest(event.target, canvasSelector) || Date.now() - lastScroll < 150) return;
    lastScroll = Date.now();
    send('qingmu.reader.canvas.scroll');
  }, true);
})();
true;
`;

export function buildReaderDomBridge(fullscreen: boolean, hasVersionMetadata = false): string {
  if (!fullscreen) return READER_SETTINGS_BRIDGE;
  // The native SDK also injects an unlayered !important padding-bottom rule.
  // The document guard adds specificity, so this wins even if that rule arrives
  // later. Only the Reader DOM receives this script; official sheets do not.
  const scope = 'html[data-qingmu-reader-fullscreen="true"] [data-yv-sdk] > main';
  const css = `${scope} { padding: 12px 16px !important; }`
    + (hasVersionMetadata ? `${scope} > footer { display: none !important; }` : '');
  const layoutScript = `
(function () {
  document.documentElement.setAttribute('data-qingmu-reader-fullscreen', 'true');
  var style = document.getElementById('qingmu-reader-fullscreen-layout') || document.createElement('style');
  style.id = 'qingmu-reader-fullscreen-layout';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
})();
true;
`;
  return READER_SETTINGS_BRIDGE + layoutScript + READER_CANVAS_BRIDGE;
}

export function readReaderUiMessage(data: string): string | null {
  try {
    const message = JSON.parse(data);
    return message?.data === null && [READER_SETTINGS_MESSAGE, READER_CANVAS_TAP_MESSAGE, READER_CANVAS_SCROLL_MESSAGE].includes(message.type)
      ? message.type : null;
  } catch { return null; }
}

export function isReaderSettingsMessage(data: string): boolean {
  return readReaderUiMessage(data) === READER_SETTINGS_MESSAGE;
}
