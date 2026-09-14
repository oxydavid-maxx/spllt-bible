import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { ApiClient, BibleClient, transformBibleHtml } from '@youversion/platform-core';
import { createOfficialBibleAdapter } from '../../server/officialBibleAdapter';
import { BibleBookSchema } from '../../node_modules/@youversion/platform-core/src/schemas/book';
import { BibleChapterSchema } from '../../node_modules/@youversion/platform-core/src/schemas/chapter';
import { BibleVersionSchema } from '../../node_modules/@youversion/platform-core/src/schemas/version';
import { BiblePassageSchema } from '../../node_modules/@youversion/platform-core/src/schemas/passage';

const versionId = 46;
const prefix = 'ChapterContent-module__test__';
function chapterHtml(id=46, reference='1TI.1', extra='') {
  const props = { versionData: { id, local_title: 'Synthetic fixture edition', local_abbreviation: 'FIX', language: { language_tag: 'zho_tw', text_direction:'ltr' }, publisher:{name:'Synthetic publisher'}, copyright_short:{text:'Synthetic copyright',html:'<p>Synthetic copyright</p>'} }, chapterInfo: { reference:{usfm:[reference],human:'Fixture book 1',version_id:id}, copyright:{text:'Synthetic copyright'}, next:{usfm:['1TI.2'],human:'Fixture book 2',version_id:id} } };
  const flight = `8:${JSON.stringify(['$', 'Component', null, {pageProps: props}])}\n`;
  return `<html><body><div data-testid="chapter-content"><div data-vid="${id}" class="version"><div class="${prefix}chapter" data-usfm="${reference}"><div class="${prefix}label">1</div><div class="${prefix}s"><span class="${prefix}heading">Synthetic heading</span></div><div class="${prefix}p"><span class="${prefix}verse" data-usfm="${reference}.1"><span class="${prefix}label">1</span><span class="${prefix}content">Synthetic &amp; exact text.</span><span class="${prefix}note ${prefix}x"><span class="${prefix}body">Synthetic reference.</span></span></span><span class="${prefix}verse" data-usfm="${reference}.2"><span class="${prefix}label">2</span><span class="${prefix}content">Second fixture.</span></span>${extra}</div></div></div><button>Unrelated reader controls</button></div><script>self.__next_f.push(${JSON.stringify([1,flight])})</script></body></html>`;
}
function indexHtml(id=46) { return `<html><head><link rel="canonical" href="https://www.bible.com/versions/${id}-fixture"></head><body><h1>Synthetic fixture edition</h1><div><h2>New Testament</h2><div><h3>Fixture book</h3><div>${[1,2].map(n=>`<a href="/bible/${id}/1TI.${n}.FIX" aria-label="Fixture book ${n}">${n}</a>`).join('')}</div></div></div></body></html>`; }
function fixture(options: Record<string,unknown> = {}) {
  const fetcher = vi.fn(async (url:string, init?: RequestInit) => new Response(url.includes('/versions/') ? indexHtml(Number(url.split('/').at(-1))) : chapterHtml(Number(url.split('/')[4])), {status:200,headers:{'content-type':'text/html'}}));
  const handle = createOfficialBibleAdapter({fetcher,...options});
  return {fetcher,handle,get: async(path:string):Promise<any>=>handle({method:'GET',url:path,headers:{authorization:'DO_NOT_FORWARD',cookie:'DO_NOT_FORWARD','x-yvp-app-key':'public-app-key-fixture'}})};
}
describe('official Bible SSR adapter',()=>{
  it('sets a thirty minute public cache lifetime only on successful Bible JSON responses',async()=>{
    const success=fixture();
    const ok=await success.get('/v1/bibles/46/passages/1TI.1');
    expect(ok.headers['cache-control']).toBe('public, max-age=1800');

    const failed=fixture({fetcher:async()=>new Response('upstream failure',{status:500})});
    const error=await failed.get('/v1/bibles/46/passages/1TI.1');
    expect(error.headers['cache-control']).toBe('no-store');

    const css=await success.handle({method:'GET',url:'/v1/fonts/1/stylesheet',headers:{}});
    expect(css?.raw).toBe(true);
    expect(css?.headers['cache-control']).toBe('no-store');
  });

  it('preserves official joined-verse spans once, including poetry continuations and SDK anchors',async()=>{
    const joined=`<span class="${prefix}verse" data-usfm="1TI.1.3+1TI.1.4"><span class="${prefix}label">3-4</span><span class="${prefix}content">Joined first.</span><span class="${prefix}note"><span class="${prefix}body">Joined note.</span></span></span></div><div class="${prefix}q1"><span class="${prefix}verse" data-usfm="1TI.1.3+1TI.1.4"><span class="${prefix}content">Joined continuation.</span></span>`;
    const f=fixture({fetcher:async(url:string)=>new Response(url.includes('/versions/')?indexHtml():chapterHtml(46,'1TI.1',joined))});
    const r=await f.get('/v1/bibles/46/passages/1TI.1');expect(r.status).toBe(200);
    const source=chapterHtml(46,'1TI.1',joined);const original=parseHTML(source).document.querySelector('[data-usfm="1TI.1"]')!.textContent;
    expect(parseHTML(r.body.content).document.textContent??parseHTML('<html><body>'+r.body.content+'</body></html>').document.body.textContent).toBe(original);
    const html=transformBibleHtml(r.body.content,{parseHtml:(html)=>parseHTML('<html><body>'+html+'</body></html>').document as unknown as Document,serializeHtml:doc=>doc.body.innerHTML}).html;
    const doc=parseHTML('<html><body>'+html+'</body></html>').document;
    expect([...doc.querySelectorAll('.yv-v[v="3-4"]')].map(n=>n.textContent).join('')).toContain('Joined continuation.');
    expect(doc.querySelector('[data-verse-footnote="3-4"]')?.getAttribute('data-verse-footnote-content')).toContain('Joined note.');
    const verses=await f.get('/v1/bibles/46/books/1TI/chapters/1/verses');
    expect(verses.body.data.map((v:any)=>v.id)).toEqual(['1','2','3-4']);
    for(const id of ['3','4','3-4'])expect((await f.get('/v1/bibles/46/books/1TI/chapters/1/verses/'+id)).body).toMatchObject({id:'3-4',passage_id:'1TI.1.3-4'});
    for(const ref of ['3','4','3-4','2-3']){const part=await f.get('/v1/bibles/46/passages/1TI.1.'+ref);expect(part.status).toBe(200);expect(part.body.content.match(/Joined first\./g)).toHaveLength(1);expect(part.body.content).toContain('Joined continuation.');}
    expect((await f.get('/v1/bibles/46/passages/1TI.1.5')).status).toBe(404);
  });
  it('selects a legacy hyphenated verse bridge by either member without dropping text',async()=>{
    const f=fixture({fetcher:async()=>new Response(chapterHtml(46,'1TI.1',`<span class="${prefix}verse" data-usfm="1TI.1.3-4"><span class="${prefix}content">Whole bridge.</span></span>`))});
    for(const verse of ['3','4']){const r=await f.get('/v1/bibles/46/passages/1TI.1.'+verse);expect(r.status).toBe(200);expect(r.body.content).toContain('Whole bridge.');}
  });
  it('rejects cross-chapter identities and malformed or nonconsecutive joined verse markers',async()=>{
    for(const marker of ['1TI.1.3+JHN.1.4','1TI.1.3+1TI.2.4','1TI.1.3+1TI.1.5','1TI.1.4+1TI.1.3','1TI.1.3+1TI.1.3','1TI.1.4-3','1TI.1.3+','1TI.1.999999999999999999999']){
      const f=fixture({fetcher:async()=>new Response(chapterHtml(46,'1TI.1',`<span class="${prefix}verse" data-usfm="${marker}">Invalid fixture.</span>`))});
      expect((await f.get('/v1/bibles/46/passages/1TI.1')).status).toBe(502);
    }
  });
  it('preserves an official Psalm descriptive title outside verse markers',async()=>{
    const title=`<div class="${prefix}d">Synthetic Psalm title.</div>`;
    const f=fixture({fetcher:async()=>new Response(chapterHtml(46,'1TI.1',title))});
    expect((await f.get('/v1/bibles/46/passages/1TI.1')).body.content).toContain('Synthetic Psalm title.');
  });

  it('preserves whitespace-only continuation spans when the same verse has actual text',async()=>{const f=fixture({fetcher:async()=>new Response(chapterHtml(46,'1TI.1',`<span class="${prefix}verse" data-usfm="1TI.1.1"><span class="${prefix}content"> </span></span>`))});expect((await f.get('/v1/bibles/46/passages/1TI.1')).status).toBe(200);});
  it('accepts the official localized canonical version URL but rejects a different owner',async()=>{
    for(const id of [46,40]){const f=fixture({fetcher:async()=>new Response(indexHtml().replace('https://www.bible.com/versions/46-','https://www.bible.com/zh-TW/versions/'+id+'-'))});expect((await f.get('/v1/bibles/46/books')).status).toBe(id===46?200:502);}
  });
  it('returns null outside the adapter and rejects non-curated versions without upstream calls',async()=>{const f=fixture();expect(await f.get('/api/me')).toBeNull();expect((await f.get('/v1/bibles/99')).status).toBe(404);expect(f.fetcher).not.toHaveBeenCalled();});
  it('returns truthful version metadata and complete official chapter indexes in SDK envelopes',async()=>{const f=fixture();const version=await f.get('/v1/bibles/46');expect(version.status).toBe(200);expect(version.body).toMatchObject({id:46,title:'Synthetic fixture edition',copyright:'Synthetic copyright',books:['1TI']});const books=await f.get('/v1/bibles/46/books');expect(books.body).toMatchObject({data:[{id:'1TI',title:'Fixture book',full_title:'Fixture book',canon:'new_testament',chapters:[{id:'1',passage_id:'1TI.1',title:'1'},{id:'2',passage_id:'1TI.2',title:'2'}]}],next_page_token:null});BibleBookSchema.parse(books.body.data[0]);BibleVersionSchema.parse(version.body);});
  it('normalizes website verses/notes into actual SDK interactive markup while preserving fixture text',async()=>{const f=fixture();const result=await f.get('/v1/bibles/46/passages/1TI.1?format=html&include_headings=true&include_notes=true');expect(result.status).toBe(200);BiblePassageSchema.parse(result.body);const resultHtml=transformBibleHtml(result.body.content,{parseHtml:(html)=>parseHTML('<html><body>'+html+'</body></html>').document as unknown as Document,serializeHtml:(doc)=>doc.body.innerHTML}).html;const doc=parseHTML(`<html><body>${resultHtml}</body></html>`).document;expect(doc.querySelector('.yv-v[v="1"]')?.textContent).toContain('Synthetic & exact text.');expect(doc.querySelector('.yv-vlbl')?.textContent).toContain('1');expect(doc.querySelector('[data-verse-footnote]')).not.toBeNull();expect(result.body.content).not.toContain('Unrelated reader controls');expect(result.body).toMatchObject({id:'1TI.1',reference:'Fixture book 1'});});
  it('drops scripts/events/styles/active URLs but does not rewrite text or italics',async()=>{const f=fixture({fetcher:async(url:string)=>new Response(url.includes('/versions/')?indexHtml():chapterHtml(46,'1TI.1','<script>attack()</script><img src=x onerror=attack()><span class="'+prefix+'it" onclick="attack()" style="background:url(javascript:attack())">Literal &lt;tag&gt;</span><a href="javascript:attack()">safe label</a>'))});const r=await f.get('/v1/bibles/46/passages/1TI.1');expect(r.body.content).not.toMatch(/script|onerror|onclick|style=|javascript:/i);expect(r.body.content).toContain('Literal &lt;tag&gt;');expect(r.body.content).toContain('safe label');});
  it('fails closed on wrong version/reference or missing official metadata/content',async()=>{for(const html of [chapterHtml(40),chapterHtml(46,'JHN.3'),'<html>not a chapter</html>']){const f=fixture({fetcher:async()=>new Response(html)});expect((await f.get('/v1/bibles/46/passages/1TI.1')).status).toBe(502);}});
  it('does not fall back to another version or turn upstream errors into empty success',async()=>{for(const status of [404,403,429,500]){const f=fixture({fetcher:async()=>new Response('upstream failure',{status})});const r=await f.get('/v1/bibles/46/passages/1TI.1');expect(r.status).toBe(502);expect(JSON.stringify(r.body)).not.toContain('upstream failure');}});
  it('never forwards authentication/key/cookies to bible.com and rejects redirects',async()=>{const f=fixture();await f.get('/v1/bibles/46/passages/1TI.1');const [url,init]=f.fetcher.mock.calls[0];expect(url).toBe('https://www.bible.com/bible/46/1TI.1');expect(init?.redirect).toBe('error');expect(Object.keys(init?.headers??{})).toEqual(['accept']);const g=fixture({fetcher:async()=>new Response(null,{status:302,headers:{location:'https://untrusted.example/'}})});expect((await g.get('/v1/bibles/46/passages/1TI.1')).status).toBe(502);});
  it('validates paths/query inputs before making bounded official requests',async()=>{const f=fixture();for(const p of ['/v1/bibles/46/passages/..%2Fsecrets','/v1/bibles/46/passages/https:%2F%2Fevil.example','/v1/bibles/46/passages/1TI.1?format=exe'])expect((await f.get(p)).status).toBe(400);expect(f.fetcher).not.toHaveBeenCalled();});
  it('coalesces concurrent chapter reads and evicts expired cached data',async()=>{let now=0;const f=fixture({now:()=>now,cacheTtlMs:10});await Promise.all([f.get('/v1/bibles/46/passages/1TI.1'),f.get('/v1/bibles/46/passages/1TI.1')]);expect(f.fetcher).toHaveBeenCalledTimes(1);now=11;await f.get('/v1/bibles/46/passages/1TI.1');expect(f.fetcher).toHaveBeenCalledTimes(2);});
  it('rejects oversized content and times out a hanging upstream',async()=>{const f=fixture({maxResponseBytes:80});expect((await f.get('/v1/bibles/46/passages/1TI.1')).status).toBe(502);const g=fixture({timeoutMs:5,fetcher:async()=>new Promise(()=>{})});expect((await g.get('/v1/bibles/46/passages/1TI.1')).status).toBe(504);});
  it('serves single books/chapters/verse indexes from confirmed official content',async()=>{const f=fixture();expect((await f.get('/v1/bibles/46/books/1TI')).body.id).toBe('1TI');const r=await f.get('/v1/bibles/46/books/1TI/chapters/1');BibleChapterSchema.parse(r.body);expect(r.body.verses.map((v:any)=>v.passage_id)).toEqual(['1TI.1.1','1TI.1.2']);expect((await f.get('/v1/bibles/46/books/NOO')).status).toBe(404);});

  it('supports the real SDK production client GET contract without a Reader hook override',async()=>{
    const f=fixture();const seen:string[]=[];
    vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{seen.push(url);const result=await f.handle({method:init?.method??'GET',url});return new Response(JSON.stringify(result?.body),{status:result?.status,headers:result?.headers});});
    try{const client=new BibleClient(new ApiClient({appKey:'synthetic-app-key',apiHost:'adapter.fixture'}));const version=await client.getVersion(46);BibleVersionSchema.parse(version);const books=await client.getBooks(46);BibleBookSchema.parse(books.data[0]);const passage=await client.getPassage(46,'1TI.1','html',true,true,false);BiblePassageSchema.parse(passage);expect(passage.content).toContain('class="yv-v"');expect(seen.every(u=>u.startsWith('https://adapter.fixture/v1/bibles/46'))).toBe(true);}finally{vi.unstubAllGlobals();}
  });

  it('passes only required AppKey to the fixed ancillary origin and returns stylesheet as CSS',async()=>{
    const fetcher=vi.fn(async(url:string)=>new Response(url.includes('stylesheet')?'@font-face {font-family: fixture;}':JSON.stringify({id:1,slug:'fixture',family:'Untitled Serif',variants:[]}),{headers:{'content-type':url.includes('stylesheet')?'text/css':'application/json'}}));
    const f=fixture({fetcher});const font=await f.get('/v1/fonts/1');expect(font.status).toBe(200);expect(fetcher.mock.calls[0][0]).toBe('https://api.youversion.com/v1/fonts/1');const options=(fetcher.mock.calls as any)[0][1];expect(options.headers).toEqual({accept:'application/json','X-YVP-App-Key':'public-app-key-fixture'});const css=await f.get('/v1/fonts/1/stylesheet?app_key=fixture-query-key');expect(css.raw).toBe(true);expect(css.headers['content-type']).toContain('text/css');expect(css.body).toContain('@font-face');expect((await f.get('/v1/fonts/1?host=evil')).status).toBe(400);
  });

  it('allows the SDK content preflight headers without forwarding them upstream',async()=>{
    const f=fixture();const response=await f.handle({method:'OPTIONS',url:'/v1/bibles/46/books'});expect(response?.status).toBe(204);expect(response?.headers['access-control-allow-headers'].toLowerCase()).toContain('x-yvp-installation-id');expect(response?.headers['access-control-allow-headers'].toLowerCase()).toContain('accept-language');expect(f.fetcher).not.toHaveBeenCalled();
  });
});
