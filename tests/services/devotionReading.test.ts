import { describe, expect, it } from 'vitest';
import { splitDevotionReference } from '../../src/domain/devotionReading';
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
});
