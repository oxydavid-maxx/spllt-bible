import { describe, expect, it, vi } from 'vitest';
import { createDevotionSpeech, speechUnits, type SpeechEngine } from '../../src/services/devotionSpeech';
import type { DevotionalPost } from '../../src/services/devotionClient';
import { devotionBanner, goldFab } from '../../src/ui/devotion/devotionFabModel';
import { createDevotionPreferencesStore } from '../../src/services/devotionPreferences';

// A made-up post: the real ones live only on the server, never in this public repo.
const post: DevotionalPost = {
  date: '2026-10-14', weekday: '三', passages: '彼前5、詩118', title: '測試題目',
  sections: [{ heading: '背誦經文', paragraphs: ['第一段', '第二段'] }, { heading: '用經文禱告', paragraphs: ['第三段'] }],
  song: { youtubeId: 'abcdefghijk', title: '測試詩歌' },
};

function fakeEngine() {
  const spoken: Array<{ text: string; done: () => void; stopped: () => void; error: () => void }> = [];
  const engine: SpeechEngine = {
    speak: (text, callbacks) => { spoken.push({ text, done: callbacks.onDone, stopped: callbacks.onStopped, error: callbacks.onError }); },
    stop: vi.fn(() => { spoken.at(-1)?.stopped(); }),
  };
  return { engine, spoken };
}

describe('reading the 靈修 aloud', () => {
  it('reads every paragraph in order, the title and each heading before its first paragraph, then hands over to the song once', () => {
    expect(speechUnits(post).map((unit) => unit.text)).toEqual(['測試題目。背誦經文。第一段', '第二段', '用經文禱告。第三段']);
    const { engine, spoken } = fakeEngine();
    const finished = vi.fn();
    const speech = createDevotionSpeech(engine, finished);
    speech.start('2026-10-14', post);
    expect(speech.getSnapshot()).toMatchObject({ status: 'speaking', index: 0, date: '2026-10-14' });
    spoken[0].done();
    expect(speech.getSnapshot().index).toBe(1);
    spoken[1].done();
    spoken[2].done();
    expect(speech.getSnapshot()).toMatchObject({ status: 'done', index: -1 });
    expect(finished).toHaveBeenCalledExactlyOnceWith('2026-10-14');
    expect(spoken).toHaveLength(3);
  });

  it('pauses by stopping the paragraph, ignores its late report, and resumes from that paragraph’s start', () => {
    const { engine, spoken } = fakeEngine();
    const finished = vi.fn();
    const speech = createDevotionSpeech(engine, finished);
    speech.start('2026-10-14', post);
    spoken[0].done();
    speech.pause();
    expect(speech.getSnapshot()).toMatchObject({ status: 'paused', index: 1 });
    // Android may still report the stopped paragraph as done: it must not move the reading on.
    spoken[1].done();
    expect(speech.getSnapshot()).toMatchObject({ status: 'paused', index: 1 });
    speech.resume();
    expect(spoken.at(-1)?.text).toBe('第二段');
    expect(speech.getSnapshot()).toMatchObject({ status: 'speaking', index: 1 });
    speech.stop();
    expect(speech.getSnapshot()).toMatchObject({ status: 'idle', index: -1, date: null });
    expect(finished).not.toHaveBeenCalled();
  });

  it('stops on a speech error at that paragraph, ready to resume', () => {
    const { engine, spoken } = fakeEngine();
    const speech = createDevotionSpeech(engine, vi.fn());
    speech.start('2026-10-14', post);
    spoken[0].error();
    expect(speech.getSnapshot()).toMatchObject({ status: 'paused', index: 0 });
  });
});

describe('the gold corner button', () => {
  it('grows only when it is the next thing to press', () => {
    expect(goldFab({ onDevotion: false, readingCompleted: false, devotionCompleted: false, crowded: false })).toEqual({ expanded: false, done: false, label: '跟傳道一起讀', action: 'follow' });
    expect(goldFab({ onDevotion: false, readingCompleted: true, devotionCompleted: false, crowded: false })).toMatchObject({ expanded: true, action: 'follow' });
    expect(goldFab({ onDevotion: false, readingCompleted: true, devotionCompleted: false, crowded: true }).expanded).toBe(false);
    expect(goldFab({ onDevotion: true, readingCompleted: true, devotionCompleted: false, crowded: false })).toEqual({ expanded: false, done: false, label: '完成今日靈修', action: 'toggle' });
    expect(goldFab({ onDevotion: true, readingCompleted: true, devotionCompleted: true, crowded: false })).toEqual({ expanded: false, done: true, label: '今日靈修已完成', action: 'toggle' });
    expect(devotionBanner(true, true)).toBe('正在朗讀靈修 · 讀完接著播詩歌');
    expect(devotionBanner(true, false)).toBe('正在朗讀靈修');
    expect(devotionBanner(false, true)).toBeNull();
  });
});

describe('跟傳道一起讀 preference', () => {
  it('is on by default, the first gold press sets it once, and a member’s own off stays off', async () => {
    const saved = new Map<string, string>();
    const storage = { getItem: vi.fn(async (key: string) => saved.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { saved.set(key, value); }) };
    const store = createDevotionPreferencesStore(storage);
    expect(store.getSnapshot('m1')).toBe(store.getSnapshot('m1'));
    await store.load('m1');
    expect(store.getSnapshot('m1')).toMatchObject({ ready: true, enabled: true, touched: false });
    store.setEnabled('m1', false);
    store.firstFollow('m1');
    expect(store.getSnapshot('m1').enabled).toBe(false);
    const reopened = createDevotionPreferencesStore(storage);
    await vi.waitFor(() => expect(saved.size).toBe(1));
    await reopened.load('m1');
    expect(reopened.getSnapshot('m1')).toMatchObject({ enabled: false, touched: true });
  });
});
