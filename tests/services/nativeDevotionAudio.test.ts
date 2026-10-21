import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(async () => {}), create: vi.fn(), write: vi.fn(), removeFile: vi.fn() }));
vi.mock('expo-speech', () => ({ speak: native.speak, stop: native.stop }));
vi.mock('expo-audio', () => ({ createAudioPlayer: native.create }));
vi.mock('expo-file-system', () => ({ Paths: { cache: 'file:///synthetic-cache' }, File: class {
  uri = 'file:///synthetic-cache/paragraph.mp3'; exists = true;
  write = native.write; delete = native.removeFile;
} }));
import { createNativeDevotionEngine } from '../../src/services/nativeDevotionAudio';

const request = { date: '2026-10-16', index: 0, voice: 'zh-TW-YunJheNeural' as const, rate: 1.25 };
const cb = () => ({ onDone: vi.fn(), onStopped: vi.fn(), onError: vi.fn() });
afterEach(() => { vi.unstubAllGlobals(); });
describe('the installed Expo adapter', () => {
  it('passes rate/language to expo-speech when Azure is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const engine = createNativeDevotionEngine(() => ({ baseUrl: 'https://fixture.invalid', token: 'fake', memberId: 'test' }));
    engine.speak('測試文字', cb(), request);
    await vi.waitFor(() => expect(native.speak).toHaveBeenCalledWith('測試文字', expect.objectContaining({ language: 'zh-TW', rate: 1.25 })));
    engine.stop();
  });
  it('writes private temporary bytes, applies speed after native load, handles EOF and removes the file/player', async () => {
    const bytes = new Uint8Array([0xff, 0xf3, 0x64, 0xc4]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } })));
    let listener: (status: any) => void = () => {};
    const removeListener = vi.fn();
    const player = { play: vi.fn(), pause: vi.fn(), remove: vi.fn(), setPlaybackRate: vi.fn(), seekTo: vi.fn(), currentTime: 0, duration: 10, playing: false, isLoaded: false, isBuffering: false,
      addListener: vi.fn((_event, fn) => { listener = fn; return { remove: removeListener }; }) };
    native.create.mockReturnValue(player);
    const callbacks = cb();
    const engine = createNativeDevotionEngine(() => ({ baseUrl: 'https://fixture.invalid', token: 'fake', memberId: 'test' }));
    engine.speak('測試文字', callbacks, request);
    await vi.waitFor(() => expect(player.addListener).toHaveBeenCalled());
    expect(native.write).toHaveBeenCalledWith(bytes);
    expect(player.play).not.toHaveBeenCalled();
    player.isLoaded = true; listener({ isLoaded: true, didJustFinish: false, error: null });
    await vi.waitFor(() => expect(player.play).toHaveBeenCalledOnce());
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
    engine.setRate!(1.5); await vi.waitFor(() => expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5));
    listener({ isLoaded: true, didJustFinish: true, error: null });
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(player.remove).toHaveBeenCalledOnce(); expect(native.removeFile).toHaveBeenCalledOnce(); expect(removeListener).toHaveBeenCalledOnce();
    engine.stop();
  });
  // 2026-10-21: as loud as the scripture just heard, and the share played for the read-along, from the
  // status updates the player already sends.
  it('plays at the requested volume and reports the share played once playing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff, 0xf3]), { headers: { 'content-type': 'audio/mpeg' } })));
    let listener: (status: any) => void = () => {};
    const player = { play: vi.fn(), pause: vi.fn(), remove: vi.fn(), setPlaybackRate: vi.fn(), seekTo: vi.fn(), currentTime: 0, duration: 10, playing: false, isLoaded: false, isBuffering: false, volume: 1,
      addListener: vi.fn((_event, fn) => { listener = fn; return { remove: vi.fn() }; }) };
    native.create.mockReturnValue(player);
    const callbacks = { ...cb(), onProgress: vi.fn() };
    const engine = createNativeDevotionEngine(() => ({ baseUrl: 'https://fixture.invalid', token: 'fake', memberId: 'test' }));
    engine.speak('測試文字', callbacks, { ...request, volume: 0.46 });
    await vi.waitFor(() => expect(player.addListener).toHaveBeenCalled());
    expect(player.volume).toBe(0.46);
    player.isLoaded = true; listener({ isLoaded: true, didJustFinish: false, error: null, currentTime: 2.5, duration: 10 });
    await vi.waitFor(() => expect(player.play).toHaveBeenCalledOnce());
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(0.25);
    listener({ isLoaded: true, didJustFinish: false, error: null, currentTime: 0, duration: 0 });
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);
    engine.stop();
  });
  it('speaks at the requested volume when the phone voice reads the paragraph', async () => {
    native.speak.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const engine = createNativeDevotionEngine(() => ({ baseUrl: 'https://fixture.invalid', token: 'fake', memberId: 'test' }));
    engine.speak('測試文字', cb(), { ...request, volume: 0.29 });
    await vi.waitFor(() => expect(native.speak).toHaveBeenCalledWith('測試文字', expect.objectContaining({ volume: 0.29 })));
    engine.stop();
  });
});
