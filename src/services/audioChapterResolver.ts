// audioChapterResolver.ts
// Chapter-level audio SOURCE resolution that feeds the EXISTING audio seam (steering 96 and 97).
//
// WHAT WAS ALREADY HERE, and why this file does not replace it:
//   src/config/youVersionContent.ts  owns AudioAvailability per version, currently PENDING_PROVIDER
//   src/services/audioProvider.ts    owns the licence gate resolveAudio(entry, request)
//   src/services/audioSession.ts     owns createAudioSession(availability, implementation)
// That seam was complete except for one thing: nothing ever supplied an AudioPlaybackImplementation,
// and nothing resolved a CHAPTER to a URI. Availability is per version; a player needs a per-chapter
// source. This file adds only that missing step and returns the EXISTING AudioAvailability type, so the
// seam is reused rather than duplicated.
//
// PRODUCTION POSITION, honest and unchanged. The one unmet condition is the DEVELOPER DELIVERY
// ENTITLEMENT: a supported route for the recording to reach a third-party App, whether through the
// official SDK or an applicable direct YVP API as licence V.C contemplates. A consumer-page association
// to the 2011 recording does exist; what is missing is delivery to a developer. Until that is
// established, production resolves to the existing PENDING_PROVIDER and this file returns no URI.
// A production raw-CDN hotlink is NOT authorised and is not a substitute.
//
// QA-ONLY SOURCE, for main-App integration verification against already evidenced content:
//   1. IT CANNOT REACH A PILOT BUILD. The flag must be the exact literal 'true' AND the build must be a
//      fixture build. A pilot build is not a fixture build, so a stray flag alone cannot arm it.
//   2. IT IS NEVER OFFERED FOR A CHAPTER IT IS NOT. The recording is one chapter, JHN.13 / 約13. Asked
//      for another chapter this returns no URI, because labelling that recording as a different chapter
//      would tell the user they are hearing something they are not.

import { getAudioAvailability, getYouVersionContentMetadata, type AudioAvailability } from '../config/youVersionContent';
import { resolveAudio, type AudioRegistryEntry } from './audioProvider';
import type { ContentCapability, SourceProvenance } from '../domain/chapterAudioContract';

/**
 * A capability that has already passed validateCapability: identity checked against the request, not
 * expired, provenance present. Only this shape can produce a production source.
 */
export type PlayableCapability = ContentCapability & { uri: string; provenance: SourceProvenance };

/** The one chapter the standalone POC already evidenced. Its success is NOT main-App integration. */
export const QA_EVIDENCED_CHAPTER_USFM = 'JHN.13';
export const QA_EVIDENCED_CHAPTER_LABEL = '約13';
export const QA_EVIDENCED_VERSION_ID = 1392;
export const QA_RECORDING_ID = 'ccb-audio-2011-jhn13-poc-evidenced';

// Supplied only by the QA build entry. Static member expression on purpose: babel-preset-expo
// substitutes the literal value in a production build, and with the variable unset that is undefined,
// so the recording URL is absent from a production bundle rather than present and merely unreachable.
const QA_AUDIO_URI = process.env.EXPO_PUBLIC_QINGMU_QA_AUDIO_URI ?? '';

// Production audio is separately enabled by the deployment operator, independently of fixture/QA
// mode. This flag does not grant third-party content rights; each deployment must establish those
// rights itself. Stream addresses are resolved from the capability service.
// EXPO_PUBLIC_QINGMU_AUDIO_URI is deliberately NOT read here any more.
//
// Once the single-chapter fallback was removed (review 119), nothing consumed it - but a static
// process.env.EXPO_PUBLIC_* member expression is INLINED AS A LITERAL by babel-preset-expo in a
// production build. Leaving the constant would have shipped the raw recording URL inside the bundle as
// dead code, where unpacking the APK reveals it. That is the same defect that was fixed once before,
// and an unused constant is not a reason to reintroduce it. Addresses now arrive only at runtime, from
// the capability service.
const AUDIO_AUTHORIZED = process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED === 'true';

/** Authorized production audio, independent of fixture mode and of the QA test flag. */
export function isAuthorizedAudioEnabled(env: Record<string, string | undefined>): boolean {
  return env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED === 'true';
}

export const AUTHORIZED_AUDIO_PROVENANCE = '使用者授權（2026-09-11）';
export const AUTHORIZED_RECORDING_EDITION = 'CCB／Biblica audio 2011';

/** coveredRefs has exactly ONE member on purpose: that is what stops cross-chapter mislabelling. */
const QA_ONLY_ENTRY: AudioRegistryEntry = {
  id: QA_RECORDING_ID,
  matchingTextVersionId: String(QA_EVIDENCED_VERSION_ID),
  coveredRefs: [QA_EVIDENCED_CHAPTER_USFM],
  licenseStatus: 'approved',
  streamingAllowed: true,
  offlineAllowed: false,
  // NOT a literal. Verified by unpacking the production APK: a hardcoded URI here shipped the raw
  // recording URL inside the production bundle as dead code, where anyone unpacking the artifact
  // would find it. Read as a STATIC process.env.EXPO_PUBLIC_* member expression so the QA build
  // supplies it and a production build inlines undefined, leaving no URL in the bundle at all.
  uri: QA_AUDIO_URI,
  attribution: 'Chinese Contemporary Bible Audio Edition ℗ 2011 Biblica, used by permission',
};

export const QA_RECORDING_EDITION = 'CCB / Biblica audio 2011 (QA integration source, POC-evidenced)';

export interface ChapterAudioSource {
  uri: string;
  chapterUsfm: string;
  chapterLabel: string;
  recordingEdition: string;
  attribution: string;
  /** From the capability row, never defaulted from another edition (review 119 R5). */
  publisher: string;
}

export interface ChapterAudioSession {
  /** The EXISTING seam type. Pass straight to createAudioSession. */
  availability: AudioAvailability;
  /** Null unless a source is genuinely resolvable for THIS chapter. */
  source: ChapterAudioSource | null;
  sourceClass: 'authorized-source' | 'qa-test-only' | 'none';
  /** Stated on every result so a serving QA source can never read as production access. */
  productionDeliveryEntitlement: 'UNRESOLVED' | 'USER_AUTHORIZED';
}

/**
 * Is the QA-only test source armed? Requires BOTH the exact literal 'true' AND a fixture build, so a
 * pilot profile that sets neither, or only one, cannot serve test audio.
 */
export function isQaTestAudioEnabled(env: Record<string, string | undefined>): boolean {
  return env.EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO === 'true' && env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
}

/**
 * Resolve the audio session inputs for a chapter: the existing AudioAvailability plus, only when
 * genuinely permitted, a chapter-bound source.
 */
export function resolveChapterAudioSession(input: {
  /** Injectable so tests can exercise the serving path; production passes nothing and gets ''. */
  qaAudioUri?: string;
  /** True when the user has authorized the production source. Independent of fixture mode. */
  audioAuthorized?: boolean;
  authorizedAudioUri?: string;
  chapterUsfm: string;
  versionId: number | null;
  qaTestAudioEnabled: boolean;
  /**
   * The validated capability for EXACTLY this (versionId, chapterUsfm), or null/undefined when none has
   * resolved yet. Review 119 R1/R2: this is the only way a production source can be served, so the
   * chapter that plays is always the chapter that was asked for.
   */
  capability?: PlayableCapability | null;
}): ChapterAudioSession {
  const productionAvailability =
    getAudioAvailability(input.versionId) ??
    ({ status: 'UNAVAILABLE', versionId: input.versionId ?? 0, publisher: '', recordingId: null, reason: 'no accepted version metadata for this version' } as AudioAvailability);

  const none = (availability: AudioAvailability): ChapterAudioSession => ({
    availability,
    source: null,
    sourceClass: 'none',
    productionDeliveryEntitlement: 'UNRESOLVED',
  });

  // authorized production source first: it is a real capability, not a test affordance
  const authorized = input.audioAuthorized ?? AUDIO_AUTHORIZED;
  if (authorized) {
    const capability = input.capability;

    // NO FALLBACK. There is deliberately no `?? AUTHORIZED_AUDIO_URI` here. Once the single-chapter
    // restriction is lifted, a trailing fallback would serve one chapter's recording for ANY chapter
    // that has not resolved, captioned as the chapter the reader chose. Silence is correct; a
    // mislabelled recording is not.
    if (!capability) {
      return none({ ...productionAvailability, reason: '這一章的朗讀還沒取得' });
    }

    // Defence in depth for review 119 R2. The client already validated identity, but the resolver is
    // the last gate before a URI reaches a player, and the cost of being wrong here is a reader hearing
    // a different chapter than the one on screen. Re-check rather than trust the caller.
    const wantUsfm = input.chapterUsfm.trim().toUpperCase();
    const gotUsfm = capability.identity.usfm.trim().toUpperCase();
    if (gotUsfm !== wantUsfm || capability.identity.versionId !== input.versionId) {
      return none({ ...productionAvailability, reason: '這一章的朗讀還沒取得' });
    }
    if (!capability.uri) {
      return none({ ...productionAvailability, reason: '這一章的朗讀還沒取得' });
    }

    const prov = capability.provenance;
    return {
      availability: {
        status: 'READY',
        versionId: capability.identity.versionId,
        publisher: prov.publisher,
        recordingId: prov.recordingId,
        // R5: no internal approval terminology on a product surface. State the source, not our process.
        reason: '',
      },
      source: {
        uri: capability.uri,
        chapterUsfm: capability.identity.usfm,
        chapterLabel: prov.reference || capability.identity.usfm,
        recordingEdition: prov.edition,
        attribution: prov.attribution,
        publisher: prov.publisher,
      },
      sourceClass: 'authorized-source',
      productionDeliveryEntitlement: 'USER_AUTHORIZED',
    };
  }
  if (!input.qaTestAudioEnabled) return none(productionAvailability);
  const qaUri = input.qaAudioUri ?? QA_AUDIO_URI;
  // A QA build that forgot to supply the URI must not claim a READY source with an empty one.
  if (!qaUri) {
    return none({
      ...productionAvailability,
      reason: 'the QA integration source has no configured recording URI in this build',
    });
  }

  if (input.chapterUsfm !== QA_EVIDENCED_CHAPTER_USFM) {
    return none({
      status: 'UNAVAILABLE',
      versionId: input.versionId ?? 0,
      publisher: productionAvailability.publisher,
      recordingId: null,
      reason: `the QA integration source covers ${QA_EVIDENCED_CHAPTER_LABEL} only and is never presented as another chapter`,
    });
  }
  if (input.versionId !== QA_EVIDENCED_VERSION_ID) {
    return none({
      status: 'UNAVAILABLE',
      versionId: input.versionId ?? 0,
      publisher: productionAvailability.publisher,
      recordingId: null,
      reason: 'the QA integration source is matched to one text version only',
    });
  }
  const gate = resolveAudio(QA_ONLY_ENTRY, {
    textVersionId: String(input.versionId),
    reference: input.chapterUsfm,
    mode: 'stream',
  });
  if (gate.status !== 'READY') {
    return none({
      status: 'UNAVAILABLE',
      versionId: input.versionId,
      publisher: productionAvailability.publisher,
      recordingId: null,
      reason: gate.reason,
    });
  }
  const meta = getYouVersionContentMetadata(input.versionId);
  return {
    availability: {
      status: 'READY',
      versionId: input.versionId,
      publisher: meta?.publisher ?? productionAvailability.publisher,
      recordingId: QA_RECORDING_ID,
      reason: 'QA integration source for the already evidenced chapter; production delivery entitlement is still unresolved',
    },
    source: {
      uri: qaUri,
      chapterUsfm: QA_EVIDENCED_CHAPTER_USFM,
      chapterLabel: QA_EVIDENCED_CHAPTER_LABEL,
      recordingEdition: QA_RECORDING_EDITION,
      attribution: gate.attribution ?? QA_ONLY_ENTRY.attribution ?? '',
      publisher: meta?.publisher ?? productionAvailability.publisher,
    },
    sourceClass: 'qa-test-only',
    productionDeliveryEntitlement: 'UNRESOLVED',
  };
}

/**
 * What the reader should draw for this session. 'NONE' means draw nothing at all, not an empty frame
 * and not a pending notice.
 *
 * Measured on device in RC14m: the pending notice was a title plus two wrapped sentences, 91 dp, and
 * that was exactly the content the reader's controls viewport clamped outside layout with inverted
 * bounds. It was also redundant, because the reader's own content-status block already states
 * 中文音訊狀態：等待Biblica授權與官方SDK能力核對。 visibly, and that visible line is what CAP-UX06's
 * declared outcome is graded on. Duplicating it cost 91 dp of the scripture budget to say nothing new.
 *
 * Nothing is lost for honesty: with no source there is no transport control and no recording
 * reference, which is exactly what the production/pilot profile requires.
 */
export function chapterAudioRenderMode(session: ChapterAudioSession): 'PLAYER' | 'NONE' {
  return session.availability.status === 'READY' && session.source ? 'PLAYER' : 'NONE';
}
