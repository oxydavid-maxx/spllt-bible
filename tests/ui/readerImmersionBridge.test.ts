// Drives the real DOM bridge inside headless Chromium with the installed SDK stylesheet and
// the SDK main scroll container, then records every message the bridge posts to native.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
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

const verse = (n: number) => `<span class="yv-v" v="${n}"><span class="yv-vlbl">${n}</span>神的僕人，耶穌基督的使徒保羅，憑着神選民的信心與敬虔真理的知識。</span> `;
const passage = (chapterLabelClass: string) => `<div class="chapter ch1"><div class="${chapterLabelClass}">1</div>`
  + '<div class="s1"><span class="yv-h">問候</span></div>'
  + Array.from({ length: 40 }, (_, i) => `<div class="p">${verse(i + 1)}</div>`).join('') + '</div>';

// Each step moves the real scroll container or taps, then waits for the async scroll event.
const SCRIPT = `
var msgs = [], sdkClicks = 0;
window.ReactNativeWebView = { postMessage: function (raw) { msgs.push(JSON.parse(raw)); } };
__BRIDGE__
var main = document.querySelector('main'), renderer = document.querySelector('[data-slot="yv-bible-renderer"]');
renderer.addEventListener('click', function () { sdkClicks++; });
function scrollTo(y) { main.scrollTop = y; main.dispatchEvent(new Event('scroll')); }
function mark(label) { msgs.push({ type: 'mark', data: label }); }
function tapVerse() {
  var target = document.querySelector('.yv-v[v="3"]'), box = target.getBoundingClientRect();
  var x = box.left + 20, y = box.top + 8;
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true, button: 0, clientX: x, clientY: y }));
  var click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y });
  target.dispatchEvent(click);
  return click.defaultPrevented;
}
// 'pause' stands for the reader stopping for a while (native may reveal meanwhile, e.g. Back).
var steps = [
  function () { mark('start'); },
  function () { scrollTo(200); },
  function () { mark('up60'); scrollTo(140); },
  function () { mark('up80'); scrollTo(60); },
  function () { mark('down-again'); scrollTo(100); },
  function () { mark('to-top'); scrollTo(20); },
  function () { mark('down-before-tap'); scrollTo(400); },
  function () { mark('same-gesture'); scrollTo(500); },
  function () { mark('tap'); window.__tapPrevented = tapVerse(); },
  'pause',
  function () { mark('after-pause'); scrollTo(700); },
  function () { mark('to-end'); scrollTo(main.scrollHeight); },
];
var i = 0;
function next() {
  if (i < steps.length) {
    var step = steps[i++];
    if (step === 'pause') { setTimeout(next, 600); return; }
    step(); setTimeout(next, 60); return;
  }
  var label = document.querySelector('.chapter > :first-child'), vlbl = document.querySelector('.yv-vlbl'), heading = document.querySelector('.s1');
  var style = getComputedStyle(main);
  parent.postMessage({ index: __INDEX__, msgs: msgs, sdkClicks: sdkClicks, tapPrevented: window.__tapPrevented,
    labelDisplay: getComputedStyle(label).display, verseLabelDisplay: getComputedStyle(vlbl).display,
    headingWeight: getComputedStyle(heading).fontWeight, padTop: style.paddingTop, padBottom: style.paddingBottom }, '*');
}
setTimeout(next, 80);
`;

it('asks to collapse once per downward gesture, ignores small reverse scrolls, asks to reveal on a real reverse, the chapter top or the chapter end, and leaves taps to verse selection', () => {
  const { css, mainClass } = sdkStyles();
  expect(css).toContain('tailwindcss');
  expect(mainClass).toContain('yv:overflow-y-auto');
  const cases = ['c', 'label'];
  const frames = cases.map((labelClass, index) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%}</style></head><body>
    <div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><div data-slot="yv-bible-renderer">${passage(labelClass)}</div></main></div>
    <script>${SCRIPT.replace('__BRIDGE__', () => buildReaderDomBridge(true, true, { top: 170, bottom: 190 })).replace('__INDEX__', () => String(index))}</script></body></html>`);
  const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
    var results=[];window.addEventListener('message',function(e){if(typeof e.data.index!=='number')return;results.push(e.data);if(results.length===${cases.length})document.getElementById('result').textContent=JSON.stringify(results.sort(function(a,b){return a.index-b.index;}));});
    ${JSON.stringify(frames).replace(/</g, '\\u003c')}.forEach(function(source){var f=document.createElement('iframe');f.style='width:390px;height:700px;border:0';document.body.appendChild(f);f.srcdoc=source;});
    </script>`;
  const temporaryRoot = realpathSync(tmpdir());
  const work = mkdtempSync(join(temporaryRoot, 'qingmu-reader-immersion-'));
  try {
    const page = join(work, 'fixture.html');
    writeFileSync(page, html);
    const output = execFileSync(process.env.CHROME_PATH ?? resolveDumpDomBinary(), [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(raw, 'Chromium must run every bridge fixture').toBeDefined();
    const measured = JSON.parse(raw!) as Array<{ msgs: Array<{ type: string; data: any }>; sdkClicks: number; tapPrevented: boolean;
      labelDisplay: string; verseLabelDisplay: string; headingWeight: string; padTop: string; padBottom: string }>;
    expect(measured).toHaveLength(cases.length);
    for (const run of measured) {
      const between = (from: string, to?: string) => {
        const start = run.msgs.findIndex(m => m.type === 'mark' && m.data === from);
        const end = to ? run.msgs.findIndex(m => m.type === 'mark' && m.data === to) : run.msgs.length;
        return run.msgs.slice(start + 1, end).map(m => m.type === 'qingmu.reader.canvas.scroll' ? `down` : m.type === 'qingmu.reader.canvas.reveal' ? `reveal:${m.data.reason}` : m.type === 'qingmu.reader.canvas.edge' ? `edge:${m.data.atEnd}` : m.type);
      };
      expect(between('start', 'up60')).toEqual(['down']);
      expect(between('up60', 'up80')).toEqual([]);
      expect(between('up80', 'down-again')).toEqual(['reveal:up']);
      expect(between('down-again', 'to-top')).toEqual(['down']);
      expect(between('to-top', 'down-before-tap')).toEqual(['reveal:top']);
      expect(between('down-before-tap', 'same-gesture')).toEqual(['down']);
      expect(between('same-gesture', 'tap')).toEqual([]);
      expect(between('tap', 'after-pause')).toEqual([]);
      expect(run.tapPrevented).toBe(false);
      expect(run.sdkClicks).toBe(1);
      expect(between('after-pause', 'to-end')).toEqual(['down']);
      expect(between('to-end')).toEqual(['edge:true', 'reveal:end']);
      expect(run.labelDisplay).toBe('none');
      expect(run.verseLabelDisplay).not.toBe('none');
      expect(run.headingWeight).toBe('600');
      expect(run.padTop).toBe('170px');
      expect(run.padBottom).toBe('190px');
    }
  } finally {
    if (resolve(work).startsWith(`${temporaryRoot}\\qingmu-reader-immersion-`)) rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 40000);
