import { describe, expect, it, vi } from 'vitest';
import { createDevotionVoiceStore } from '../../src/services/devotionVoicePreferences';

describe('member-local devotional voice', () => {
  it('defaults to male, persists female, and isolates other members and guests', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: vi.fn(async (k: string) => values.get(k) ?? null), setItem: vi.fn(async (k: string, v: string) => { values.set(k, v); }) };
    const first = createDevotionVoiceStore(storage);
    expect(first.getVoice('a')).toBe('zh-TW-YunJheNeural');
    await first.update('a', 'zh-TW-HsiaoChenNeural');
    const restart = createDevotionVoiceStore(storage); await restart.load('a');
    expect(restart.getVoice('a')).toBe('zh-TW-HsiaoChenNeural');
    expect(restart.getVoice('b')).toBe('zh-TW-YunJheNeural');
    await restart.update(null, 'zh-TW-HsiaoChenNeural');
    expect(restart.getVoice(null)).toBe('zh-TW-YunJheNeural'); expect(storage.setItem).toHaveBeenCalledOnce();
  });
  it('never lets a late hydration overwrite an explicit choice; serializes persistence', async () => {
    let read!: (value: string) => void, write!: () => void;
    const storage = { getItem: vi.fn(() => new Promise<string>(r => { read = r; })), setItem: vi.fn().mockImplementationOnce(() => new Promise<void>(r => { write = r; })).mockResolvedValue(undefined) };
    const store = createDevotionVoiceStore(storage);
    const loading = store.load('a');
    const first = store.update('a', 'zh-TW-HsiaoChenNeural');
    const last = store.update('a', 'zh-TW-YunJheNeural');
    await Promise.resolve();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    read('zh-TW-HsiaoChenNeural'); await loading;
    expect(store.getVoice('a')).toBe('zh-TW-YunJheNeural');
    write(); await Promise.all([first, last]);
    expect(storage.setItem.mock.calls[1][1]).toBe('zh-TW-YunJheNeural');
  });
  it('falls back on corrupt storage and keeps the current choice even if persistence fails', async () => {
    const store = createDevotionVoiceStore({ getItem: async () => 'invalid', setItem: async () => { throw new Error('locked'); } });
    await store.load('a'); expect(store.getVoice('a')).toBe('zh-TW-YunJheNeural');
    await store.update('a', 'zh-TW-HsiaoChenNeural'); expect(store.getVoice('a')).toBe('zh-TW-HsiaoChenNeural');
  });
});
