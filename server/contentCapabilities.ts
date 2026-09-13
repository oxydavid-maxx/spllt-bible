// contentCapabilities.ts
// Turn a registry row into the ContentCapability the App validates. This is the service half of the
// contract in src/domain/chapterAudioContract.ts; both halves share that one module on purpose, so the
// producer cannot drift from what the consumer enforces.
//
// Review 119 corrections implemented here:
//   R2  every response carries the identity it answers for. The App compares it to what it asked, so a
//       late or crossed response can be refused instead of pasted onto the current chapter.
//   R3  expiry is EVALUATED here, not passed through. A row past its provider expiry or past OUR
//       validUntil is not playable, and the caller gets a retryable status rather than a stale URI.
//   R5  publisher/edition/recording/reference come from the row. Nothing defaults to CCB or Biblica,
//       and an unknown (versionId, usfm) does NOT get text:true just for asking.

import {
  statusMessage,
  type ContentCapability,
  type ResolutionStatus,
} from '../src/domain/chapterAudioContract';
import { formatReferenceZhTw } from '../src/domain/scriptureReference';
import {
  chapterAudioRegistry,
  rowValidUntil,
  type ChapterAudioRegistry,
  type RegistryRow,
} from './contentRegistry';

export interface EvaluateOptions {
  registry?: ChapterAudioRegistry;
  /** injected so the expiry boundary is provable without waiting for real time to pass */
  nowMs?: number;
  refreshDays?: number;
}

function base(
  versionId: number,
  usfm: string,
  status: ResolutionStatus,
  text: boolean,
): ContentCapability {
  return {
    identity: { versionId, usfm },
    text,
    audio: false,
    offline: false,
    status,
    reason: statusMessage(status),
  };
}

function provenanceFor(row: RegistryRow) {
  // the zh-TW reference is derived with the project's existing formatter rather than a second mapping
  return { ...row.provenance, reference: formatReferenceZhTw(row.usfm) || row.usfm };
}

/**
 * What can this service honestly offer for exactly (versionId, usfm) at nowMs?
 *
 * An UNKNOWN chapter is `pending_observation`, never `explicit_no_audio`: we have not obtained the
 * address, which is not the same as the provider stating there is no recording. Collapsing those two
 * would tell a reader a recording does not exist when we simply never looked.
 */
export function evaluateContentCapability(
  versionId: number,
  usfm: string,
  options: EvaluateOptions = {},
): ContentCapability {
  const registry = options.registry ?? chapterAudioRegistry;
  const nowMs = options.nowMs ?? Date.now();
  const row = registry.lookup(versionId, usfm);

  // R5: an unknown pair is not asserted to have text either. We only speak for rows we hold.
  if (!row) return base(versionId, usfm, 'pending_observation', false);

  if (row.resolutionStatus !== 'verified_source' || !row.audioUrl) {
    return base(versionId, usfm, row.resolutionStatus, true);
  }

  // R3 — provider expiry first. null stays UNKNOWN and is never turned into a guarantee.
  if (row.providerExpiry !== null) {
    const t = Date.parse(row.providerExpiry);
    if (Number.isNaN(t)) return base(versionId, usfm, 'temporarily_unavailable', true);
    if (t <= nowMs) return base(versionId, usfm, 'temporarily_unavailable', true);
  }

  // R3 — then OUR refresh policy. Past it, the address must be re-confirmed before it is served again.
  const validUntil = rowValidUntil(row, options.refreshDays);
  if (validUntil !== null) {
    const t = Date.parse(validUntil);
    if (!Number.isNaN(t) && t <= nowMs) {
      return base(versionId, usfm, 'temporarily_unavailable', true);
    }
  }

  return {
    identity: { versionId: row.versionId, usfm: row.usfm },
    text: true,
    audio: true,
    offline: false,
    status: 'verified_source',
    reason: '',
    uri: row.audioUrl,
    providerExpiry: row.providerExpiry,
    validUntil,
    provenance: provenanceFor(row),
  };
}

/** Parse and validate the query for the HTTP route. Kept separate so it is testable without a server. */
export function parseCapabilityQuery(
  query: Record<string, string | undefined>,
): { ok: true; versionId: number; usfm: string } | { ok: false; error: string } {
  const rawVersion = query.versionId?.trim();
  const usfm = query.usfm?.trim();
  if (!rawVersion || !usfm) return { ok: false, error: 'VERSION_ID_AND_USFM_REQUIRED' };
  const versionId = Number(rawVersion);
  if (!Number.isSafeInteger(versionId) || versionId < 1) {
    return { ok: false, error: 'VERSION_ID_MUST_BE_AN_INTEGER' };
  }
  if (!/^[A-Za-z0-9]{2,5}\.[1-9][0-9]{0,2}$/.test(usfm)) return { ok: false, error: 'USFM_MALFORMED' };
  return { ok: true, versionId, usfm: usfm.toUpperCase() };
}
