import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Chapter = { id:string; passage_id:string; title:string; verses?:Verse[] };
type Verse = { id:string; passage_id:string; title:string };
type Book = { id:string; title:string; full_title:string; canon:'old_testament'|'new_testament'; chapters:Chapter[] };
type Metadata = { id:number; title:string; abbreviation:string; languageTag:string; publisher:string; copyright:string; sourceUrl:string };
type Page = { metadata:Metadata; reference:string; chapter:string; root:Element; verses:Verse[] };
export interface OfficialBibleRequest { method:string; url:string; headers?:Record<string,string|undefined> }
export interface OfficialBibleResponse { status:number; body:unknown; headers:Record<string,string>; raw?:boolean }
export interface OfficialBibleAdapterOptions {
  fetcher?: (url:string, init?:RequestInit)=>Promise<Response>;
  now?:()=>number; timeoutMs?:number; maxResponseBytes?:number; cacheTtlMs?:number; maxCacheEntries?:number; maxInflight?:number;
}
const VERSIONS = [46,40,111,406,114] as const;
const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS', 'access-control-allow-headers':'Accept, Accept-Language, Content-Type, X-YVP-App-Key, X-YVP-Installation-Id, X-YVP-SDK, X-YVP-SDK-Version', 'cache-control':'no-store' };
const children = (n:Node):Node[] => 'childNodes' in n ? n.childNodes : [];
const element = (n:Node): n is Element => 'tagName' in n;
const attr = (n:Node,name:string):string|undefined => element(n) ? n.attrs.find(a=>a.name===name)?.value : undefined;
const text = (n:Node):string => n.nodeName === '#text' ? (n as DefaultTreeAdapterMap['textNode']).value : children(n).map(text).join('');
function findAll(n:Node,predicate:(n:Element)=>boolean):Element[] { const result:Element[]=[]; const walk=(current:Node)=>{if(element(current)&&predicate(current))result.push(current);children(current).forEach(walk);};walk(n);return result; }
const escape = (value:string):string => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const classes = (n:Node):string[] => (attr(n,'class')??'').split(/\s+/).map(c=>c.replace(/^ChapterContent-module__[A-Za-z0-9_-]+?__/,'')).filter(Boolean);
class AdapterError extends Error { constructor(readonly status:number,readonly code:string){super(code);} }
const fail = (code='OFFICIAL_SOURCE_INVALID'):never => {throw new AdapterError(502,code);};
const required = (v:unknown):string => typeof v==='string'&&v.trim()&&!/^\$[a-f0-9]+$/i.test(v)?v:fail();

// Decode the inert JSON argument emitted by Next's server renderer, never eval JS.
// Only the bounded pageProps object is consumed; React's text/reference records
// are deliberately not interpreted or executed.
function pageProps(document:Node):Record<string,any> {
  let flight='';
  for(const script of findAll(document,n=>n.tagName==='script')) {
    const match=text(script).match(/^self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?$/);
    if(!match)continue;
    let payload:unknown;try{payload=JSON.parse(match[1]);}catch{continue;}
    if(Array.isArray(payload)&&payload[0]===1&&typeof payload[1]==='string')flight+=payload[1];
  }
  const key='"pageProps":'; const keyAt=flight.lastIndexOf(key);
  if(keyAt<0) return fail();
  let start=keyAt+key.length;while(/\s/.test(flight[start]??''))start++;
  if(flight[start]!=='{')return fail();
  let depth=0, quoted=false, escaped=false;
  for(let i=start;i<flight.length;i++) {
    const c=flight[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
    else if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){try{return JSON.parse(flight.slice(start,i+1));}catch{return fail();}}
  }
  return fail();
}

// Bible.com uses repeated full references joined by "+" for one inseparable
// verse bridge (including continuation spans). Normalize only consecutive ranges;
// validate EVERY component so a joined marker cannot cross the confirmed chapter.
function verseId(usfm:string,chapter:string):string {
  let first:number|undefined, last:number|undefined;
  for(const part of usfm.split('+')) {
    if(!part.startsWith(chapter+'.'))return fail('OFFICIAL_IDENTITY_MISMATCH');
    const match=part.slice(chapter.length+1).match(/^(0|[1-9]\d{0,2})(?:-(0|[1-9]\d{0,2}))?$/);
    if(!match)return fail('OFFICIAL_VERSE_FORMAT_UNSUPPORTED');
    const start=Number(match[1]),end=Number(match[2]??match[1]);
    if(end<start||(last!==undefined&&start!==last+1))return fail('OFFICIAL_VERSE_FORMAT_UNSUPPORTED');
    first??=start;last=end;
  }
  return first===last?String(first):`${first}-${last}`;
}
const intersectsVerse=(id:string,start:number,end:number):boolean=>{const [a,b=a]=id.split('-').map(Number);return a<=end&&b>=start;};

function parseChapter(html:string,id:number,chapter:string):Page {
  const document=parse(html); const props=pageProps(document);
  const version=props.versionData, info=props.chapterInfo;
  if(version?.id!==id||info?.reference?.version_id!==id||!Array.isArray(info.reference.usfm)||info.reference.usfm.length!==1||info.reference.usfm[0]!==chapter) return fail('OFFICIAL_IDENTITY_MISMATCH');
  const hosts=findAll(document,n=>attr(n,'data-testid')==='chapter-content');
  if(hosts.length!==1)return fail();
  const owners=findAll(hosts[0],n=>attr(n,'data-vid')===String(id));
  const roots=owners.flatMap(n=>findAll(n,e=>attr(e,'data-usfm')===chapter&&classes(e).includes('chapter')));
  if(roots.length!==1)return fail('OFFICIAL_IDENTITY_MISMATCH');
  const root=roots[0]; const verseMap=new Map<string,Verse>(); const verseText=new Map<string,string>();
  for(const n of findAll(root,n=>classes(n).includes('verse'))) {
    const usfm=attr(n,'data-usfm')??'';
    const number=verseId(usfm,chapter);
    verseText.set(number,(verseText.get(number)??'')+text(n));
    verseMap.set(number,{id:number,passage_id:`${chapter}.${number}`,title:number});
  }
  if(!verseMap.size||[...verseText.values()].some(value=>!value.trim()))return fail('OFFICIAL_CONTENT_MISSING');
  const sourceUrl=`https://www.bible.com/bible/${id}/${chapter}`;
  const metadata:Metadata={id,title:required(version.local_title),abbreviation:required(version.local_abbreviation),languageTag:required(version.language?.iso_639_1??version.language?.language_tag).replace('_','-'),publisher:required(version.publisher?.name),copyright:required(info.copyright?.text??version.copyright_short?.text),sourceUrl};
  return {metadata,reference:required(info.reference.human),chapter,root,verses:[...verseMap.values()]};
}

function parseIndex(html:string,id:number):Book[] {
  const document=parse(html);
  const canonical=findAll(document,n=>n.tagName==='link'&&attr(n,'rel')==='canonical').some(n=>{try{const u=new URL(attr(n,'href')??'');return u.origin==='https://www.bible.com'&&new RegExp(`^/(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*/)?versions/${id}(?:-|$)`).test(u.pathname);}catch{return false;}});
  if(!canonical)return fail('OFFICIAL_INDEX_IDENTITY_MISMATCH');
  const books=new Map<string,Book>();
  for(const a of findAll(document,n=>n.tagName==='a'&&Boolean(attr(n,'aria-label')))) {
    const href=attr(a,'href')??'';
    const match=href.match(new RegExp(`^/bible/${id}/([A-Z0-9]{3})\\.([1-9][0-9]{0,2})(?:\\.|$)`));
    if(!match)continue;
    const parent=a.parentNode;
    const container=parent&&'parentNode' in parent?parent.parentNode:null;
    if(!container)continue;
    const titleNode=children(container).find(n=>element(n)&&n.tagName==='h3');
    const section='parentNode' in container?container.parentNode:null;
    const sectionNode=section&&children(section).find(n=>element(n)&&n.tagName==='h2');
    if(!titleNode||!sectionNode)continue;
    const title=required(text(titleNode).trim()); const sectionText=text(sectionNode).trim();
    const canon=sectionText==='Old Testament'?'old_testament':sectionText==='New Testament'?'new_testament':null;
    if(!canon)return fail('OFFICIAL_CANON_UNSUPPORTED');
    const [,_book,number]=match; const book=books.get(_book)??{id:_book,title,full_title:title,canon,chapters:[]};
    if(book.title!==title||book.canon!==canon)return fail();
    if(!book.chapters.some(c=>c.id===number))book.chapters.push({id:number,passage_id:`${_book}.${number}`,title:required(text(a).trim())});
    books.set(_book,book);
  }
  if(!books.size)return fail('OFFICIAL_INDEX_MISSING');
  for(const book of books.values())if(book.chapters.some((c,i)=>Number(c.id)!==i+1))return fail('OFFICIAL_INDEX_INCOMPLETE');
  return [...books.values()];
}

const DROP=new Set(['script','style','iframe','object','embed','svg','math','form','input','button','textarea','select','template','link','meta','base','noscript','img','audio','video']);
const TAGS=new Set(['div','p','span','sup','sub','em','strong','i','b','small','br','section','table','thead','tbody','tr','td','th']);
const SAFE_CLASS=/^(?:chapter|book|p|m|b|pi\d*|pm\w*|q\w*|li\d*|s\d*|ms\d*|mt\d*|d|sp|r|mr|nb|cls|it|bd|bdit|em|sc|nd|wj|add|qt|sup|tl|bk|sig|ord|no|body|fr|ft|fk|fq|fqa|f|x|xo|xt|content)$/;
function renderPage(page:Page,includeHeadings:boolean,includeNotes:boolean,selected?:Set<string>):string {
  const render=(n:Node,inVerse=false):string=>{
    if(n.nodeName==='#text')return escape(text(n));
    if(!element(n))return '';
    if(DROP.has(n.tagName))return '';
    const names=classes(n); const isVerse=names.includes('verse');
    if(isVerse){const number=verseId(attr(n,'data-usfm')??'',page.chapter);if(selected&&!selected.has(number))return '';return `<span class="yv-v" v="${escape(number)}"></span>`+children(n).map(c=>render(c,true)).join('');}
    const heading=names.some(c=>/^(?:heading|s\d*|ms\d*|mt\d*|label)$/.test(c))&&!inVerse;
    if(heading&&!includeHeadings)return '';
    if(names.includes('note')&&!includeNotes)return '';
    let mapped=names.filter(c=>SAFE_CLASS.test(c));
    if(names.includes('label')&&inVerse)mapped=['yv-vlbl'];
    if(heading)mapped.push('yv-h');
    if(names.includes('note'))mapped=['yv-n','f',...(names.includes('x')?['x']:[])];
    const tag=TAGS.has(n.tagName)?n.tagName:null;
    const body=children(n).map(c=>render(c,inVerse)).join('');
    if(!tag)return body;
    const attributes=[...(mapped.length?[`class="${escape([...new Set(mapped)].join(' '))}"`]:[])];
    for(const name of ['colspan','rowspan']){const value=attr(n,name);if(value&&/^\d{1,2}$/.test(value))attributes.push(`${name}="${value}"`);}
    return `<${tag}${attributes.length?' '+attributes.join(' '):''}>${tag==='br'?'':body+`</${tag}>`}`;
  };
  return render(page.root);
}

export function createOfficialBibleAdapter(options:OfficialBibleAdapterOptions={}) {
  const fetcher=options.fetcher??fetch; const now=options.now??Date.now;
  const cache=new Map<string,{expires:number;value:unknown}>(); const inflight=new Map<string,Promise<unknown>>();
  const maxBytes=Math.max(1,Math.min(options.maxResponseBytes??4_000_000,4_000_000));
  const timeout=Math.max(1,Math.min(options.timeoutMs??12_000,15_000));
  async function request(url:string,headers:Record<string,string>={'accept':'text/html'}):Promise<{body:string;type:string}> {
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const work=(async()=>{
      const response=await fetcher(url,{method:'GET',headers,redirect:'error',signal:controller.signal});
      if(!response.ok||response.redirected)return fail('OFFICIAL_UPSTREAM_UNAVAILABLE');
      if(response.headers.has('content-length')&&Number(response.headers.get('content-length'))>maxBytes)return fail('OFFICIAL_RESPONSE_TOO_LARGE');
      const reader=response.body?.getReader();if(!reader)return fail();
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();return fail('OFFICIAL_RESPONSE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
      return {body:Buffer.concat(chunks).toString('utf8'),type:response.headers.get('content-type')??''};
    })();
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AdapterError(504,'OFFICIAL_UPSTREAM_TIMEOUT'));},timeout);})]);}finally{if(timer)clearTimeout(timer);}
  }
  async function cached<T>(key:string,load:()=>Promise<T>):Promise<T> {
    const entry=cache.get(key);if(entry&&entry.expires>now())return entry.value as T;
    cache.delete(key);const pending=inflight.get(key);if(pending)return pending as Promise<T>;
    if(inflight.size>=(options.maxInflight??8))throw new AdapterError(503,'OFFICIAL_SOURCE_BUSY');
    const work=load().then(value=>{cache.set(key,{expires:now()+Math.min(options.cacheTtlMs??1_800_000,3_600_000),value});while(cache.size>Math.min(options.maxCacheEntries??64,128))cache.delete(cache.keys().next().value!);return value;});
    inflight.set(key,work);try{return await work;}finally{inflight.delete(key);}
  }
  const chapter=(id:number,usfm:string)=>cached(`chapter:${id}:${usfm}`,async()=>parseChapter((await request(`https://www.bible.com/bible/${id}/${usfm}`)).body,id,usfm));
  const index=(id:number)=>cached(`index:${id}`,async()=>parseIndex((await request(`https://www.bible.com/versions/${id}`)).body,id));
  const version=async(id:number)=>{const [page,books]=await Promise.all([chapter(id,'1TI.1'),index(id)]);const m=page.metadata;return {id,abbreviation:m.abbreviation,localized_abbreviation:m.abbreviation,title:m.title,localized_title:m.title,language_tag:m.languageTag,books:books.map(b=>b.id),copyright:m.copyright,info:m.publisher,youversion_deep_link:`https://www.bible.com/versions/${id}`};};
  const response=(status:number,body:unknown,extra:Record<string,string>={},raw=false):OfficialBibleResponse=>({status,body,headers:{...CORS,'content-type':raw?'text/css; charset=utf-8':'application/json; charset=utf-8',...extra},...(raw?{raw:true}:{})});
  const list=(data:unknown[])=>({data,next_page_token:null});
  return async function handleOfficialBibleRequest(input:OfficialBibleRequest):Promise<OfficialBibleResponse|null> {
    let url:URL;try{url=new URL(input.url,'https://adapter.invalid');}catch{return response(400,{error:'INVALID_URL'});}
    const path=url.pathname;
    const ancillary=/^\/v1\/fonts\/1(?:\/stylesheet)?$/.test(path)||path==='/v1/languages'||/^\/v1\/languages\/[A-Za-z0-9-]+$/.test(path);
    if(!path.startsWith('/v1/bibles')&&!ancillary)return null;
    if(input.method==='OPTIONS')return response(204,null);
    if(input.method!=='GET')return response(405,{error:'METHOD_NOT_ALLOWED'});
    try{
      if(ancillary){
        const allowed=new Set(['app_key','fields[]','page_size','page_token','country']);
        if([...url.searchParams.keys()].some(k=>!allowed.has(k)))return response(400,{error:'INVALID_QUERY'});
        const appKey=Object.entries(input.headers??{}).find(([k])=>k.toLowerCase()==='x-yvp-app-key')?.[1]??url.searchParams.get('app_key');
        const upstream=new URL('https://api.youversion.com'+path);url.searchParams.forEach((v,k)=>{if(k!=='app_key')upstream.searchParams.append(k,v);});
        if(path.endsWith('/stylesheet')&&appKey)upstream.searchParams.set('app_key',appKey);
        const result=await request(upstream.toString(),{'accept':path.endsWith('/stylesheet')?'text/css':'application/json',...(appKey?{'X-YVP-App-Key':appKey}:{})});
        if(path.endsWith('/stylesheet'))return response(200,result.body,{},true);
        try{return response(200,JSON.parse(result.body));}catch{return fail('OFFICIAL_ANCILLARY_INVALID');}
      }
      for(const [key,value] of url.searchParams){if(!['format','include_headings','include_notes','fields[]','page_size','page_token','language_ranges[]'].includes(key))return response(400,{error:'INVALID_QUERY'});if(key==='format'&&!['html','text'].includes(value))return response(400,{error:'INVALID_FORMAT'});if(key.startsWith('include_')&&!['true','false'].includes(value))return response(400,{error:'INVALID_QUERY'});}
      if(path==='/v1/bibles'){
        const ranges=url.searchParams.getAll('language_ranges[]');let ids=[...VERSIONS];
        if(ranges.length&&!ranges.includes('*'))ids=ids.filter(id=>ranges.some(r=>r.toLowerCase().startsWith(id===46||id===40?'zh':'en')));
        const data=[];for(const id of ids)data.push(await version(id));return response(200,list(data));
      }
      const match=path.match(/^\/v1\/bibles\/(\d+)(?:\/(.*))?$/);if(!match)return response(400,{error:'INVALID_PATH'});
      const id=Number(match[1]);if(!(VERSIONS as readonly number[]).includes(id))return response(404,{error:'BIBLE_NOT_SUPPORTED'});
      const rest=match[2]??'';
      if(!rest)return response(200,await version(id));
      if(rest==='books')return response(200,list(await index(id)));
      if(rest.startsWith('passages/')){
        let usfm:string;try{usfm=decodeURIComponent(rest.slice(9));}catch{return response(400,{error:'INVALID_REFERENCE'});}
        const ref=usfm.match(/^([A-Z0-9]{3}\.[1-9]\d{0,2})(?:\.(\d+)(?:-(\d+))?)?$/);if(!ref)return response(400,{error:'INVALID_REFERENCE'});
        const page=await chapter(id,ref[1]);let selected:Set<string>|undefined;
        if(ref[2]){const end=Number(ref[3]??ref[2]),start=Number(ref[2]);if(end<start||end-start>199)return response(400,{error:'INVALID_REFERENCE'});selected=new Set(page.verses.filter(v=>intersectsVerse(v.id,start,end)).map(v=>v.id));if(!selected.size)return response(404,{error:'VERSE_NOT_FOUND'});}
        const html=renderPage(page,url.searchParams.get('include_headings')!=='false',url.searchParams.get('include_notes')!=='false',selected);
        const content=url.searchParams.get('format')==='text'?text(parse(html)):html;
        return response(200,{id:usfm,content,reference:page.reference+(ref[2]?':'+ref[2]+(ref[3]?'-'+ref[3]:''):'')});
      }
      const bookPath=rest.match(/^books\/([A-Z0-9]{3})(?:\/chapters(?:\/([1-9]\d{0,2})(?:\/verses(?:\/(\d+(?:-\d+)?))?)?)?)?$/);
      if(!bookPath)return response(404,{error:'BIBLE_RESOURCE_NOT_SUPPORTED'});
      const book=(await index(id)).find(b=>b.id===bookPath[1]);if(!book)return response(404,{error:'BOOK_NOT_FOUND'});
      if(rest===`books/${book.id}`)return response(200,book);
      if(!bookPath[2])return response(200,list(book.chapters));
      const current=book.chapters.find(c=>c.id===bookPath[2]);if(!current)return response(404,{error:'CHAPTER_NOT_FOUND'});
      const page=await chapter(id,current.passage_id);
      if(rest.endsWith('/verses'))return response(200,list(page.verses));
      if(bookPath[3]){const verse=page.verses.find(v=>v.id===bookPath[3]||(!bookPath[3].includes('-')&&intersectsVerse(v.id,Number(bookPath[3]),Number(bookPath[3]))));return verse?response(200,verse):response(404,{error:'VERSE_NOT_FOUND'});}
      return response(200,{...current,verses:page.verses});
    }catch(error){return error instanceof AdapterError?response(error.status,{error:error.code}):response(502,{error:'OFFICIAL_SOURCE_UNAVAILABLE'});}
  };
}
