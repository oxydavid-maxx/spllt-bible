import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevotionAudioEngine, type DevotionSegmentAudio } from '../../src/services/devotionAudioEngine';
import { createDevotionSpeech, type SpeechEngine, type DevotionSpeechRequest } from '../../src/services/devotionSpeech';

const context = { date: '2026-10-16', index: 0, rate: 1.25, voice: 'zh-TW-YunJheNeural' as const };
const callbacks = () => ({ onDone: vi.fn(), onStopped: vi.fn(), onError: vi.fn() });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(load?: () => Promise<DevotionSegmentAudio>) {
  let audioCallbacks: ReturnType<typeof callbacks>;
  const audio: DevotionSegmentAudio = { play: vi.fn(async cb => { audioCallbacks = cb as typeof audioCallbacks; }), setRate: vi.fn(async () => {}), dispose: vi.fn() };
  const device: SpeechEngine = { speak: vi.fn(), stop: vi.fn() };
  const loadAudio = vi.fn((_request: DevotionSpeechRequest, _signal: AbortSignal) => load ? load() : Promise.resolve(audio));
  const engine = createDevotionAudioEngine({ device, loadAudio, timeoutMs: 100 });
  return { engine, loadAudio, audio, device, audioCallbacks: () => audioCallbacks };
}
afterEach(() => vi.useRealTimers());

describe('per-paragraph Azure audio with device speech fallback', () => {
  it('plays mp3 at the chosen speed and changes speed while playing', async () => {
    const f = setup(), cb = callbacks();
    f.engine.speak('內容', cb, context); await flush();
    expect(f.audio.setRate).toHaveBeenCalledWith(1.25);
    expect(f.audio.play).toHaveBeenCalledOnce(); expect(f.device.speak).not.toHaveBeenCalled();
    f.engine.setRate!(1.5); await flush(); expect(f.audio.setRate).toHaveBeenLastCalledWith(1.5);
    f.audioCallbacks().onDone(); expect(cb.onDone).toHaveBeenCalledOnce(); expect(f.audio.dispose).toHaveBeenCalledOnce();
  });
  it('falls back only for the failed paragraph, using the same transformed text and rate', async () => {
    const f = setup(), cb = callbacks(); f.loadAudio.mockRejectedValueOnce(new Error('offline'));
    f.engine.speak('彼得前書第五章。測試甲。', cb, context); await flush();
    expect(f.device.speak).toHaveBeenCalledWith('彼得前書第五章。測試甲。', expect.anything(), context);
    (vi.mocked(f.device.speak).mock.calls[0][1]).onDone(); expect(cb.onDone).toHaveBeenCalledOnce();
    f.engine.speak('測試乙。', callbacks(), { ...context, index: 1 }); await flush();
    expect(f.audio.play).toHaveBeenCalledOnce(); expect(f.device.speak).toHaveBeenCalledTimes(1);
  });
  it('falls back on native decoding/playback error exactly once', async () => {
    const f = setup(), cb = callbacks(); f.engine.speak('內容', cb, context); await flush();
    f.audioCallbacks().onError(); f.audioCallbacks().onError(); await flush();
    expect(f.device.speak).toHaveBeenCalledTimes(1); expect(f.audio.dispose).toHaveBeenCalledOnce();
    f.audioCallbacks().onDone(); expect(cb.onDone).not.toHaveBeenCalled();
  });
  it('bounds a hung load and ignores its eventual audio after falling back', async () => {
    vi.useFakeTimers(); let resolve!: (value: DevotionSegmentAudio) => void;
    const f = setup(() => new Promise(r => { resolve = r; }));
    f.engine.speak('內容', callbacks(), context); await flush();
    await vi.advanceTimersByTimeAsync(101); expect(f.device.speak).toHaveBeenCalledOnce();
    expect(f.loadAudio.mock.calls[0][1].aborted).toBe(true);
    resolve(f.audio); await flush(); expect(f.audio.play).not.toHaveBeenCalled(); expect(f.audio.dispose).toHaveBeenCalledOnce();
    f.engine.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('stop/date change cancels pending fetch; stale results and callbacks cannot start speech', async () => {
    let resolve!: (value: DevotionSegmentAudio) => void;
    const f = setup(() => new Promise(r => { resolve = r; })), cb = callbacks();
    f.engine.speak('內容', cb, context); await flush(); f.engine.stop(); resolve(f.audio); await flush();
    expect(f.audio.play).not.toHaveBeenCalled(); expect(f.device.speak).not.toHaveBeenCalled(); expect(cb.onDone).not.toHaveBeenCalled();
    expect(f.loadAudio.mock.calls[0][1].aborted).toBe(true);
  });
  it('the reading controller passes date, paragraph, voice and rate; the next paragraph can use Azure after fallback', async () => {
    const f = setup(); f.loadAudio.mockRejectedValueOnce(new Error('502'));
    const speech = createDevotionSpeech(f.engine, vi.fn());
    speech.setVoice('zh-TW-HsiaoChenNeural'); speech.setRate(1.5);
    speech.start('2026-10-16', { date: '2026-10-16', title: '測試', weekday: '五', passages: '詩1', sections: [{ heading: '默想', paragraphs: ['甲', '乙'] }], song: { youtubeId: 'abcdefghijk', title: null } });
    await flush();
    expect(vi.mocked(f.device.speak).mock.calls[0][2]).toEqual({ ...context, rate: 1.5, voice: 'zh-TW-HsiaoChenNeural' });
    vi.mocked(f.device.speak).mock.calls[0][1].onDone(); await flush();
    expect(f.loadAudio).toHaveBeenLastCalledWith({ ...context, index: 1, rate: 1.5, voice: 'zh-TW-HsiaoChenNeural' }, expect.any(AbortSignal));
    speech.stop();
  });
});
