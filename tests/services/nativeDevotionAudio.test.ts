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
});
