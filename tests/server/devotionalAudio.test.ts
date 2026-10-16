import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createDevotionalAudio, latestDevotionalDate, readAzureSpeechConfig, warmDevotionalAudio } from '../../server/devotionalAudio';

const mp3 = new Uint8Array([0xff, 0xf3, 0x64, 0xc4, 1, 2, 3, 4]);
const POST = '📖🌾 《 測試題目 》\n2026.10.16 (五) 讀經：彼前5、詩118\n背誦經文：\n彼得前書 5:2 測試甲。\n5:7 測試乙。\n默想經文：\n測試默想。\n用經文禱告：\n測試禱告。\nhttps://youtu.be/abcdefghijk';
const resources: Array<() => void> = [];
afterEach(() => resources.splice(0).reverse().forEach(f => f()));
function setup(fetchImpl = vi.fn(async () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } }))) {
  const dir = mkdtempSync(join(tmpdir(), 'qm-devotion-audio-'));
  resources.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '20261016.txt'), POST);
  const db = createDatabase({ members: [{ id: 'member', displayName: '測試', groupId: 'g' }] });
  resources.push(() => db.close());
  const audioOptions = { config: { key: 'synthetic-key', region: 'eastasia' }, cacheDir: join(dir, '.audio'), fetchImpl };
  const audio = createDevotionalAudio(audioOptions);
  const options = { db, fixtureToken: 'test-token', fixtureDefaultMemberId: 'member', devotionalDir: dir, songTitle: vi.fn(async () => null), devotionalAudio: audio };
  const api = createApiHandler(options);
  const request = (index = 0, voice = 'zh-TW-YunJheNeural') => ({ method: 'GET', url: `/api/devotional/2026-10-16/audio/${index}?voice=${voice}`, headers: { authorization: 'Bearer test-token' } });
  return { dir, api, request, fetchImpl, options, audioOptions };
}

describe('private devotional audio API', () => {
  it('requires sign-in even for cached audio; no configuration is 404', async () => {
    const f = setup();
    expect((await f.api({ ...f.request(), headers: {} })).status).toBe(401);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect((await createApiHandler({ ...f.options, devotionalAudio: undefined })(f.request())).status).toBe(404);
    await f.api(f.request());
    expect((await f.api({ ...f.request(), headers: {} })).status).toBe(401);
  });
  it('synthesizes once for duplicate concurrent requests, persists mp3 across provider recreation and varies the voice', async () => {
    const f = setup();
    const responses = await Promise.all([f.api(f.request()), f.api(f.request())]);
    for (const r of responses) {
      expect(r.status).toBe(200); expect(r.binaryBody).toEqual(mp3);
      expect(r.headers).toMatchObject({ 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' });
    }
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    const restart = createApiHandler({ ...f.options, devotionalAudio: createDevotionalAudio(f.audioOptions) });
    expect((await restart(f.request())).binaryBody).toEqual(mp3);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect((await restart(f.request(0, 'zh-TW-HsiaoChenNeural'))).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = f.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'synthetic-key', 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' });
    expect(new Headers(init.headers).get('User-Agent')).toBeTruthy();
    expect(init.body).toContain('彼得前書第五章。測試甲。');
    expect(f.options.songTitle).not.toHaveBeenCalled();
  });
  it('serializes F0 calls including body consumption, then continues after upstream failure', async () => {
    let active = 0, peak = 0;
    const fetchImpl = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      return new Response(new ReadableStream({ start(controller) {
        setTimeout(() => { controller.enqueue(mp3); active--; controller.close(); }, 10);
      } }), { headers: { 'content-type': 'audio/mpeg' } });
    });
    const f = setup(fetchImpl);
    await Promise.all([f.api(f.request(0)), f.api(f.request(1)), f.api(f.request(2))]);
    expect(peak).toBe(1); expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each([401, 429, 500])('maps Azure %s to a safe upstream error, never session expiry, and retries next time', async status => {
    const f = setup(vi.fn(async () => new Response('PRIVATE UPSTREAM DETAIL', { status })));
    const r = await f.api(f.request());
    expect(r.status).toBe(502); expect(r.body).toMatchObject({ error: { code: 'DEVOTIONAL_AUDIO_UPSTREAM' } });
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
    await f.api(f.request()); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid voice/index/date, and invalidates audio when the post is corrected', async () => {
    const f = setup();
    expect((await f.api(f.request(999))).status).toBe(404);
    expect((await f.api(f.request(0, 'not-a-voice'))).status).toBe(400);
    expect((await f.api({ ...f.request(), url: '/api/devotional/..%2Fsecret/audio/0' })).status).toBe(400);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await f.api(f.request());
    writeFileSync(join(f.dir, '20261016.txt'), POST.replace('測試甲', '更正文字'));
    await f.api(f.request());
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('escapes SSML text and handles transport failure without poisoning the queue', async () => {
    const f = setup(vi.fn().mockRejectedValueOnce(new Error('private details')).mockResolvedValue(new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } })));
    writeFileSync(join(f.dir, '20261016.txt'), POST.replace('測試甲', 'A < B & C > D'));
    expect((await f.api(f.request())).status).toBe(502);
    expect((await f.api(f.request())).status).toBe(200);
    expect((f.fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body).toContain('A &lt; B &amp; C &gt; D');
  });
  // 2026-10-16: Azure answers only after a whole paragraph is spoken (11 s for the first one), past the app's
  // 8 s wait, so every paragraph fell back to the phone's voice. A saved post is synthesized ahead of time.
  it('warms every paragraph of a day in both voices, default voice first, so listening is a cache read', async () => {
    const f = setup();
    const logs: string[] = [];
    expect(await warmDevotionalAudio(f.options.devotionalAudio, f.dir, '2026-10-16', line => logs.push(line))).toEqual({ units: 4, ready: 8, failed: 0 });
    const voices = f.fetchImpl.mock.calls.map(call => /name="([^"]+)"/.exec(String((call as unknown as [string, RequestInit])[1].body))?.[1]);
    expect(voices).toEqual([...Array(4).fill('zh-TW-YunJheNeural'), ...Array(4).fill('zh-TW-HsiaoChenNeural')]);
    expect(logs).toEqual(['DEVOTIONAL_AUDIO_WARMED date=2026-10-16 units=4 ready=8 failed=0']);
    for (const voice of ['zh-TW-YunJheNeural', 'zh-TW-HsiaoChenNeural']) {
      for (let index = 0; index < 4; index++) expect((await f.api(f.request(index, voice))).status).toBe(200);
    }
    expect(f.fetchImpl).toHaveBeenCalledTimes(8);
  });
  it('warming counts a failed paragraph and keeps going; a day without a post asks Azure nothing', async () => {
    const f = setup(vi.fn().mockRejectedValueOnce(new Error('private details')).mockImplementation(async () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } })));
    const logs: string[] = [];
    expect(await warmDevotionalAudio(f.options.devotionalAudio, f.dir, '2026-10-16', line => logs.push(line))).toEqual({ units: 4, ready: 7, failed: 1 });
    expect(logs.join('\n')).not.toContain('private');
    expect(await warmDevotionalAudio(f.options.devotionalAudio, f.dir, '2026-10-17', () => undefined)).toEqual({ units: 0, ready: 0, failed: 0 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(8);
  });
  it('the newest post on or before today is the one warmed when the server starts', () => {
    const f = setup();
    writeFileSync(join(f.dir, '20261014.txt'), POST);
    writeFileSync(join(f.dir, '20261018.txt'), POST);
    writeFileSync(join(f.dir, 'notes.txt'), POST);
    expect(latestDevotionalDate(f.dir, '2026-10-17')).toBe('2026-10-16');
    expect(latestDevotionalDate(f.dir, '2026-10-15')).toBe('2026-10-14');
    expect(latestDevotionalDate(f.dir, '2026-10-01')).toBeNull();
    expect(latestDevotionalDate(join(f.dir, 'missing'), '2026-10-17')).toBeNull();
  });
  it('serves a prepared paragraph at once even while Azure is busy with another one', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      if (String(init.body).includes('測試默想')) await slow;
      return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
    });
    const f = setup(fetchImpl as never);
    expect((await f.api(f.request(0))).status).toBe(200);
    const busy = f.api(f.request(2));
    try {
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      const prepared = await Promise.race([f.api(f.request(0)), new Promise<'queued'>(resolve => setTimeout(() => resolve('queued'), 500))]);
      expect(prepared === 'queued' ? prepared : prepared.status, 'a prepared paragraph does not queue behind Azure').toBe(200);
    } finally { release(); }
    expect((await busy).status).toBe(200);
  });
  it('logs how long each audio request took, without any of its text', async () => {
    const f = setup();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(String(line)); });
    try {
      await f.api(f.request(1)); await f.api(f.request(1));
      await f.api(f.request(999));
    } finally { spy.mockRestore(); }
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^DEVOTIONAL_AUDIO_REQUEST date=2026-10-16 index=1 voice=zh-TW-YunJheNeural status=200 source=azure ms=\d+$/);
    expect(lines[1]).toMatch(/ status=200 source=cache ms=\d+$/);
    expect(lines[2]).toMatch(/ index=999 .*status=404 source=none ms=\d+$/);
    expect(lines.join('\n')).not.toMatch(/測試/);
  });
  it('loads only a valid optional secret file, including a UTF-8 BOM', () => {
    const f = setup(), path = join(f.dir, 'speech.json');
    expect(readAzureSpeechConfig(undefined)).toBeNull();
    expect(readAzureSpeechConfig(path)).toBeNull();
    writeFileSync(path, '\uFEFF' + JSON.stringify({ key: 'fake', region: 'eastasia' }));
    expect(readAzureSpeechConfig(path)).toEqual({ key: 'fake', region: 'eastasia' });
    for (const value of ['bad json', '[]', '{"key":"fake","region":"evil.invalid/path"}', '{"region":"eastasia"}']) {
      writeFileSync(path, value); expect(readAzureSpeechConfig(path)).toBeNull();
    }
  });
});
