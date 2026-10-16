import { describe, expect, it, vi } from 'vitest';
import { fetchDevotionAudio } from '../../src/services/devotionAudioClient';

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
