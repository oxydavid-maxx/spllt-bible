// contentRegistry.ts
// Per-chapter audio ADDRESS store, keyed by (versionId, usfm). Generated from observed evidence; see
// OBSERVED_EVIDENCE below. Nothing here was derived from a filename pattern - the provider's hashes are
// opaque and every address was read from the provider's own page.
//
// Review 119 corrections that live in this file:
//   R3  a row carries TWO separate time fields. providerExpiry is what the SOURCE states and is null
//       for genuinely unknown - the observed MP3 URLs carried no expiry field, and inventing one would
//       be fabricating evidence about someone else's service. validUntil is OUR re-confirmation policy,
//       computed from observedAtUtc + REFRESH_POLICY_DAYS, and it IS enforced.
//   R5  provenance travels with the ROW. A future edition added here keeps its own publisher/edition/
//       recording id; nothing defaults to CCB or Biblica.
//   R7  this is NOT a whitelist. GEN.1 is present and is NOT one of the September 42, which is what
//       proves the mechanism is general. Chapters whose addresses have not been observed are simply
//       ABSENT - absent means "address not obtained", never "this chapter has no recording".

import type { ResolutionStatus, SourceProvenance } from '../src/domain/chapterAudioContract';

export interface RegistryRow {
  versionId: number;
  usfm: string;
  audioUrl: string | null;
  sourcePageUrl: string;
  observedAtUtc: string | null;
  /** What the SOURCE states. null = genuinely unknown. NEVER synthesised. */
  providerExpiry: string | null;
  evidenceDigest: string | null;
  resolutionStatus: ResolutionStatus;
  provenance: SourceProvenance;
}

/** OUR policy, not the provider's: an observed address must be re-confirmed after this long. */
export const REFRESH_POLICY_DAYS = 30;

export const OBSERVED_EVIDENCE = {
  path: 'evidence/audio-chapter-addresses-observed-20260911.json',
  sha256: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
  observedChapters: 21,
  septemberRequired: 42,
  note: 'plus GEN.1 from audio-public-source-research.md O3, independently observed and outside the 42',
} as const;

const CCB_1392_PROVENANCE: SourceProvenance = {
  publisher: 'Biblica',
  edition: '當代譯本(繁體)',
  recordingId: '1320',
  reference: '',
  attribution: 'Chinese Contemporary Bible Audio Edition ℗ 2011 Biblica, used by permission',
};

export const OBSERVED_ROWS: readonly RegistryRow[] = Object.freeze([
  {
    versionId: 1392,
    usfm: '1TI.1',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/1TI/1-d448ce90d1e1cc3b6c6379b2de535013.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/1TI.1',
    observedAtUtc: '2026-09-12T14:54:28.9646122Z',
    providerExpiry: null,
    // AUDIO-1TI1-OBSERVED-20260912.json: official player DOM plus a HEAD reconfirmation.
    evidenceDigest: '6112079ca9bbcd926cd686b5bcd50fde23a04b40cd31ae6f35940ef5e1470eb7',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.12',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/12-2fabe97e7f0c4a3708f6665a2e1aaa7b.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.12',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.13',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/13-53e1b90d2f8b534643862564e8bfb8b0.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.13',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.14',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/14-321943f4d93600bc2169217600f3dc57.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.14',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.15',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/15-f4705ab54e37dd1c28d3c08bc5c2cd29.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.15',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.16',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/16-518e897d1c11d1a596981448123291f6.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.16',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.17',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/17-80af9222398074d35e3559d4909086c5.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.17',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.18',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/18-abb702a24ed4b9affca40f319aacd2b8.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.18',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.19',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/19-1560e518a7e3d51118612659791dc45f.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.19',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.20',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/20-3e2f50088b288b4064497e6850f7184a.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.20',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'JHN.21',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/JHN/21-61cbaf192fbbd1122bcf6979b27c51a4.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/JHN.21',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.88',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/88-72b501e431a040423062a250ff40018f.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.88',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.89',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/89-2a1dd507f9cac474389222561cdc3c03.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.89',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.90',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/90-f17db0ea2a33d8ecb714026c18d9921d.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.90',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.91',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/91-406e0addf2289ca74eb9665a6f2c7bcf.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.91',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.92',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/92-7bfc0e8acbefbf625163db49a4eb8474.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.92',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.93',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/93-76684d05a15a53e3d8cd0f6cb4c59f5c.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.93',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.94',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/94-059a8356d25df5775899ecbf258c815a.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.94',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.95',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/95-73b76557c41ef7b9a6e71db18f468a6d.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.95',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.96',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/96-1feee9f8f0f8c046974b3e09bc4153e3.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.96',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'PSA.97',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/97-b878617bb388cc98eaac6c77c096a302.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/PSA.97',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: '59E99E7D5666E730AE368178A1F2C996E21E8031CC41724FC59079919FA64387',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
  {
    versionId: 1392,
    usfm: 'GEN.1',
    audioUrl: 'https://audio-bible-cdn.youversionapi.com/1320/32k/GEN/1-db32791c6e384befc8cd60ba480d29a9.mp3?version_id=1392',
    sourcePageUrl: 'https://www.bible.com/audio-bible/1392/GEN.1.CCB',
    observedAtUtc: '2026-09-11T12:29:07Z',
    providerExpiry: null,
    evidenceDigest: 'audio-public-source-research.md O3 (audio[src] == JSON-LD contentUrl)',
    resolutionStatus: 'verified_source',
    provenance: CCB_1392_PROVENANCE,
  },
]);

const key = (versionId: number, usfm: string) => `${versionId}::${usfm.trim().toUpperCase()}`;

/** OUR validity boundary for a row, or null when the row has no observation date. */
export function rowValidUntil(row: RegistryRow, refreshDays = REFRESH_POLICY_DAYS): string | null {
  if (!row.observedAtUtc) return null;
  const t = Date.parse(row.observedAtUtc);
  if (Number.isNaN(t)) return null;
  return new Date(t + refreshDays * 86_400_000).toISOString();
}

export interface ChapterAudioRegistry {
  lookup(versionId: number, usfm: string): RegistryRow | null;
  size(): number;
  keys(): string[];
}

/**
 * Build a registry over exactly these rows.
 *
 * Injectable on purpose (review 119 R6): the positive path must be provable against known data instead
 * of being left as a todo, and the expiry boundary must be provable with controlled rows.
 */
export function createChapterAudioRegistry(rows: readonly RegistryRow[]): ChapterAudioRegistry {
  const index = new Map<string, RegistryRow>();
  for (const r of rows) index.set(key(r.versionId, r.usfm), r);
  return {
    // EXACT key only. No nearest-match, no version fallback, no "first row" default: serving another
    // chapter's recording captioned as this one is the single worst failure this file could have.
    lookup: (versionId, usfm) => index.get(key(versionId, usfm)) ?? null,
    size: () => index.size,
    keys: () => [...index.keys()],
  };
}

export const chapterAudioRegistry = createChapterAudioRegistry(OBSERVED_ROWS);

export function lookupChapterAudio(versionId: number, usfm: string): RegistryRow | null {
  return chapterAudioRegistry.lookup(versionId, usfm);
}
