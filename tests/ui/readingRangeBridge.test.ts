// Half-chapter days (maintainer 2026-10-01/02) inside headless Chromium, with the installed SDK stylesheet
// and its main scroll container: the reader opens a chapter at the day's first verse, greys what is
// outside the range, gives the normal colour back once the member's own finger scrolls out of the range,
// and tells native when the range's last verse has been reached. The harness is the one
// tests/ui/readAlongBridge.test.ts uses.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { buildReaderDomBridge } from '../../src/ui/readerSettingsBridge';
import { readReadingRangeMessage } from '../../src/ui/readingRangeBridge';

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

// A Psalm 119-like chapter: a heading before every eight verses, 48 verses.
const TEXT = '你們要稱謝耶和華，求告他的名，在萬民中傳揚他的作為！要向他唱詩歌頌，談論他一切奇妙的作為。';
const unit = (v: number) => `<span class="yv-v" v="${v}"><span class="yv-vlbl">${v}</span>${TEXT}</span> `;
const passage = () => '<div class="chapter">' + Array.from({ length: 48 }, (_, i) => i + 1).map(v =>
  (v % 8 === 1 ? `<div class="s1 yv-h" data-h="${v}">第${(v + 7) / 8}段</div>` : '') + `<div class="p">${unit(v)}</div>`).join('') + '</div>';

const INSETS = { top: 170, bottom: 190 };
const SCRIPT = `
var msgs = [];
window.ReactNativeWebView = { postMessage: function (raw) { msgs.push(JSON.parse(raw)); } };
__BRIDGE__
var root = document.documentElement, main = document.querySelector('main'), busy = document.querySelector('[data-busy-host]');
var bandTop = ${INSETS.top}, bandHeight = main.clientHeight - ${INSETS.top} - ${INSETS.bottom};
function set(name, value) { if (value === null) root.removeAttribute('data-qingmu-' + name); else root.setAttribute('data-qingmu-' + name, String(value)); }
function mark(label) { msgs.push({ type: 'mark', data: label }); }
function box(el) { var r = el.getBoundingClientRect(), m = main.getBoundingClientRect(); return { top: r.top - m.top, bottom: r.bottom - m.top }; }
function verse(v) { return document.querySelector('.yv-v[v="' + v + '"]'); }
function heading(v) { return document.querySelector('[data-h="' + v + '"]'); }
function grey() {
  var out = [];
  document.querySelectorAll('.yv-v[v]').forEach(function (el) { if (el.classList.contains('qingmu-outside')) out.push(Number(el.getAttribute('v'))); });
  return out;
}
function greyHeadings() {
  var out = [];
  document.querySelectorAll('[data-h]').forEach(function (el) { if (el.classList.contains('qingmu-outside')) out.push(Number(el.getAttribute('data-h'))); });
  return out;
}
function colour(el) { return getComputedStyle(el).color; }
// Content moves by (to - where the element is now), the way a finger drag moves it.
function drag(el, edge, to) {
  var t = el ? box(el)[edge] : 0;
  var target = document.querySelector('.yv-v[v="20"]') || main;
  function touch(type, y) {
    var point = new Touch({ identifier: 1, target: target, clientX: 120, clientY: y });
    target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
  }
  touch('touchstart', 400); touch('touchmove', 380); touch('touchend', 380);
  main.scrollTop = main.scrollTop + (t - to);
  main.dispatchEvent(new Event('scroll'));
}
var snap = {};
function record(label, first) {
  snap[label] = { scrollTop: Math.round(main.scrollTop), grey: grey(), greyHeadings: greyHeadings(), firstTop: first ? Math.round(box(first).top) : null,
    outColour: colour(verse(1)), inColour: colour(verse(20)) };
}
var steps = [
  function () { record('none', null); mark('open'); set('range', 'PSA.119.17-24'); },
  // Headless Chromium does not fire scroll events by itself here; send the one the opening jump makes.
  function () { main.dispatchEvent(new Event('scroll')); },
  function () { record('opened', heading(17)); mark('program'); main.scrollTop = main.scrollTop + 60; main.dispatchEvent(new Event('scroll')); },
  function () { record('program', null); main.scrollTop = main.scrollTop - 60; main.dispatchEvent(new Event('scroll')); mark('end'); },
  // The member reads on until verse 24 is on screen, still in the range.
  function () { drag(verse(24), 'bottom', bandTop + bandHeight * 0.8); },
  function () { record('lastOnScreen', null); mark('leave'); },
  // And on past it: verse 24 goes above the reading line, so the rest of the chapter is read normally.
  function () { drag(verse(24), 'bottom', bandTop + bandHeight * 0.2); },
  function () { record('left', null); mark('other'); set('range', 'PSA.119.33-40'); },
  function () { record('other', heading(33)); mark('up'); drag(heading(33), 'top', bandTop + bandHeight * 0.6); },
  function () { record('up', null); mark('loading'); busy.setAttribute('aria-busy', 'true'); set('range', 'PSA.119.9-16'); },
  function () { record('busy', null); busy.removeAttribute('aria-busy'); document.querySelector('[data-slot="yv-bible-renderer"]').innerHTML = ${JSON.stringify(passage())}; },
  function () { record('loaded', heading(9)); mark('whole'); set('range', 'PSA.119.1-8'); },
  function () { record('fromStart', null); mark('gone'); set('range', null); },
  function () { record('gone', null); mark('done'); },
];
var i = 0;
function next() {
  if (i < steps.length) { steps[i++](); setTimeout(next, 120); return; }
  parent.postMessage({ index: 0, msgs: msgs, snap: snap, bandTop: bandTop, bandHeight: bandHeight }, '*');
}
setTimeout(next, 80);
`;

it('opens at the range, greys outside it until the member scrolls out, and reports the range end', () => {
  const { css, mainClass } = sdkStyles();
  expect(mainClass).toContain('yv:overflow-y-auto');
  const frame = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%}</style></head><body>
    <div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><div data-yv-sdk data-busy-host><section data-slot="yv-bible-renderer">${passage()}</section></div></main></div>
    <script>${SCRIPT.replace('__BRIDGE__', () => buildReaderDomBridge(true, true, INSETS))}</script></body></html>`;
  const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
    window.addEventListener('message',function(e){if(typeof e.data.index!=='number')return;document.getElementById('result').textContent=JSON.stringify(e.data);});
    var f=document.createElement('iframe');f.style='width:390px;height:700px;border:0';document.body.appendChild(f);f.srcdoc=${JSON.stringify(frame).replace(/</g, '\\u003c')};
    </script>`;
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'qingmu-reading-range-'));
  try {
    const page = join(work, 'fixture.html');
    writeFileSync(page, html);
    const output = execFileSync(process.env.CHROME_PATH ?? resolveDumpDomBinary(), [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND', '--touch-events=enabled',
      `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(raw, 'Chromium must run the reading-range fixture').toBeDefined();
    const run = JSON.parse(raw!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as {
      msgs: Array<{ type: string; data: any }>; bandTop: number; bandHeight: number;
      snap: Record<string, { scrollTop: number; grey: number[]; greyHeadings: number[]; firstTop: number | null; outColour: string; inColour: string }>;
    };
    const between = (from: string, to?: string) => {
      const start = run.msgs.findIndex(m => m.type === 'mark' && m.data === from);
      const end = to ? run.msgs.findIndex(m => m.type === 'mark' && m.data === to) : run.msgs.length;
      return run.msgs.slice(start + 1, end).filter(m => m.type !== 'qingmu.reader.canvas.edge')
        .map(m => m.type === 'qingmu.reader.range.end' ? `end:${m.data.range}:${m.data.atEnd}`
          : m.type === 'qingmu.reader.canvas.scroll' ? 'collapse' : m.type === 'qingmu.reader.canvas.reveal' ? `reveal:${m.data.reason}` : m.type);
    };
    const { snap } = run;
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const outside = (first: number, last: number) => range(1, 48).filter(v => v < first || v > last);

    // A whole-chapter day: nothing greyed, nothing moved, nothing reported.
    expect(snap.none).toMatchObject({ scrollTop: 0, grey: [], greyHeadings: [] });
    expect(between('open', 'program').filter(m => m.startsWith('end:')).length).toBe(1);

    // Opening a range: the heading over its first verse sits at the top of the reading band, the verses
    // and headings outside it are grey, and its end is not reached yet. The jump is not a gesture.
    expect(snap.opened.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(snap.opened.firstTop! - run.bandTop)).toBeLessThanOrEqual(2);
    expect(snap.opened.grey).toEqual(outside(17, 24));
    expect(snap.opened.greyHeadings).toEqual([1, 9, 25, 33, 41]);
    expect(snap.opened.outColour).not.toBe(snap.opened.inColour);
    expect(between('open', 'program')).toEqual(['end:PSA.119.17-24:false']);
    // A scroll the app makes (here: one without a finger on the text) keeps the grey.
    expect(snap.program.grey).toEqual(outside(17, 24));
    expect(between('program', 'end')).toEqual([]);

    // The member reads down to the last verse: the end is reported once, and the grey stays while the
    // range still holds the reading line.
    expect(between('end', 'leave').filter(m => m.startsWith('end:'))).toEqual(['end:PSA.119.17-24:true']);
    expect(snap.lastOnScreen.grey).toEqual(outside(17, 24));
    // Scrolling on past it gives the rest of the chapter its normal colour, for good.
    expect(snap.left.grey).toEqual([]);
    expect(snap.left.greyHeadings).toEqual([]);
    expect(snap.left.outColour).toBe(snap.left.inColour);

    // Another range of the same chapter (no new content): open at it again, grey again, report again.
    expect(Math.abs(snap.other.firstTop! - run.bandTop)).toBeLessThanOrEqual(2);
    expect(snap.other.grey).toEqual(outside(33, 40));
    expect(between('other', 'up').filter(m => m.startsWith('end:'))).toEqual(['end:PSA.119.33-40:false']);
    // Scrolling up out of the range by finger gives the normal colour back too.
    expect(snap.up.grey).toEqual([]);

    // While the reader still shows the previous chapter (aria-busy), nothing is moved or greyed; once
    // the new content is in, the range opens.
    expect(snap.busy.grey).toEqual([]);
    expect(snap.busy.scrollTop).toBe(snap.up.scrollTop);
    expect(between('loading', 'whole').filter(m => m.startsWith('end:'))).toEqual(['end:PSA.119.9-16:false']);
    expect(Math.abs(snap.loaded.firstTop! - run.bandTop)).toBeLessThanOrEqual(2);
    expect(snap.loaded.grey).toEqual(outside(9, 16));

    // A range from the chapter's first verse opens at the chapter top.
    expect(snap.fromStart.scrollTop).toBe(0);
    expect(snap.fromStart.grey).toEqual(outside(1, 8));
    // No range: back to normal.
    expect(snap.gone.grey).toEqual([]);
    expect(snap.gone.greyHeadings).toEqual([]);
    // No jump to a range collapses the toolbar (only the member's own drags may).
    for (const [from, to] of [['open', 'end'], ['other', 'up'], ['loading', 'done']]) {
      expect(between(from, to).filter(m => m === 'collapse'), from).toEqual([]);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 90000);

it('reads only well-formed range-end messages', () => {
  expect(readReadingRangeMessage(JSON.stringify({ type: 'qingmu.reader.range.end', data: { range: 'PSA.119.1-88', atEnd: true } }))).toEqual({ range: 'PSA.119.1-88', atEnd: true });
  expect(readReadingRangeMessage(JSON.stringify({ type: 'qingmu.reader.range.end', data: { range: 'PSA.119.1-88', atEnd: 'yes' } }))).toBeNull();
  expect(readReadingRangeMessage(JSON.stringify({ type: 'qingmu.reader.range.end', data: { atEnd: true } }))).toBeNull();
  expect(readReadingRangeMessage(JSON.stringify({ type: 'qingmu.reader.follow.release', data: null }))).toBeNull();
  expect(readReadingRangeMessage('not json')).toBeNull();
});
