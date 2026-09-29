// Drives the read-along script inside headless Chromium with the installed SDK stylesheet and the SDK
// main scroll container: which verse unit is painted for the narrated verse, when the page follows it,
// and what the script tells native about a finger drag or where the narration is.
// docs/superpowers/plans/2026-09-29-read-along-follow.md §5 S2.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { buildReaderDomBridge } from '../../src/ui/readerSettingsBridge';
import { readReadAlongMessage } from '../../src/ui/readAlongBridge';

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

// Psalm 105 as the reader lays it out: 5-6 is one unit, and verse 10 runs over two paragraphs, so it
// has two wrappers with the same v.
const TEXT = '你們要稱謝耶和華，求告他的名，在萬民中傳揚他的作為！';
const unit = (v: string) => `<span class="yv-v" v="${v}"><span class="yv-vlbl">${v}</span>${TEXT}</span> `;
const passage = () => '<div class="chapter ch105"><div class="s1"><span class="yv-h">神和他的子民</span></div>'
  + ['1', '2', '3', '4', '5-6', '7', '8', '9'].map(v => `<div class="p">${unit(v)}</div>`).join('')
  + `<div class="p">${unit('10')}</div><div class="p">${unit('10')}</div>`
  + Array.from({ length: 35 }, (_, i) => `<div class="p">${unit(String(i + 11))}</div>`).join('') + '</div>';

const INSETS = { top: 170, bottom: 190 };
const SCRIPT = `
var msgs = [];
window.ReactNativeWebView = { postMessage: function (raw) { msgs.push(JSON.parse(raw)); } };
__BRIDGE__
var root = document.documentElement, main = document.querySelector('main');
function set(name, value) { if (value === null) root.removeAttribute('data-qingmu-' + name); else root.setAttribute('data-qingmu-' + name, String(value)); }
function mark(label) { msgs.push({ type: 'mark', data: label }); }
function painted() { return Array.prototype.map.call(document.querySelectorAll('.yv-v.qingmu-playing'), function (el) { return el.getAttribute('v'); }); }
function unitTop(v) { var el = document.querySelector('.yv-v[v="' + v + '"]'); return el ? el.getBoundingClientRect().top - main.getBoundingClientRect().top : null; }
function touch(type, y) {
  var target = document.querySelector('.yv-v[v="3"]') || main;
  var point = new Touch({ identifier: 1, target: target, clientX: 120, clientY: y });
  target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
}
var snap = {};
function record(label) { snap[label] = { painted: painted(), scrollTop: Math.round(main.scrollTop), top30: unitTop('30'), top40: unitTop('40'), top12: unitTop('12') }; }
var steps = [
  function () { set('reduce-motion', 1); set('follow', 1); set('follow-request', 0); set('playing-verse', 6); },
  function () { record('v6'); set('playing-verse', 5); },
  function () { record('v5'); set('playing-verse', 7); },
  function () { record('v7'); set('playing-verse', 10); },
  function () { record('v10'); mark('follow'); set('playing-verse', 30); },
  // Headless Chromium does not fire scroll events by itself here; send the one the follow scroll makes.
  function () { main.dispatchEvent(new Event('scroll')); },
  function () { record('follow30'); mark('free'); set('follow', 0); },
  function () { set('playing-verse', 40); },
  function () { record('free40'); mark('small-drag'); touch('touchstart', 400); touch('touchmove', 395); touch('touchend', 395); },
  function () { mark('drag-while-free'); touch('touchstart', 400); touch('touchmove', 370); touch('touchend', 370); },
  // Following again brings verse 40 into the band; then a finger drag, native lets go, the page moves.
  function () { mark('drag'); set('follow', 1); },
  function () { touch('touchstart', 400); touch('touchmove', 380); touch('touchmove', 300); touch('touchend', 300); },
  function () { set('follow', 0); main.scrollTop = main.scrollTop - 250; },
  function () { record('dragged'); main.scrollTop = main.scrollTop + 150; main.dispatchEvent(new Event('scroll')); },
  function () { mark('request'); set('follow', 1); set('follow-request', 1); },
  function () { record('request40'); mark('near'); set('playing-verse', 41); },
  function () { record('near41'); set('playing-verse', null); },
  function () { record('none'); mark('end'); },
];
var i = 0;
function next() {
  if (i < steps.length) { steps[i++](); setTimeout(next, 120); return; }
  var bandTop = ${INSETS.top}, bandHeight = main.clientHeight - ${INSETS.top} - ${INSETS.bottom};
  parent.postMessage({ index: __INDEX__, msgs: msgs, snap: snap, bandTop: bandTop, bandHeight: bandHeight }, '*');
}
setTimeout(next, 80);
`;

it('paints the unit that holds the narrated verse, follows it inside the reading band, and tells native about a drag and where the narration is', () => {
  const { css, mainClass } = sdkStyles();
  expect(mainClass).toContain('yv:overflow-y-auto');
  const frame = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%}</style></head><body>
    <div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><div data-slot="yv-bible-renderer">${passage()}</div></main></div>
    <script>${SCRIPT.replace('__BRIDGE__', () => buildReaderDomBridge(true, true, INSETS)).replace('__INDEX__', '0')}</script></body></html>`;
  const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
    window.addEventListener('message',function(e){if(typeof e.data.index!=='number')return;document.getElementById('result').textContent=JSON.stringify(e.data);});
    var f=document.createElement('iframe');f.style='width:390px;height:700px;border:0';document.body.appendChild(f);f.srcdoc=${JSON.stringify(frame).replace(/</g, '\\u003c')};
    </script>`;
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'qingmu-read-along-'));
  try {
    const page = join(work, 'fixture.html');
    writeFileSync(page, html);
    const output = execFileSync(process.env.CHROME_PATH ?? resolveDumpDomBinary(), [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND', '--touch-events=enabled',
      `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(raw, 'Chromium must run the read-along fixture').toBeDefined();
    const run = JSON.parse(raw!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as {
      msgs: Array<{ type: string; data: any }>; bandTop: number; bandHeight: number;
      snap: Record<string, { painted: string[]; scrollTop: number; top30: number; top40: number; top12: number }>;
    };
    const between = (from: string, to?: string) => {
      const start = run.msgs.findIndex(m => m.type === 'mark' && m.data === from);
      const end = to ? run.msgs.findIndex(m => m.type === 'mark' && m.data === to) : run.msgs.length;
      return run.msgs.slice(start + 1, end).filter(m => m.type !== 'qingmu.reader.canvas.edge')
        .map(m => m.type === 'qingmu.reader.follow.position' ? `position:${m.data.position}` : m.type === 'qingmu.reader.follow.release' ? 'release'
          : m.type === 'qingmu.reader.canvas.scroll' ? 'collapse' : m.type === 'qingmu.reader.canvas.reveal' ? `reveal:${m.data.reason}` : m.type);
    };
    const { snap } = run;
    const oneThird = run.bandTop + run.bandHeight / 3;

    // The narrated verse lights the unit that holds it: 5-6 for 6 (the 2026-09-29 bug) and for 5.
    expect(snap.v6.painted).toEqual(['5-6']);
    expect(snap.v5.painted).toEqual(['5-6']);
    expect(snap.v7.painted).toEqual(['7']);
    expect(snap.v10.painted).toEqual(['10', '10']);
    // Following: verse 30 was below the band, so the page scrolled it to a third of the band, and that
    // programmatic scroll did not collapse the toolbar.
    expect(snap.follow30.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(snap.follow30.top30 - oneThird)).toBeLessThanOrEqual(2);
    expect(between('follow', 'free')).toEqual([]);
    // Not following: the narration moves on, the page stays, native hears where it is.
    expect(snap.free40.scrollTop).toBe(snap.follow30.scrollTop);
    expect(between('free', 'small-drag')).toEqual(['position:visible', 'position:below']);
    // A drag releases following once per gesture, a small wobble does not, and nothing is sent while free.
    expect(between('small-drag', 'drag-while-free')).toEqual([]);
    expect(between('drag-while-free', 'drag')).toEqual([]);
    const followOnly = (from: string, to: string) => between(from, to).filter(m => m === 'release' || m.startsWith('position:'));
    // Scrolling by hand while free updates the arrow: below, then back on screen.
    expect(followOnly('drag', 'request')).toEqual(['release', 'position:below', 'position:visible']);
    expect(snap.dragged.top40).toBeGreaterThan(run.bandTop + run.bandHeight);
    // The button: follow again and scroll to the narrated verse at once.
    expect(Math.abs(snap.request40.top40 - oneThird)).toBeLessThanOrEqual(2);
    // Following and the next verse still inside the band: no scroll.
    expect(snap.near41.scrollTop).toBe(snap.request40.scrollTop);
    expect(snap.none.painted).toEqual([]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // Headless Chromium takes a second alone and far longer while the whole suite shares the CPU.
}, 90_000);

it('reads only well-formed read-along messages', () => {
  expect(readReadAlongMessage(JSON.stringify({ type: 'qingmu.reader.follow.release', data: null }))).toEqual({ kind: 'release' });
  expect(readReadAlongMessage(JSON.stringify({ type: 'qingmu.reader.follow.position', data: { position: 'above' } }))).toEqual({ kind: 'position', position: 'above' });
  expect(readReadAlongMessage(JSON.stringify({ type: 'qingmu.reader.follow.position', data: { position: 'left' } }))).toBeNull();
  expect(readReadAlongMessage(JSON.stringify({ type: 'qingmu.reader.canvas.scroll', data: { direction: 'down', deltaY: 20 } }))).toBeNull();
  expect(readReadAlongMessage('not json')).toBeNull();
});
