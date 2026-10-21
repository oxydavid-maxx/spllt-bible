// A scroll the reader page makes itself (read-along following the narration, the day's range snapping into place)
// must never collapse the reading tools, however late its scroll events arrive. iOS flow 21 (2026-10-20/21): with
// narration playing behind Settings, the follow scroll's animation only ran once the app came back, long after the
// fixed 1.5 s window, so its scroll events read as a finger scrolling down, the tools collapsed by themselves and the
// tab bar went away under the next tap. Drives the real bridges in headless Chromium, as readerImmersionBridge.test.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { buildReaderDomBridge } from '../../src/ui/readerSettingsBridge';

function resolveDumpDomBinary(): string {
  const shellRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  try {
    const builds = readdirSync(shellRoot).filter(name => name.startsWith('chromium_headless_shell-'))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    for (const build of builds.reverse()) {
      for (const platform of ['chrome-headless-shell-win64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-mac-arm64']) {
        const candidate = join(shellRoot, build, platform, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* fall through */ }
  return process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome';
}

function sdkStyles() {
  const webSource = readFileSync('node_modules/@youversion/platform-react-ui/dist/index.js', 'utf8');
  const sourceFile = ts.createSourceFile('sdk.js', webSource, ts.ScriptTarget.Latest, true);
  let sdkCss = '', mainClass = '';
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) {
      if (node.text.startsWith('/*! tailwindcss')) sdkCss = node.text;
      if (node.text.startsWith('yv:*:max-w-lg yv:flex') && node.text.includes('yv:py-12')) mainClass = node.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { css: sdkCss.replace(/@import\s+(?:"[^"]*"|'[^']*')[^;]*;/g, ''), mainClass };
}

const TEXT = '他們離棄正路，就走差了，隨從比珥之子巴蘭的路。巴蘭就是那貪愛不義之工價的先知。';
const passage = () => '<div class="chapter ch2"><div class="s1"><span class="yv-h">假師傅</span></div>'
  + Array.from({ length: 60 }, (_, i) => `<div class="p"><span class="yv-v" v="${i + 1}"><span class="yv-vlbl">${i + 1}</span>${TEXT}</span> </div>`).join('') + '</div>';

// Chromium fires its own (trusted) scroll event only when a real frame lands; those are stopped on window, ahead of
// the bridges' listeners, and each step hands the bridges the scroll event itself, at the moment the step chooses.
// main.scrollTo is replaced so a smooth follow scroll moves only when a step moves it: an animation that stood
// still while the app was in the background and ran after it came back.
const SCRIPT = `
var msgs = [];
window.ReactNativeWebView = { postMessage: function (raw) { msgs.push(JSON.parse(raw)); } };
window.addEventListener('scroll', function (event) { if (event.isTrusted) event.stopImmediatePropagation(); }, true);
__BRIDGE__
var root = document.documentElement, main = document.querySelector('main'), sent = null, from = 0;
main.scrollTo = function (options) { sent = options.top; from = main.scrollTop; };
function set(name, value) { if (value === null) root.removeAttribute('data-qingmu-' + name); else root.setAttribute('data-qingmu-' + name, String(value)); }
function mark(label) { msgs.push({ type: 'mark', data: label }); }
function moveTo(y) { main.scrollTop = y; main.dispatchEvent(new Event('scroll')); }
// The follow scroll's animation: a third of the way, two thirds, there.
function animate(part) { moveTo(from + (sent - from) * part / 3); }
function touch(type) {
  var target = document.querySelector('.yv-v[v="20"]') || main, box = target.getBoundingClientRect();
  var point = new Touch({ identifier: 1, target: target, clientX: box.left + 20, clientY: box.top + 6 });
  target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
}
var steps = [
  // Nobody has touched the scripture yet: a scroll the SDK or a layout change makes is nobody's gesture.
  [0, function () { mark('nobody'); moveTo(400); }],
  [120, function () { moveTo(0); }],
  [120, function () { mark('setup'); set('reduce-motion', 0); set('follow', 1); set('follow-request', 0); set('playing-verse', 2); }],
  // Narration reaches a verse below the band: the page asks for a smooth scroll, and nothing moves yet.
  [120, function () { mark('follow-late'); set('playing-verse', 30); }],
  [2500, function () { msgs.push({ type: 'asked', data: sent !== null }); mark('asked'); animate(1); }],
  [60, function () { animate(2); }],
  [60, function () { animate(3); }],
  // There: the next scroll is a finger's again.
  [120, function () { mark('by-hand'); touch('touchstart'); moveTo(main.scrollTop + 160); touch('touchend'); }],
  // A finger on the text in the middle of a follow scroll: the rest of the movement is the member's.
  [120, function () { mark('follow-touched'); sent = null; set('playing-verse', 42); }],
  [120, function () { animate(1); }],
  [60, function () { mark('touched'); touch('touchstart'); touch('touchend'); animate(2); }],
  [120, function () { mark('range'); set('follow', 0); set('playing-verse', null); moveTo(0); }],
  // The day's range is 彼後2:20-30; 看整章 brings the chapter back and keeps verse 20 where it was. The scroll that
  // keeps it there is the page's own even when its event comes a second later.
  [120, function () { set('passage-range', JSON.stringify({ key: 'k1', label: '彼後2:20-30', firstVerse: 20, lastVerse: 30 })); }],
  [200, function () { mark('expand'); document.querySelector('[data-qingmu-range-control]').click(); }],
  [1000, function () { main.dispatchEvent(new Event('scroll')); }],
  // After the page's own scroll, a scroll nobody's finger made (the SDK changing chapter, text reflowing) is not
  // a gesture either: the 21 failures had the tools collapse around a chapter change with nobody touching.
  [120, function () { mark('untouched'); moveTo(main.scrollTop + 300); }],
  [120, function () { mark('end'); }],
];
var i = 0;
function next() {
  if (i >= steps.length) { parent.postMessage({ msgs: msgs }, '*'); return; }
  var step = steps[i++];
  setTimeout(function () { step[1](); next(); }, step[0]);
}
setTimeout(next, 80);
`;

describe('a scroll the reader page makes itself', () => {
  it('never collapses or reveals the tools, however late its scroll events come, and hands over to a finger', () => {
    const { css, mainClass } = sdkStyles();
    expect(mainClass).toContain('yv:overflow-y-auto');
    const frame = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%}</style></head><body>
      <div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><div data-slot="yv-bible-renderer">${passage()}</div></main></div>
      <script>${SCRIPT.replace('__BRIDGE__', () => buildReaderDomBridge(true, true, { top: 170, bottom: 190 }))}</script></body></html>`;
    const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
      window.addEventListener('message',function(e){if(!e.data||!e.data.msgs)return;document.getElementById('result').textContent=JSON.stringify(e.data);});
      var f=document.createElement('iframe');f.style='width:390px;height:700px;border:0';document.body.appendChild(f);f.srcdoc=${JSON.stringify(frame).replace(/</g, '\\u003c')};
      </script>`;
    const temporaryRoot = realpathSync(tmpdir());
    const work = mkdtempSync(join(temporaryRoot, 'qingmu-own-scroll-'));
    try {
      const page = join(work, 'fixture.html');
      writeFileSync(page, html);
      const output = execFileSync(process.env.CHROME_PATH ?? resolveDumpDomBinary(), [
        '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
        '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND', '--touch-events=enabled',
        `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=12000', '--dump-dom', pathToFileURL(page).href,
      ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      expect(raw, 'Chromium must run the fixture').toBeDefined();
      const run = JSON.parse(raw!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as { msgs: Array<{ type: string; data: unknown }> };
      const between = (from: string, to: string) => {
        const start = run.msgs.findIndex(m => m.type === 'mark' && m.data === from);
        const end = run.msgs.findIndex(m => m.type === 'mark' && m.data === to);
        expect(start, `mark ${from}`).toBeGreaterThanOrEqual(0);
        expect(end, `mark ${to}`).toBeGreaterThan(start);
        return run.msgs.slice(start + 1, end)
          .filter(m => m.type === 'qingmu.reader.canvas.scroll' || m.type === 'qingmu.reader.canvas.reveal' || m.type === 'asked')
          .map(m => m.type === 'qingmu.reader.canvas.scroll' ? 'collapse' : m.type === 'asked' ? `asked:${m.data}` : `reveal:${(m.data as { reason: string }).reason}`);
      };
      // The follow scroll was asked for, and its movement 2.5 s later neither collapsed nor revealed anything.
      expect(between('asked', 'by-hand')).toEqual([]);
      expect(between('follow-late', 'by-hand')).toEqual(['asked:true']);
      // After it arrived, a finger scrolling down collapses the tools as before.
      expect(between('by-hand', 'follow-touched')).toEqual(['collapse']);
      // Before the finger touched, the movement was the page's; after it, the member's.
      expect(between('follow-touched', 'touched')).toEqual([]);
      expect(between('touched', 'range')).toEqual(['collapse']);
      // 看整章 keeping verse 20 in place: its scroll event a second later is still the page's.
      expect(between('expand', 'untouched')).toEqual([]);
      // Scrolls no finger made, before any touch and after the page's own scroll, never collapse (arriving back at
      // the chapter top still reveals, as it always did).
      expect(between('nobody', 'setup')).not.toContain('collapse');
      expect(between('untouched', 'end')).not.toContain('collapse');
    } finally {
      if (resolve(work).startsWith(join(temporaryRoot, 'qingmu-own-scroll-'))) rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }, 90_000);

  it('is the page\'s own until it arrives or a finger touches the text, never for a fixed time', () => {
    // The class of bug: a clock deciding whose scroll it is (1500/400 ms windows, 2026-10-21). Both scripts that
    // scroll the page take the one shared guard (src/ui/ownScrollGuard.ts) instead.
    for (const file of ['src/ui/readAlongBridge.ts', 'src/ui/partialChapterBridge.ts', 'src/ui/readerSettingsBridge.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/ScrollUntil|Date\.now\(\)\s*\+/);
    }
    for (const file of ['src/ui/readAlongBridge.ts', 'src/ui/partialChapterBridge.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain('ownScrollGuardScript(');
    }
  });
});
