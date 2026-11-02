import { describe, expect, it } from 'vitest';
import { readAlongPart, readAlongPieces, readAlongPlan, splitDevotionReference } from '../../src/domain/devotionReading';
import { devotionVolume } from '../../src/domain/devotionVoice';
import { speechUnits } from '../../src/services/devotionSpeech';

const post = (paragraphs: string[], title = '測試題目') => ({
  date: '2026-10-16', weekday: '五', passages: '彼前5、詩118', title,
  sections: [{ heading: '背誦經文', paragraphs }], song: { youtubeId: 'abcdefghijk', title: null },
});

describe('devotional pronunciation, without changing the displayed words', () => {
  it('announces each book once and omits paragraph verse labels thereafter', () => {
    const source = post(['彼得前書 5:2 測試甲。', '5:7 測試乙。', '5:8-9 測試丙。', '詩篇 118:15 測試丁。', '彼得前書 5:10 測試戊。']);
    const before = JSON.stringify(source);
    expect(speechUnits(source).map(u => u.text)).toEqual([
      '測試題目。背誦經文。彼得前書第五章。測試甲。', '測試乙。', '測試丙。',
      '詩篇第一百一十八篇。測試丁。', '測試戊。',
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('omits parenthesized citations but reads inline chapter/verse and keeps ordinary parentheses', () => {
    const text = speechUnits(post(['想想 (1:1)、（彼前5:7）和 (詩篇 118:15-16)，再看 5:7 與 5:8-9 (這是提醒)。']))[0].text;
    expect(text).toBe('測試題目。背誦經文。想想 、和 ，再看 五章七節 與 五章八至九節 (這是提醒)。');
  });
  it('expands the compact book references in the title using the existing book table', () => {
    expect(speechUnits(post(['內容。'], '彼前5、詩118'))[0].text)
      .toBe('彼得前書第五章、詩篇第一百一十八篇。背誦經文。內容。');
  });
  it('does not repeat a book already announced in the title', () => {
    expect(speechUnits(post(['彼得前書 5:2 內容。'], '彼前5'))[0].text)
      .toBe('彼得前書第五章。背誦經文。內容。');
  });
  it('removes URLs and emoji including joiners, flags, keycaps and skin modifiers', () => {
    expect(speechUnits(post(['閱讀 https://example.invalid/abc?q=1，保持喜樂 👨‍👩‍👧‍👦 🙏🏽 🇹🇼 1️⃣。']))[0].text)
      .toBe('測試題目。背誦經文。閱讀 ，保持喜樂 。');
  });
  // 2026-10-16: 「119:20,23-24」 showed only 「119:20」 small and grey, and 「,23-24」 was shown and read as text.
  it('takes a citation listing more verses after commas as one label, shown small and not read', () => {
    for (const [label, body] of [['119:20,23-24 ', '測試甲。'], ['119:27,34 ', '測試乙。'], ['詩篇 113:5-7, 9 ', '測試丙。'], ['詩篇116:1-2,6-8 ', '測試丁。']]) {
      expect(splitDevotionReference(label + body)).toEqual({ reference: label, body });
    }
    expect(speechUnits(post(['詩篇119:9-11 測試甲。', '119:20,23-24 測試乙。', '119:27,34 測試丙。'])).map(u => u.text))
      .toEqual(['測試題目。背誦經文。詩篇第一百一十九篇。測試甲。', '測試乙。', '測試丙。']);
  });
  it('reads an inline verse list as one reference, and a full-width comma stays ordinary prose', () => {
    expect(speechUnits(post(['再看 5:7, 9 與 116:1-2,6-8。']))[0].text).toBe('測試題目。背誦經文。再看 五章七、九節 與 一百一十六章一至二、六至八節。');
    expect(splitDevotionReference('5:7，3 個人同心。')).toEqual({ reference: '5:7', body: '，3 個人同心。' });
  });
  it('does not suppress an inline reference as if it were a paragraph label', () => {
    expect(speechUnits(post(['這裡的彼前5:7是提醒。']))[0].text)
      .toBe('測試題目。背誦經文。這裡的彼得前書五章七節是提醒。');
  });
  // 維護者 2026-10-21, by ear on the male Azure voice: 祢 sounded wrong, then 神啊 and 得著.
  it('says 祢/祂 as 你/他, the vocative 神啊 as 神哪 and 得著 as 得着, keeping 護衛著 and the words on screen', () => {
    const source = post(['神啊，謝謝祢，祢的話使我們得著力量，也一路保護著我們；我們屬祂。']);
    const before = JSON.stringify(source);
    expect(speechUnits(source)[0].text).toBe('測試題目。背誦經文。神哪，謝謝你，你的話使我們得着力量，也一路保護著我們；我們屬他。');
    expect(JSON.stringify(source)).toBe(before);
  });
  // 維護者 2026-10-23: Azure read 使徒行傳 as chuán (船); in a book title 傳 is zhuàn (賺). Approved by ear 2026-10-28.
  it('says 行傳 as 行撰 wherever the book name is spoken, keeping its citations and 傳記, 自傳 as they are', () => {
    const source = post(['使徒行傳 1:8 測試甲。', '再讀徒2:1，也讀使徒行傳的傳記與自傳。'], '徒1');
    const before = JSON.stringify(source);
    expect(speechUnits(source).map(u => u.text)).toEqual([
      '使徒行撰第一章。背誦經文。測試甲。',
      '再讀使徒行撰二章一節，也讀使徒行撰的傳記與自傳。',
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('read-along by the share of the audio played (2026-10-21)', () => {
  // Made-up words shaped like a real post (one long paragraph): the pastor's posts never enter this repo.
  const meditation = '我們都知道，若只靠自己的力量，要每天安靜讀經禱告，常常做不到。然而，只要願意開始，我們就能一點一點學會，每天留一段時間給神，一直到成為習慣。當我們忙碌疲倦的時候，不用自責或者灰心放棄，因為，明天還可以重新開始，只要再回來就好。';
  it('cuts a paragraph into pieces of a sentence or two that put it back together exactly', () => {
    const pieces = readAlongPieces(meditation);
    expect(pieces.join('')).toBe(meditation);
    expect(pieces).toEqual([
      '我們都知道，若只靠自己的力量，要每天安靜讀經禱告，常常做不到。',
      '然而，只要願意開始，我們就能一點一點學會，',
      '每天留一段時間給神，一直到成為習慣。',
      '當我們忙碌疲倦的時候，不用自責或者灰心放棄，因為，',
      '明天還可以重新開始，只要再回來就好。',
    ]);
    for (const piece of pieces) expect([...piece].length).toBeLessThanOrEqual(40);
    expect(readAlongPieces('阿們！')).toEqual(['阿們！']);
    expect(readAlongPieces('。開頭是標點')).toEqual(['。開頭是標點']);
  });
  it('gives each part a share of the time by its spoken length, the heading first, ending at the whole', () => {
    const plan = readAlongPlan({ title: '測試題目', sections: [{ heading: '默想經文', paragraphs: [meditation, '這是一段很短的結尾禱告。阿們！'] }] });
    expect(plan).toHaveLength(2);
    const [first, second] = plan;
    expect(first.ends).toHaveLength(first.pieces.length + 1);
    expect(first.ends[0]).toBeGreaterThan(0);
    expect(first.ends.at(-1)).toBeCloseTo(1);
    expect([...first.ends].sort((a, b) => a - b)).toEqual(first.ends);
    expect(second.ends[0]).toBe(0);
    expect(readAlongPart(first, 0.01)).toBe(0);
    expect(readAlongPart(first, 0.99)).toBe(first.pieces.length);
    // No spoken heading: the first piece from the very start.
    expect(readAlongPart(second, 0)).toBe(1);
  });
});

describe('the 靈修 as loud as the scripture recording just heard (2026-10-21)', () => {
  it('turns the voice down for the quiet 和合本, never up, and leaves unmeasured versions alone', () => {
    expect(devotionVolume('zh-TW-YunJheNeural', 46)).toBe(0.46);
    expect(devotionVolume('zh-TW-HsiaoChenNeural', 46)).toBe(0.29);
    expect(devotionVolume('zh-TW-HsiaoChenNeural', 40)).toBe(0.94);
    expect(devotionVolume('zh-TW-YunJheNeural', 40)).toBe(1);
    expect(devotionVolume('zh-TW-YunJheNeural', 111)).toBe(1);
    expect(devotionVolume('zh-TW-YunJheNeural', 406)).toBe(1);
    expect(devotionVolume('zh-TW-YunJheNeural', null)).toBe(1);
  });
});
