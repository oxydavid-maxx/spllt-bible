import { describe, expect, it, vi } from 'vitest';
import { createDevotionSpeech, speechUnits, type SpeechEngine } from '../../src/services/devotionSpeech';
import type { DevotionalPost } from '../../src/services/devotionClient';
import { devotionBanner, devotionFab } from '../../src/ui/devotion/devotionFabModel';
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
  it('reads every paragraph in order, each heading before its first paragraph, then hands over to the song once', () => {
    const meditation = { ...post, sections: [{ heading: '默想經文', paragraphs: ['第一段', '第二段'] }, post.sections[1]] };
    expect(speechUnits(meditation).map((unit) => unit.text)).toEqual(['測試題目。默想經文。第一段', '第二段', '用經文禱告。第三段']);
    const { engine, spoken } = fakeEngine();
    const finished = vi.fn();
    const speech = createDevotionSpeech(engine, finished);
    speech.start('2026-10-14', meditation);
    expect(speech.getSnapshot()).toMatchObject({ status: 'speaking', index: 0, date: '2026-10-14', part: -1 });
    spoken[0].done();
    expect(speech.getSnapshot().index).toBe(1);
    spoken[1].done();
    spoken[2].done();
    expect(speech.getSnapshot()).toMatchObject({ status: 'done', index: -1 });
    expect(finished).toHaveBeenCalledExactlyOnceWith('2026-10-14');
    expect(spoken).toHaveLength(3);
  });

  // 維護者 2026-10-21: 背誦經文 is the reading just heard. It stays on screen, and the backend keeps numbering it,
  // so the paragraphs read keep the indices older apps ask the backend for.
  it('says nothing of 背誦經文 and keeps the backend’s paragraph numbers', () => {
    expect(speechUnits(post).map((unit) => unit.text)).toEqual(['測試題目。背誦經文。第一段', '第二段', '用經文禱告。第三段']);
    const { engine, spoken } = fakeEngine();
    const finished = vi.fn();
    const speech = createDevotionSpeech(engine, finished);
    speech.start('2026-10-14', post);
    expect(speech.getSnapshot()).toMatchObject({ status: 'speaking', index: 2 });
    expect(spoken.map((item) => item.text)).toEqual(['用經文禱告。第三段']);
    spoken[0].done();
    expect(finished).toHaveBeenCalledExactlyOnceWith('2026-10-14');
  });

  it('pauses by stopping the paragraph, ignores its late report, and resumes from that paragraph’s start', () => {
    const { engine, spoken } = fakeEngine();
    const finished = vi.fn();
    const speech = createDevotionSpeech(engine, finished);
    speech.start('2026-10-14', { ...post, sections: [{ heading: '默想經文', paragraphs: ['第一段', '第二段'] }] });
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
    expect(speech.getSnapshot()).toMatchObject({ status: 'paused', index: 2 });
  });

  it('lights the part being heard: the heading, then each piece, changing only between parts', () => {
    const progress: Array<(share: number | null) => void> = [];
    const engine: SpeechEngine = { speak: (_text, callbacks) => { progress.push(callbacks.onProgress!); }, stop: vi.fn() };
    const speech = createDevotionSpeech(engine, vi.fn());
    const listener = vi.fn();
    speech.subscribe(listener);
    speech.start('2026-10-14', { ...post, sections: [{ heading: '默想經文', paragraphs: ['第一句很長的話，說了好幾個字才停下來。第二句也是一樣長的一段話，讀到這裡才結束。'] }] });
    const published = listener.mock.calls.length;
    progress[0](0.01);
    expect(speech.getSnapshot().part).toBe(0);
    progress[0](0.5);
    expect(speech.getSnapshot().part).toBe(1);
    progress[0](0.52);
    expect(listener.mock.calls.length).toBe(published + 2);
    progress[0](0.99);
    expect(speech.getSnapshot().part).toBe(2);
    // The phone's own voice took over: no position, the whole paragraph again.
    progress[0](null);
    expect(speech.getSnapshot().part).toBe(-1);
    speech.pause();
    progress[0](0.3);
    expect(speech.getSnapshot()).toMatchObject({ status: 'paused', part: -1 });
  });
});

describe('the green devotion corner button', () => {
  const input = { onDevotion: false, devotionCompleted: false, crowded: false, atDevotionEnd: false };
  it('ordinary circles always toggle completion, without playing or enabling follow (#1/#4)', () => {
    expect(devotionFab(input)).toMatchObject({ expanded: false, label: '完成今日靈修', action: 'toggle' });
  });
  // 2026-10-17 (維護者): the reading end shows 接著讀靈修 › instead; the leaf never grows into a follow offer.
  it('never grows into a follow offer on the chapter', () => {
    for (const change of [{}, { crowded: true }, { devotionCompleted: true }]) {
      expect(devotionFab({ ...input, ...change }).action).toBe('toggle');
      expect(devotionFab({ ...input, ...change }).expanded).toBe(false);
    }
  });
  it('grows the completion button only at the devotional bottom (#8)', () => {
    expect(devotionFab({ ...input, onDevotion: true }).expanded).toBe(false);
    expect(devotionFab({ ...input, onDevotion: true, atDevotionEnd: true })).toMatchObject({ expanded: true, label: '完成今日靈修', action: 'toggle' });
    expect(devotionFab({ ...input, onDevotion: true, atDevotionEnd: true, devotionCompleted: true })).toMatchObject({ expanded: false, done: true });
    expect(devotionBanner(true, true)).toBe('正在朗讀靈修 · 讀完接著播詩歌');
    expect(devotionBanner(true, false)).toBe('正在朗讀靈修');
    expect(devotionBanner(false, true)).toBeNull();
  });
});

it('skips a paragraph containing only a URL or emoji without stalling or renumbering later highlights', () => {
  const { engine, spoken } = fakeEngine();
  const finished = vi.fn(), speech = createDevotionSpeech(engine, finished);
  speech.start(post.date, { ...post, sections: [{ heading: '默想經文', paragraphs: ['甲', '🙏', 'https://example.invalid/a', '乙'] }] });
  spoken[0].done();
  expect(spoken.at(-1)?.text).toBe('乙');
  expect(speech.getSnapshot().index).toBe(3);
  spoken.at(-1)!.done(); expect(finished).toHaveBeenCalledOnce();
});

it('hands over to the song once even when the final native callback arrives twice', () => {
  const { engine, spoken } = fakeEngine();
  const finished = vi.fn(), speech = createDevotionSpeech(engine, finished);
  speech.start(post.date, post, 2);
  spoken[0].done(); spoken[0].done();
  expect(finished).toHaveBeenCalledOnce();
});
