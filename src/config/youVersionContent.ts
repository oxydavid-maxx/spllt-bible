import selectedBibleMetadata from './selectedBibleMetadata.json';

export const SELECTED_BIBLE_VERSION_IDS = [46, 40, 111, 406, 114] as const;
export const DEFAULT_BIBLE_VERSION_ID = 46;
export const RETIRED_BIBLE_VERSION_IDS = [1392, 312, 110, 3034] as const;

export interface YouVersionContentMetadata {
  versionId: number;
  languageTag: 'zh-Hant-TW' | 'en';
  translationName: string;
  publisher: string;
  officialUrl: string;
  copyrightNotice: string;
  audioAttribution?: string;
  textStatus: 'AVAILABLE_IN_SDK' | 'AVAILABLE_FROM_OFFICIAL_READER';
  audioStatus: 'CHAPTER_DEPENDENT';
  familyLinkStatus: 'PENDING_NATIVE_PROBE';
  audioAvailability: AudioAvailability;
}

export type AudioAvailability = {
  status: 'PENDING_PROVIDER' | 'READY' | 'UNAVAILABLE';
  versionId: number;
  publisher: string;
  recordingId: string | null;
  reason: string;
};

// Metadata and real 1TI.1 text reads verified through the official SDK on 2026-09-12.
// See release evidence POPULAR-VERSIONS-SDK / ADDITIONAL-ENGLISH-VERSIONS.
// Legacy metadata stays readable for migration and old stored records; selectable versions are below.
const AVAILABLE_VERSIONS: Record<number, YouVersionContentMetadata> = {
  "1392": {
    "versionId": 1392,
    "languageTag": "zh-Hant-TW",
    "translationName": "當代譯本(繁體)",
    "publisher": "Biblica",
    "officialUrl": "https://www.bible.com/versions/1392",
    "copyrightNotice": "聖經當代譯本™\n版權所有©1979，2005，2007，2012，2023 Biblica, Inc.\n版權所有。切勿翻印。\nChinese Contemporary Bible™ (Traditional Script) CCB™\nCopyright © 1979, 2005, 2007, 2012, 2023 by Biblica, Inc.\nUsed with permission. All rights reserved worldwide.",
    "textStatus": "AVAILABLE_IN_SDK",
    "audioStatus": "CHAPTER_DEPENDENT",
    "familyLinkStatus": "PENDING_NATIVE_PROBE",
    "audioAvailability": {
      "status": "PENDING_PROVIDER",
      "versionId": 1392,
      "publisher": "Biblica",
      "recordingId": null,
      "reason": "Audio availability is resolved for the selected chapter and translation."
    },
    "audioAttribution": "Chinese Contemporary Bible, Audio Edition Audio Copyright ℗ 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide."
  },
  "312": {
    "versionId": 312,
    "languageTag": "zh-Hant-TW",
    "translationName": "中文標準譯本(繁體)",
    "publisher": "全球聖經促進會",
    "officialUrl": "https://www.bible.com/versions/312",
    "copyrightNotice": "CHINESE STANDARD BIBLE©\nCopyright © 2005, 2008, 2011, 2025, 2026 by Global Bible Initiative\n中文標準譯本©\n版權所有 © 2005, 2008, 2011, 2025, 2026 全球聖經促進會",
    "textStatus": "AVAILABLE_IN_SDK",
    "audioStatus": "CHAPTER_DEPENDENT",
    "familyLinkStatus": "PENDING_NATIVE_PROBE",
    "audioAvailability": {
      "status": "PENDING_PROVIDER",
      "versionId": 312,
      "publisher": "全球聖經促進會",
      "recordingId": null,
      "reason": "Audio availability is resolved for the selected chapter and translation."
    }
  },
  "111": {
    "versionId": 111,
    "languageTag": "en",
    "translationName": "NIV — New International Version",
    "publisher": "Biblica",
    "officialUrl": "https://www.bible.com/versions/111",
    "copyrightNotice": "The Holy Bible, New International Version® NIV®\nCopyright © 1973, 1978, 1984, 2011 by Biblica, Inc.®\nUsed by Permission of Biblica, Inc.® All rights reserved worldwide.",
    "textStatus": "AVAILABLE_IN_SDK",
    "audioStatus": "CHAPTER_DEPENDENT",
    "familyLinkStatus": "PENDING_NATIVE_PROBE",
    "audioAvailability": {
      "status": "PENDING_PROVIDER",
      "versionId": 111,
      "publisher": "Biblica",
      "recordingId": null,
      "reason": "Audio availability is resolved for the selected chapter and translation."
    }
  },
  "110": {
    "versionId": 110,
    "languageTag": "en",
    "translationName": "NIrV — New International Reader’s Version",
    "publisher": "Biblica",
    "officialUrl": "https://www.bible.com/versions/110",
    "copyrightNotice": "Holy Bible, New International Reader’s Version®, NIrV®\nCopyright © 1995, 1996, 1998, 2014 by Biblica, Inc.®\nUsed by permission. All rights reserved worldwide.",
    "textStatus": "AVAILABLE_IN_SDK",
    "audioStatus": "CHAPTER_DEPENDENT",
    "familyLinkStatus": "PENDING_NATIVE_PROBE",
    "audioAvailability": {
      "status": "PENDING_PROVIDER",
      "versionId": 110,
      "publisher": "Biblica",
      "recordingId": null,
      "reason": "Audio availability is resolved for the selected chapter and translation."
    }
  },
  "3034": {
    "versionId": 3034,
    "languageTag": "en",
    "translationName": "BSB — Berean Standard Bible",
    "publisher": "BSB Publishing, LLC",
    "officialUrl": "https://www.bible.com/versions/3034",
    "copyrightNotice": "Public Domain",
    "textStatus": "AVAILABLE_IN_SDK",
    "audioStatus": "CHAPTER_DEPENDENT",
    "familyLinkStatus": "PENDING_NATIVE_PROBE",
    "audioAvailability": {
      "status": "PENDING_PROVIDER",
      "versionId": 3034,
      "publisher": "BSB Publishing, LLC",
      "recordingId": null,
      "reason": "Audio availability is resolved for the selected chapter and translation."
    }
  }
};

// These notices come from the corresponding official Bible.com version, not
// from another translation. The SDK remains the renderer; its production
// apiHost points at the official-content adapter for the selected catalogue.
const selectedNames: Record<number, string> = {
  46: '和合本（神版，繁體）',
  40: '新譯本（繁體）',
  111: 'NIV — New International Version',
  406: 'ERV — Easy-to-Read Version',
  114: 'NKJV — New King James Version',
};
for (const source of selectedBibleMetadata) {
  AVAILABLE_VERSIONS[source.versionId] = {
    versionId: source.versionId,
    languageTag: source.versionId === 46 || source.versionId === 40 ? 'zh-Hant-TW' : 'en',
    translationName: selectedNames[source.versionId],
    publisher: source.publisher,
    officialUrl: `https://www.bible.com/versions/${source.versionId}`,
    copyrightNotice: source.copyrightNotice,
    textStatus: source.versionId === 111 ? 'AVAILABLE_IN_SDK' : 'AVAILABLE_FROM_OFFICIAL_READER',
    audioStatus: 'CHAPTER_DEPENDENT',
    familyLinkStatus: 'PENDING_NATIVE_PROBE',
    audioAvailability: { status: 'PENDING_PROVIDER', versionId: source.versionId, publisher: source.publisher,
      recordingId: null, reason: 'Resolved dynamically for the selected translation and chapter.' },
  };
}

export function getYouVersionContentMetadata(versionId: number | null): YouVersionContentMetadata | null {
  return versionId === null ? null : AVAILABLE_VERSIONS[versionId] ?? null;
}
export function getAudioAvailability(versionId: number | null): AudioAvailability | null {
  return getYouVersionContentMetadata(versionId)?.audioAvailability ?? null;
}
export function getYouVersionVersionOptions(): YouVersionContentMetadata[] {
  return SELECTED_BIBLE_VERSION_IDS.map(id => AVAILABLE_VERSIONS[id]);
}
export function selectYouVersionVersion(currentVersionId: number, nextVersionId: number, allowedVersionIds: number[]): number {
  return allowedVersionIds.includes(nextVersionId) ? nextVersionId : currentVersionId;
}
