import { describe, expect, it, vi } from 'vitest';
import { createPrefetchingDevotionAudio, fetchDevotionAudio } from '../../src/services/devotionAudioClient';
import type { DevotionSpeechRequest } from '../../src/services/devotionSpeech';

// 2026-10-16: one 355 KB paragraph mid-devotion missed the 8 s wait on the phone and fell back to device speech.
describe('the next paragraph is downloaded while the current one plays', () => {
  const at = (index: number, voice: DevotionSpeechRequest['voice'] = 'zh-TW-YunJheNeural'): DevotionSpeechRequest => ({ date: '2026-10-16', index, voice, rate: 1 });
  function network() {
    const calls: Array<{ request: DevotionSpeechRequest; signal: AbortSignal; resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }> = [];
    const fetchOne = vi.fn((request: DevotionSpeechRequest, signal: AbortSignal) => new Promise<Uint8Array>((resolve, reject) => { calls.push({ request, signal, resolve, reject }); }));
    return { calls, fetchOne };
  }
  it('asks for paragraph N+1 as soon as N arrives, and hands it over without another request', async () => {
    const net = network();
    const fetchAudio = createPrefetchingDevotionAudio(net.fetchOne);
    const first = fetchAudio(at(0), new AbortController().signal);
    expect(net.calls).toHaveLength(1);
    net.calls[0].resolve(new Uint8Array([0]));
    expect(await first).toEqual(new Uint8Array([0]));
    expect(net.calls.map(call => call.request.index)).toEqual([0, 1]);
    net.calls[1].resolve(new Uint8Array([1]));
    expect(await fetchAudio(at(1), new AbortController().signal)).toEqual(new Uint8Array([1]));
    expect(net.calls.map(call => call.request.index)).toEqual([0, 1, 2]);
  });
  it('drops (and cancels) a download for another voice or paragraph, and retries once when the early one failed', async () => {
    const net = network();
    const fetchAudio = createPrefetchingDevotionAudio(net.fetchOne);
    const first = fetchAudio(at(0), new AbortController().signal);
    net.calls[0].resolve(new Uint8Array([0])); await first;
    const female = fetchAudio(at(1, 'zh-TW-HsiaoChenNeural'), new AbortController().signal);
    expect(net.calls[1].signal.aborted).toBe(true);
    expect(net.calls[2].request).toEqual(at(1, 'zh-TW-HsiaoChenNeural'));
    net.calls[2].resolve(new Uint8Array([1])); await female;
    net.calls[3].reject(new Error('offline'));
    const retried = fetchAudio(at(2, 'zh-TW-HsiaoChenNeural'), new AbortController().signal);
    await vi.waitFor(() => expect(net.calls).toHaveLength(5));
    expect(net.calls[4].request).toEqual(at(2, 'zh-TW-HsiaoChenNeural'));
    net.calls[4].resolve(new Uint8Array([2]));
    expect(await retried).toEqual(new Uint8Array([2]));
  });
  it('a stopped paragraph rejects right away, while its early download stays usable', async () => {
    const net = network();
    const fetchAudio = createPrefetchingDevotionAudio(net.fetchOne);
    const first = fetchAudio(at(0), new AbortController().signal);
    net.calls[0].resolve(new Uint8Array([0])); await first;
    const controller = new AbortController();
    const stopped = fetchAudio(at(1), controller.signal);
    controller.abort();
    await expect(stopped).rejects.toThrow();
    expect(net.calls[1].signal.aborted).toBe(false);
    // Resume reads the same paragraph again: it uses that download instead of a new request.
    const resumed = fetchAudio(at(1), new AbortController().signal);
    net.calls[1].resolve(new Uint8Array([1]));
    expect(await resumed).toEqual(new Uint8Array([1]));
    expect(net.calls.map(call => call.request.index)).toEqual([0, 1, 2]);
  });
});

describe('authenticated devotional mp3 download', () => {
  const options = { baseUrl: 'https://fixture.invalid', token: 'fixture-token', memberId: 'test' };
  const request = { date: '2026-10-16', index: 2, voice: 'zh-TW-HsiaoChenNeural' as const, rate: 1.5 };
  it('sends session auth in a header, selects only the requested paragraph and voice, and returns bytes', async () => {
    const bytes = new Uint8Array([0xff, 0xf3, 0x64, 0xc4]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } }));
    const controller = new AbortController();
    expect(await fetchDevotionAudio({ ...options, fetchImpl }, request, controller.signal)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledWith('https://fixture.invalid/api/devotional/2026-10-16/audio/2?voice=zh-TW-HsiaoChenNeural', { signal: controller.signal, headers: { authorization: 'Bearer fixture-token' } });
  });
  it.each([401, 404, 502])('rejects HTTP %s so the engine falls back for this paragraph', async status => {
    await expect(fetchDevotionAudio({ ...options, fetchImpl: vi.fn(async () => new Response('', { status })) }, request, new AbortController().signal)).rejects.toThrow();
  });
  it('rejects empty/non-audio success and offline errors', async () => {
    for (const fetchImpl of [vi.fn(async () => new Response('json')), vi.fn(async () => new Response('', { headers: { 'content-type': 'audio/mpeg' } })), vi.fn(async () => { throw new Error('offline'); })]) {
      await expect(fetchDevotionAudio({ ...options, fetchImpl }, request, new AbortController().signal)).rejects.toThrow();
    }
  });
});
