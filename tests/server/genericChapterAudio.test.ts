import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { seedReadingDays } from '../../server/gamification';
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

describe('chapter audio prewarm', () => {
  it('warms today and tomorrow assigned chapters across the curated versions with bounded concurrency', async () => {
    const { prewarmChapterAudio } = await import('../../server/genericChapterAudio');
    const calls: string[] = []; let active = 0; let peak = 0;
    const resolve = async (versionId: number, usfm: string) => { active++; peak = Math.max(peak, active); calls.push(`${versionId}:${usfm}`); await new Promise((r) => setTimeout(r, 1)); active--; return { identity: { versionId, usfm }, text: true, audio: true, offline: false as const, status: 'verified_source' as const, reason: '' }; };
    const done = await prewarmChapterAudio(resolve, [46, 111], ['PSA.103', '1TI.4'], 2);
    expect(done).toBe(4); expect(peak).toBeLessThanOrEqual(2);
    expect(calls.sort()).toEqual(['111:1TI.4', '111:PSA.103', '46:1TI.4', '46:PSA.103']);
  });
  it('every served body is still playable at the moment it is served (0.2.10 regression: a 6 h cache handed out bodies whose 5 min validity had passed, so every reader open showed 重試)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    const start = Date.now();
    for (const minutes of [0, 5, 60, 359, 361, 480]) {
      vi.setSystemTime(new Date(start + minutes * 60_000));
      const answered = await request();
      expect(validateCapability(answered.body, { versionId: 46, usfm: 'PSA.103' }, Date.now()).ok).toBe(true);
    }
    expect(upstream).toHaveBeenCalledTimes(1); // one observation per cache window, not one per open
  });

  it('warms the new day at Taipei midnight, not on an hourly timer that mostly hits the same cached answer', async () => {
    vi.useFakeTimers();
    // 2026-10-19 23:50 Taipei is 15:50 UTC. Ten minutes from the date rolling over.
    vi.setSystemTime(new Date('2026-10-19T15:50:00Z'));
    const scheduled = createDatabase({ filename: ':memory:', members: [{ id: 'test:a', displayName: 'A', groupId: 'G' }] });
    seedReadingDays(scheduled.db, [
      { taskDate: '2026-10-19', planId: 'p', references: ['PSA.103'] },
      { taskDate: '2026-10-20', planId: 'p', references: ['PSA.104'] },
      { taskDate: '2026-10-21', planId: 'p', references: ['PSA.105'] },
    ]);
    createApiHandler({ db: scheduled, fixtureToken: 'synthetic-fixture', prewarmChapterAudio: true, prewarmVersionIds: [46], now: () => new Date() });

    await vi.advanceTimersByTimeAsync(5_000); // the start-up warm
    const warmedAtStart = upstream.mock.calls.map((call) => String(call[0]));
    expect(warmedAtStart.some((url) => url.includes('PSA.103'))).toBe(true);
    expect(warmedAtStart.some((url) => url.includes('PSA.105'))).toBe(false); // the day after tomorrow is not ours yet

    upstream.mockClear();
    await vi.advanceTimersByTimeAsync(9 * 60_000); // still 2026-10-19 in Taipei
    expect(upstream).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * 60_000); // now past Taipei midnight
    const warmedAtMidnight = upstream.mock.calls.map((call) => String(call[0]));
    expect(warmedAtMidnight.some((url) => url.includes('PSA.105'))).toBe(true);
    scheduled.close();
  });

  it('serves one observation for a whole day, because a day is how long we said the answer is good for', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    const start = Date.now();
    for (const hours of [0, 6, 12, 23]) {
      vi.setSystemTime(new Date(start + hours * 3_600_000));
      const answered = await request();
      expect(validateCapability(answered.body, { versionId: 46, usfm: 'PSA.103' }, Date.now()).ok).toBe(true);
    }
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(start + 25 * 3_600_000));
    await request();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('re-confirms the catalogue once a day rather than once every few minutes: scripture does not change and the address is content-hashed', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    const answered = await request();
    expect(Date.parse(String(answered.body.validUntil)) - Date.now()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('per-verse timing travels with the capability', () => {
  it('keeps ascending timing rows of the chosen recording for the requested chapter only, dropping malformed rows', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { timing: [
      { usfm: 'PSA.103.2', start: 9.5, end: 14 }, { usfm: 'PSA.103.1', start: 2.9, end: 9.5 },
      { usfm: 'PSA.104.1', start: 0, end: 3 }, { usfm: 'PSA.103.3', start: 'x', end: 20 }, { usfm: 'PSA.103.4', start: 20.4 },
      { usfm: 'psa.103.5', start: 25.7, end: 30.1 }, { start: 1, end: 2 }, { usfm: 'PSA.103.2', start: 9.5, end: 14 },
    ] })]));
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.body.verseTiming).toEqual([{ verse: 1, start: 2.9, end: 9.5 }, { verse: 2, start: 9.5, end: 14 }, { verse: 5, start: 25.7, end: 30.1 }]);
  });
  it('omits verseTiming instead of inventing one when the provider gives none usable', async () => {
    upstream.mockImplementation(async () => answer([source(46, 'PSA.103', { timing: [{ usfm: 'PSA.103.1', start: 0 }] })]));
    const result = await request();
    expect(result.status).toBe(200); expect(result.body.status).toBe('verified_source');
    expect(result.body).not.toHaveProperty('verseTiming');
  });
});

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
    vi.setSystemTime('2026-09-13T15:10:00Z'); await request(); expect(upstream).toHaveBeenCalledTimes(1); vi.setSystemTime('2026-09-14T10:00:00Z'); await request(); expect(upstream).toHaveBeenCalledTimes(2);
  });
  it.each([[0, 'PSA.103'], [46, 'PSA.0'], [46, 'PSA.103.1']])('rejects invalid input before requesting the provider', async (versionId, usfm) => {
    expect((await request(Number(versionId), String(usfm))).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
});
