import { describe, expect, it } from 'vitest';
import { buildYouVersionReaderConfig } from '../../src/ui/youVersionReaderConfig';
import { getYouVersionContentMetadata, getYouVersionVersionOptions, selectYouVersionVersion } from '../../src/config/youVersionContent';
import { buildFixtureModels } from '../../src/ui/routes';

describe('YouVersion reader entry', () => {
  it('routes the actual task references to the official SDK reader with the permitted version', () => {
    expect(buildYouVersionReaderConfig({
      references: ['JHN.18', 'JHN.19'],
      appKey: 'configured-at-runtime',
      versionId: 1392,
      allowTechnicalProbe: true,
    })).toEqual({
      book: 'JHN',
      chapter: '18',
      versionId: 1392,
      references: ['JHN.18', 'JHN.19'],
      allowTechnicalProbe: true,
    });
  });

  it('binds the accepted text probe to the correct Traditional Chinese attribution', () => {
    expect(getYouVersionContentMetadata(1392)).toMatchObject({
      versionId: 1392,
      languageTag: 'zh-Hant-TW',
      translationName: '當代譯本(繁體)',
      publisher: 'Biblica',
      textStatus: 'AVAILABLE_IN_SDK',
      audioStatus: 'CHAPTER_DEPENDENT',
      familyLinkStatus: 'PENDING_NATIVE_PROBE',
    });
    expect(getYouVersionContentMetadata(1392)?.copyrightNotice).toMatch(/Copyright © 1979, 2005, 2007, 2012, 2023/);
    expect(getYouVersionContentMetadata(1392)?.copyrightNotice).not.toMatch(/text probe attribution|YouVersion metadata/);
    expect(getYouVersionContentMetadata(312)).toMatchObject({ translationName: '中文標準譯本(繁體)', publisher: '全球聖經促進會' });
  });

  it('offers CSBT312 as an approved comparison version with its own attribution and official link', () => {
    expect(getYouVersionContentMetadata(312)).toMatchObject({
      versionId: 312,
      translationName: '中文標準譯本(繁體)',
      publisher: '全球聖經促進會',
      languageTag: 'zh-Hant-TW',
      officialUrl: 'https://www.bible.com/versions/312',
      copyrightNotice: expect.stringContaining('CHINESE STANDARD BIBLE'),
    });
    expect(getYouVersionVersionOptions().map((option) => option.versionId)).toEqual([46, 40, 111, 406, 114]);
    expect(selectYouVersionVersion(1392, 312, [1392, 312])).toBe(312);
    expect(selectYouVersionVersion(312, 999, [1392, 312])).toBe(312);
  });

  it('offers only verified readable English options and does not disguise an unavailable CUV', () => {
    for (const versionId of [111, 110, 3034]) {
      expect(getYouVersionContentMetadata(versionId)).toMatchObject({ versionId, languageTag: 'en', textStatus: 'AVAILABLE_IN_SDK' });
    }
    expect(getYouVersionContentMetadata(46)).toMatchObject({ versionId: 46, textStatus: 'AVAILABLE_FROM_OFFICIAL_READER' });
    expect(getYouVersionContentMetadata(1392)?.audioAttribution).toContain('2011');
  });

  it('keeps all assigned passages, including a partial range and three-reference day, for one-at-a-time selection', () => {
    expect(buildFixtureModels('2026-09-01').reader.references).toEqual(['JHN.12.27-50', 'JHN.13']);
    expect(buildFixtureModels('2026-09-12').reader.references).toEqual(['1TI.1', 'PSA.90', 'PSA.91']);
    expect(buildYouVersionReaderConfig({ references: ['JHN.12.27-50'], appKey: 'runtime', versionId: 1392, allowTechnicalProbe: true })).toMatchObject({ book: 'JHN', chapter: '12' });
  });
});
