import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { validateCapability } from '../../src/domain/chapterAudioContract';

let db: ReturnType<typeof createDatabase>;
let api: ReturnType<typeof createApiHandler>;
let upstream: ReturnType<typeof vi.fn>;
const source = (versionId = 46, reference = 'PSA.103', patch: Record<string, unknown> = {}) => ({
  id: 1310, version_id: versionId, title: 'Test recording', default: true, dramatized: false,
  timing: [{ usfm: `${reference}.1`, start: 0 }], download_urls: { format_mp3_32k: '//media.example.test/opaque-observed.mp3' }, ...patch,
});
const answer = (data: unknown, code = 200) => new Response(JSON.stringify({ response: { code, data } }), { status: code });
const request = (versionId = 46, usfm = 'PSA.103') => api({ method: 'GET', url: `/api/content-capabilities?versionId=${versionId}&usfm=${usfm}`, headers: { authorization: 'Bearer synthetic-fixture', 'x-qingmu-member-id': 'test:a' } });
beforeEach(() => {
  upstream = vi.fn(async () => answer([source()])); vi.stubGlobal('fetch', upstream);
  db = createDatabase({ filename: ':memory:', members: [{ id: 'test:a', displayName: 'A', groupId: 'G' }] });
  api = createApiHandler({ db, fixtureToken: 'synthetic-fixture' });
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('production chapter endpoint dynamically resolves provider metadata', () => {
  it('serves a chapter absent from the registry using the requested tuple and the existing App DTO', async () => {
    const result = await request();
    expect(result.status).toBe(200); expect(result.body.status).toBe('verified_source');
    expect(upstream).toHaveBeenCalledTimes(1);
    const url = new URL(String(upstream.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://audio-bible.youversionapi.com/3.1/chapter.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({ version_id: '46', reference: 'PSA.103' });
    expect(result.body.uri).toBe('https://media.example.test/opaque-observed.mp3');
    expect(validateCapability(result.body, { versionId: 46, usfm: 'PSA.103' }, Date.now()).ok).toBe(true);
  });
  it.each([46, 40, 111, 406, 114])('does not hardcode chapter, source URL or recording for version %i', async versionId => {
    upstream.mockImplementation(async () => answer([source(versionId, '1TI.4', { id: versionId + 900, download_urls: { format_mp3_32k: `https://media.example.test/random-${versionId}` } })]));
    const result = await request(versionId, '1TI.4');
    expect(result.body).toMatchObject({ identity: { versionId, usfm: '1TI.4' }, audio: true, provenance: { recordingId: String(versionId + 900) } });
    expect(result.body.uri).toBe(`https://media.example.test/random-${versionId}`);
  });
  it('prefers the eligible default and excludes dramatized and synthetic-title recordings', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { id: 1, default: false }), source(46, 'PSA.103', { id: 2, dramatized: true }), source(46, 'PSA.103', { id: 3, title: 'Synthetic voice' }), source(46, 'PSA.103', { id: 4 })]));
    expect((await request()).body.provenance).toMatchObject({ recordingId: '4' });
  });
  it('uses independently observed recording copyright only for its exact version and source id', async () => {
    upstream.mockImplementation(async () => answer([source(111, 'PHP.2', { id: 3, title: 'Male Narrator, American' })]));
    const result = await request(111, 'PHP.2');
    expect(result.body.provenance).toMatchObject({ publisher: 'Biblica, Inc.', edition: 'New International Version', recordingId: '3' });
    expect((result.body.provenance as { attribution: string }).attribution).toContain('Audio Copyright ℗ 2011 by Max McLean');
  });
  it('does not apply another recording copyright when the provider returns a new source id', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { id: 999 })]));
    const result = await request();
    expect(result.body.provenance).toMatchObject({ publisher: '錄音出版者未由目錄提供', recordingId: '999' });
    expect((result.body.provenance as { attribution: string }).attribution).not.toContain('℗ Everest');
  });
  it.each([source(111), source(46, 'PSA.10'), source(46, 'PSA.103', { timing: [] })])('rejects mismatched/unbound metadata instead of borrowing a recording', async row => {
    upstream.mockImplementation(async () => answer([row]));
    expect((await request()).body).toMatchObject({ audio: false, status: 'temporarily_unavailable' });
  });
  it('distinguishes a valid empty catalog from a failed metadata query', async () => {
    upstream.mockImplementationOnce(async () => answer([]));
    expect((await request()).body).toMatchObject({ audio: false, status: 'explicit_no_audio' });
    upstream.mockRejectedValueOnce(new Error('synthetic transport failure'));
    expect((await request(40)).body).toMatchObject({ audio: false, status: 'temporarily_unavailable' });
  });
  it('does not silently choose among multiple eligible default recordings', async () => {
    upstream.mockImplementation(async () => answer([source(), source(46, 'PSA.103', { id: 99 })]));
    expect((await request()).body.status).toBe('temporarily_unavailable');
  });
  it('recognizes only the observed provider reference-not-found error as no chapter audio', async () => {
    upstream.mockImplementationOnce(async () => answer({ errors: [{ key: 'audio_bible.reference.not_found', error: 'audio_bible.reference.not_found' }] }, 404));
    expect((await request(406, 'JHN.3')).body).toMatchObject({ identity: { versionId: 406, usfm: 'JHN.3' }, status: 'explicit_no_audio', audio: false });
    upstream.mockImplementationOnce(async () => answer({ errors: [{ key: 'backend.not_found' }] }, 404));
    expect((await request(406, 'JHN.4')).body.status).toBe('temporarily_unavailable');
  });
  it.each([null, {}, { response: { code: 200, data: {} } }])('classifies malformed metadata as retryable query failure', async payload => {
    upstream.mockImplementation(async () => new Response(JSON.stringify(payload)));
    expect((await request()).body.status).toBe('temporarily_unavailable');
  });
  it('reports no eligible recording without borrowing when only synthetic/dramatized sources exist', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { title: 'Synthetic Voice' }), source(46, 'PSA.103', { dramatized: true })]));
    expect((await request()).body).toMatchObject({ audio: false, status: 'explicit_no_audio' });
  });
  it('falls back only to an endpoint-provided HTTPS HLS source', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { download_urls: { format_mp3_32k: 'http://unsafe.example.test/a.mp3', format_hls: '//media.example.test/stream.m3u8' } })]));
    expect((await request()).body.uri).toBe('https://media.example.test/stream.m3u8');
  });
  it('bounds a stalled metadata request and allows a fresh retry', async () => {
    vi.useFakeTimers();
    upstream.mockImplementationOnce((_url: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted'))); }));
    const pending = request(); await vi.advanceTimersByTimeAsync(8_001);
    expect((await pending).body.status).toBe('temporarily_unavailable');
    expect((await request()).body.status).toBe('verified_source');
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('bounds cache lifetime, joins identical inflight queries and re-resolves after expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-13T09:00:00Z');
    const [a, b] = await Promise.all([request(), request()]);
    expect(upstream).toHaveBeenCalledTimes(1); expect(a.body).toEqual(b.body);
    expect(Date.parse(String(a.body.validUntil))).toBeGreaterThan(Date.now());
    vi.setSystemTime('2026-09-13T09:10:00Z'); await request(); expect(upstream).toHaveBeenCalledTimes(2);
  });
  it.each([[0, 'PSA.103'], [46, 'PSA.0'], [46, 'PSA.103.1']])('rejects invalid input before requesting the provider', async (versionId, usfm) => {
    expect((await request(Number(versionId), String(usfm))).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
});
