import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { buildReaderDomBridge } from '../../src/ui/readerSettingsBridge';

// Use the installed SDK's exact generated utility stylesheet and main classes,
// then let a real Chromium engine resolve the native/app !important cascade.
// This fixture is offline and isolated from the user's browser profile. It is
// desktop Chromium proof of CSS, never Android/WebView geometry acceptance.

/**
 * A binary that still understands `--dump-dom`.
 *
 * Chrome removed the headless shell from its main binary in M132, so `--dump-dom` — which belonged
 * to the old headless implementation — silently produces nothing on a current Chrome. The installed
 * Chrome here is 153, which exits 0 and prints an empty string, and this test then failed with
 * "Chromium must execute all actual-CSS fixtures" as if the fixtures had not run. They had not been
 * asked to.
 *
 * chrome-headless-shell is the supported replacement and Playwright already ships one. Preferring
 * the newest installed shell keeps the engine roughly current without pinning a version that a
 * Playwright update would move.
 */
function resolveDumpDomBinary(): string {
  const shellRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  try {
    const builds = readdirSync(shellRoot)
      .filter((name) => name.startsWith('chromium_headless_shell-'))
      .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    for (const build of builds.reverse()) {
      for (const platform of ['chrome-headless-shell-win64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-mac-arm64']) {
        const candidate = join(shellRoot, build, platform, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* fall through to the browser path below */ }
  // No shell installed. Chrome itself will not dump anything on M132 or later, so this path exists
  // for older installs and for platforms where the browser is the shell.
  return process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome';
}
it('applies compact padding to the actual fullscreen scroll container, regardless of native style order, while preserving legacy and content', () => {
  const webSource = readFileSync('node_modules/@youversion/platform-react-ui/dist/index.js', 'utf8');
  const nativeSource = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/dom/bible-reader.js', 'utf8');
  const scrollSource = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/lib/reader-bottom-scroll-padding.js', 'utf8');
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
  expect(sdkCss).toContain('tailwindcss');
  expect(mainClass).toContain('yv:overflow-y-auto');
  const mainStart = webSource.indexOf('ref: scrollContainerRef,');
  const footerStart = webSource.indexOf('"footer"', mainStart);
  const footerClass = webSource.slice(footerStart, footerStart + 800).match(/className:\s*"([^"]+)"/)?.[1];
  expect(footerClass).toBeDefined();
  const nativeTemplate = nativeSource.match(/\[data-yv-sdk\] > main \{\s*padding-bottom: \$\{bottomScrollPadding\}px !important;\s*\}/)?.[0];
  expect(nativeTemplate).toBeDefined();
  const bottomPadding = new Function(`${scrollSource.replace(/export /g, '')}\nreturn computeReaderBottomScrollPadding;`)() as (inset: number, platform: string) => number;
  // Remote font imports are excluded; font metrics are not asserted here.
  const offlineCss = sdkCss.replace(/@import\s+(?:"[^"]*"|'[^']*')[^;]*;/g, '');
  const cases = [
    { fullscreen: false, metadata: true, platform: 'android', inset: 0, order: 'before' },
    { fullscreen: false, metadata: true, platform: 'ios', inset: 34, order: 'after' },
    { fullscreen: true, metadata: true, platform: 'android', inset: 0, order: 'before' },
    { fullscreen: true, metadata: true, platform: 'android', inset: 24, order: 'after' },
    { fullscreen: true, metadata: true, platform: 'ios', inset: 34, order: 'before' },
    { fullscreen: true, metadata: true, platform: 'ios', inset: 34, order: 'after' },
    { fullscreen: true, metadata: false, platform: 'android', inset: 0, order: 'after' },
  ];
  const frames = cases.map((scenario, index) => {
    const nativeBottom = bottomPadding(scenario.inset, scenario.platform);
    const nativeCss = nativeBottom > 0 ? nativeTemplate!.replace('${bottomScrollPadding}', String(nativeBottom)) : '';
    return `<!doctype html><html><head><meta charset="utf-8"><style>${offlineCss}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%}</style>${scenario.order === 'before' ? `<style>${nativeCss}</style>` : ''}</head><body>
      <div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><h1 id="title">Psalms 90</h1><div data-slot="yv-bible-renderer" id="passage">${'<p>Fixture scripture text remains unchanged.</p>'.repeat(35)}</div><footer id="copyright" class="${footerClass}">Fixture copyright attribution remains.</footer></main></div>
      <div data-yv-settings-shell id="sheet" style="padding:7px">Official sheet fixture</div>
      <script>window.ReactNativeWebView={postMessage:function(){}};
      var originalText=document.querySelector('main').textContent;
      ${buildReaderDomBridge(scenario.fullscreen, scenario.metadata)}
      ${scenario.order === 'after' ? `var nativeStyle=document.createElement('style');nativeStyle.textContent=${JSON.stringify(nativeCss)};document.head.appendChild(nativeStyle);` : ''}
      setTimeout(function(){
        var main=document.querySelector('main'), style=getComputedStyle(main);
        parent.postMessage({index:${index},top:style.paddingTop,bottom:style.paddingBottom,left:style.paddingLeft,right:style.paddingRight,
          titleOffset:document.getElementById('title').getBoundingClientRect().top-main.getBoundingClientRect().top,
          unchanged:main.textContent===originalText,scrolls:main.scrollHeight>main.clientHeight,overflow:style.overflowY,
          footerDisplay:getComputedStyle(document.getElementById('copyright')).display,
          sheetPadding:getComputedStyle(document.getElementById('sheet')).paddingTop},'*');
      },30);</script></body></html>`;
  });
  const encodedFrames = JSON.stringify(frames).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
    var results=[];window.addEventListener('message',function(event){if(typeof event.data.index!=='number')return;results.push(event.data);if(results.length===${cases.length})document.getElementById('result').textContent=JSON.stringify(results.sort(function(a,b){return a.index-b.index;}));});
    ${encodedFrames}.forEach(function(source){var frame=document.createElement('iframe');frame.style='width:390px;height:600px;border:0';document.body.appendChild(frame);frame.srcdoc=source;});
    </script>`;
  const temporaryRoot = realpathSync(tmpdir());
  const work = mkdtempSync(join(temporaryRoot, 'qingmu-reader-css-'));
  try {
    const page = join(work, 'fixture.html');
    writeFileSync(page, html);
    const chromePath = process.env.CHROME_PATH ?? resolveDumpDomBinary();
    const output = execFileSync(chromePath, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=2500', '--dump-dom', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(raw, 'Chromium must execute all actual-CSS fixtures').toBeDefined();
    const measured = JSON.parse(raw!) as { index: number; top: string; bottom: string; left: string; right: string; titleOffset: number; unchanged: boolean; scrolls: boolean; overflow: string; sheetPadding: string; footerDisplay: string }[];
    expect(measured).toHaveLength(cases.length);
    console.log(JSON.stringify({ sdkCssSha256: createHash('sha256').update(sdkCss).digest('hex'), mainClass, measured }));
    for (const value of measured) {
      const scenario = cases[value.index];
      expect(value.unchanged).toBe(true);
      expect(value.scrolls).toBe(true);
      expect(value.overflow).toBe('auto');
      expect(value.sheetPadding).toBe('7px');
      if (scenario.fullscreen && scenario.metadata) expect(value.footerDisplay).toBe('none');
      else expect(value.footerDisplay).not.toBe('none');
      expect(value.top).toBe(scenario.fullscreen ? '12px' : '48px');
      expect(value.bottom).toBe(scenario.fullscreen ? '12px' : `${bottomPadding(scenario.inset, scenario.platform) || 48}px`);
      expect(value.left).toBe('16px'); expect(value.right).toBe('16px');
      expect(value.titleOffset).toBe(scenario.fullscreen ? 12 : 48);
    }
  } finally {
    // Remove only this test's resolved directory under the known temp root.
    if (resolve(work).startsWith(`${temporaryRoot}\\qingmu-reader-css-`)) rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 30000);
