import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { buildReaderDomBridge } from '../../src/ui/readerSettingsBridge';
import { parseAssignedVerseRange } from '../../src/domain/partialChapter';
import { readerChrome, readerSdkStyles, sdkTransformScript } from '../helpers/readerBrowser';

const recording = JSON.parse(readFileSync('tests/fixtures/partial-chapter-psa119.json', 'utf8'));
const INSETS = { top: 24, bottom: 32 };
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const range = (ref: string, key: string) => ({ ...parseAssignedVerseRange(ref)!, key });

it('filters the real recorded Psalm after SDK transformation, restores the chapter, and resets on day/content changes', () => {
  const { css, mainClass } = readerSdkStyles();
  const script = `
    window.ReactNativeWebView={postMessage:function(raw){messages.push(JSON.parse(raw));}};
    var messages=[], snaps={}, root=document.documentElement, main=document.querySelector('main'), renderer=document.querySelector('[data-slot]');
    var original=${json(recording.content)};
    function render(html){renderer.innerHTML=window.transformRecordedPassage(html);}
    function setRange(value){if(value)root.setAttribute('data-qingmu-passage-range',JSON.stringify(value));else root.removeAttribute('data-qingmu-passage-range');}
    function visible(el){return el && el.getClientRects().length>0 && getComputedStyle(el).display!=='none';}
    function lum(c){return c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);}
    function colors(el){var fg=getComputedStyle(el).color,p=el,bg=getComputedStyle(p).backgroundColor;while(bg==='rgba(0, 0, 0, 0)'&&p.parentElement){p=p.parentElement;bg=getComputedStyle(p).backgroundColor;}var f=lum(fg),b=lum(bg);return {foreground:fg,background:bg,contrast:(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05)};}
    function snap(name){
      var units=Array.from(renderer.querySelectorAll('.yv-v[v]'));
      var shown=units.filter(visible), head=document.querySelector('[data-qingmu-range-head]'), tail=document.querySelector('[data-qingmu-range-tail]');
      var buttons=Array.from(document.querySelectorAll('[data-qingmu-range-control]')).filter(visible);
      snaps[name]={verses:shown.map(el=>el.getAttribute('v')), firstText:shown[0]?.textContent,
        headings:Array.from(renderer.querySelectorAll('.s.yv-h')).filter(visible).map(el=>el.textContent),
        emptyParagraphs:Array.from(renderer.querySelectorAll('.q1,.q2,.p')).filter(el=>visible(el)&&!Array.from(el.querySelectorAll('.yv-v[v]')).some(visible)).length,
        head:visible(head)?head.textContent:null,tail:visible(tail)?tail.textContent:null,
        firstTop:shown[0]?.getBoundingClientRect().top, scrollTop:main.scrollTop,
        width:main.clientWidth,scrollWidth:main.scrollWidth,
        buttons:buttons.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,...colors(el)})),
        textColors:[head,tail].filter(visible).map(colors),
        notice:document.querySelector('[data-qingmu-range-audio]')?.textContent||null,
        collapses:messages.filter(m=>m.type==='qingmu.reader.canvas.scroll').length};
    }
    render(original);setRange(${json(range('PSA.119.89-176', 'day15'))});
    ${buildReaderDomBridge(true, true, INSETS)}
    var steps=[
      function(){snap('second');document.querySelector('[data-qingmu-range-control]')?.click();},
      function(){snap('whole');main.scrollTop=400;setRange(${json(range('PSA.119.1-88', 'day16'))});},
      function(){snap('first');main.scrollTop=main.scrollHeight;main.dispatchEvent(new Event('scroll'));},
      function(){snap('end');document.querySelector('[data-qingmu-range-control]')?.click();},
      function(){snap('wholeFromTail');setRange(${json(range('PSA.119.89-176', 'day17'))});},
      function(){snap('sameChapterNewDay');render(original);},
      function(){snap('replacedDom');renderer.remove();},
      function(){snap('loading');main.appendChild(renderer);},
      function(){snap('remounted');setRange(null);},
      function(){snap('unrestricted');setRange(${json(range('PSA.119.6', 'merged'))});render('<div class="chapter"><div class="s yv-h">Outside</div><div class="p"><span class="yv-v" v="1"></span>one</div><div class="s yv-h">Inside</div><div class="p"><span class="yv-v" v="5-6"></span>combined</div><div class="p"><span class="yv-v" v="7"></span>seven</div></div>');},
      function(){snap('merged');root.setAttribute('data-qingmu-passage-audio-notice','這段錄音沒有分節，會從頭播整章');},
      // On the phone (2026-10-16) the SDK wraps verse 88's whitespace-only continuation as its own unit, after
      // the heading of verse 89; that heading belongs to 89 and must hide with it.
      function(){snap('notice');setRange(${json(range('PSA.119.1-88', 'tailHeading'))});renderer.innerHTML='<div class="chapter"><div class="q1"><span class="yv-v" v="88"><span class="yv-vlbl">88\\u00a0</span><span class="content">eighty-eight</span></span></div><div class="s yv-h"><span class="yv-h">Next section</span></div><div class="q1"><span class="yv-v" v="88"><span class="content">\\u00a0\\u00a0</span></span><span class="yv-v" v="89"><span class="yv-vlbl">89\\u00a0</span><span class="content">eighty-nine</span></span></div></div>';},
      function(){snap('tailHeading');snaps.tailHeading.blankUnits=Array.from(renderer.querySelectorAll('.yv-v[v]')).filter(el=>!/\\S/.test(el.textContent)).length;}
    ];var i=0;
    function next(){if(i<steps.length){steps[i++]();setTimeout(next,70);}else{document.getElementById('result').textContent=JSON.stringify({snaps:snaps,messages:messages});}}
    var capture=new URLSearchParams(location.search).get('capture');
    if(capture==='first-end'){setRange(${json(range('PSA.119.1-88', 'day16'))});setTimeout(function(){main.scrollTop=main.scrollHeight;},200);}
    else if(capture==='whole'){setTimeout(function(){document.querySelector('[data-qingmu-range-control]').click();main.scrollTop=0;},200);}
    else if(!capture)setTimeout(next,100);
  `;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{height:100%;margin:0}[data-yv-sdk]{height:100%;background:#fff}#result{display:none}</style></head><body><div data-yv-sdk data-yv-theme="light"><main class="${mainClass}"><section data-slot="yv-bible-renderer"></section></main></div><pre id="result"></pre><script>${sdkTransformScript()}</script><script>${script}</script></body></html>`;
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'qingmu-partial-'));
  try {
    const page = join(work, 'reader.html'); writeFileSync(page, html);
    const output = execFileSync(readerChrome(), ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${join(work, 'profile')}`, '--window-size=390,844', '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    const raw = output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(raw, 'Chromium must execute the SDK transform and reader bridge').toBeDefined();
    const proof = JSON.parse(raw!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'));
    if (process.env.QINGMU_PARTIAL_PROOF_DIR) {
      mkdirSync(process.env.QINGMU_PARTIAL_PROOF_DIR, { recursive: true });
      writeFileSync(join(process.env.QINGMU_PARTIAL_PROOF_DIR, 'browser-result.json'), JSON.stringify(proof, null, 2));
      writeFileSync(join(process.env.QINGMU_PARTIAL_PROOF_DIR, 'browser.html'), html);
    }
    const s = proof.snaps;
    expect(s.second.verses.length).toBeGreaterThan(88);
    expect(s.second.verses.every((v: string) => Number(v) >= 89 && Number(v) <= 176)).toBe(true);
    expect(s.second.firstText).toContain('89');
    expect(s.second.head).toBe('詩篇 119:89–176 · 看整章'); expect(s.second.tail).toBeNull();
    expect(s.second.headings).toEqual(s.whole.headings.slice(11)); expect(s.second.emptyParagraphs).toBe(0);
    expect(s.second.firstTop).toBeGreaterThanOrEqual(INSETS.top); expect(s.second.firstTop).toBeLessThan(200);
    expect(s.whole.verses).toContain('1'); expect(s.whole.verses).toContain('176'); expect(s.whole.head).toBeNull();
    expect(s.whole.collapses, 'restoring surrounding text is not a finger scroll').toBe(0);
    expect(s.first.verses.every((v: string) => Number(v) <= 88)).toBe(true);
    expect(s.first.verses).toContain('88'); expect(s.first.head).toBeNull();
    expect(s.first.tail).toBe('今天讀到第 88 節看整章 ›'); expect(s.first.emptyParagraphs).toBe(0);
    expect(s.first.headings).toEqual(s.whole.headings.slice(0, 11)); expect(s.first.scrollTop).toBe(0);
    expect(s.wholeFromTail.verses).toContain('176');
    for (const name of ['sameChapterNewDay', 'replacedDom', 'remounted']) expect(s[name].verses).toEqual(s.second.verses);
    expect(s.loading.head).toBeNull(); expect(s.loading.tail).toBeNull();
    expect(s.unrestricted.verses).toEqual(s.whole.verses);
    expect(s.merged.verses).toEqual(['5-6']); expect(s.merged.headings).toEqual(['Inside']); expect(s.merged.emptyParagraphs).toBe(0);
    expect(s.notice.notice).toBe('這段錄音沒有分節，會從頭播整章');
    expect(s.tailHeading.blankUnits, 'the phone\'s DOM keeps verse 88\'s blank continuation as its own unit').toBe(1);
    expect(s.tailHeading.headings, 'the next section\'s heading after the last assigned verse').toEqual([]);
    expect(s.tailHeading.emptyParagraphs, 'no blank line left where verse 88\'s continuation sat').toBe(0);
    expect(s.tailHeading.tail).toBe('今天讀到第 88 節看整章 ›');
    for (const name of ['second', 'first']) {
      expect(s[name].scrollWidth).toBe(s[name].width);
      for (const button of s[name].buttons) { expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); expect(button.contrast).toBeGreaterThanOrEqual(4.5); }
      for (const text of s[name].textColors) expect(text.contrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(proof.messages.some((m: any) => m.type === 'qingmu.reader.canvas.edge' && m.data.atEnd)).toBe(true);
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 60000);
