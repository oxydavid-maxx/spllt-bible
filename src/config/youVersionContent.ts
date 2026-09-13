export interface YouVersionContentMetadata {
  versionId: number;
  languageTag: 'zh-Hant-TW' | 'en';
  translationName: string;
  publisher: string;
  officialUrl: string;
  copyrightNotice: string;
  audioAttribution?: string;
  textStatus: 'AVAILABLE_IN_SDK';
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
// Requested CUV46 is not substituted: the Platform currently returns404; the default decision is pending.
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

export function getYouVersionContentMetadata(versionId: number | null): YouVersionContentMetadata | null {
  return versionId === null ? null : AVAILABLE_VERSIONS[versionId] ?? null;
}
export function getAudioAvailability(versionId: number | null): AudioAvailability | null {
  return getYouVersionContentMetadata(versionId)?.audioAvailability ?? null;
}
export function getYouVersionVersionOptions(): YouVersionContentMetadata[] {
  return [1392, 312, 111, 110, 3034].map(id => AVAILABLE_VERSIONS[id]);
}
export function selectYouVersionVersion(currentVersionId: number, nextVersionId: number, allowedVersionIds: number[]): number {
  return allowedVersionIds.includes(nextVersionId) ? nextVersionId : currentVersionId;
}
