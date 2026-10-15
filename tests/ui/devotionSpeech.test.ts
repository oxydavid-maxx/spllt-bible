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

describe('the green devotion corner button', () => {
  const input = { onDevotion: false, readingCompleted: true, devotionCompleted: false, crowded: false, atReadingEnd: false, atDevotionEnd: false, followOfferEligible: true };
  it('ordinary circles always toggle completion, without playing or enabling follow (#1/#4)', () => {
    expect(devotionFab(input)).toMatchObject({ expanded: false, label: '完成今日靈修', action: 'toggle' });
  });
  it('only offers follow at the actual final chapter end within an untouched offer (#6)', () => {
    expect(devotionFab({ ...input, atReadingEnd: true })).toMatchObject({ expanded: true, label: '接續靈修', action: 'follow' });
    for (const change of [{ readingCompleted: false }, { followOfferEligible: false }, { crowded: true }, { devotionCompleted: true }]) {
      expect(devotionFab({ ...input, atReadingEnd: true, ...change }).action).toBe('toggle');
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
