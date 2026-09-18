// chapterAudioContract.ts
// THE ONE DTO both the service and the App validate against.
//
// Review 119 R2/R3/R5 named three defects that all live at this boundary, so they are fixed here once
// rather than in each consumer:
//   R2  a capability with no identity cannot be checked against what was actually requested, so a late
//       or mismatched response can be pasted onto the current chapter. Identity is REQUIRED, and
//       validation compares it to the request rather than trusting the payload.
//   R3  expiresAt was declared in the parent spec and never enforced. Expiry is evaluated HERE, against
//       an injected now, so the boundary can be proven without a device and without waiting.
//   R5  provenance was hardcoded to one publisher. Provenance travels WITH the row, and a payload that
//       omits it does not silently inherit another edition's attribution.
//
// Two expiry fields, deliberately not one:
//   providerExpiry  what the SOURCE states. null means genuinely UNKNOWN. Never synthesised - inventing
//                   a provider expiry would be fabricating evidence about someone else's service.
//   validUntil      OUR policy: when this address must be re-confirmed. Ours to set, ours to enforce.
// An unknown provider expiry is NOT a promise of permanence, so validUntil still governs.

export const RESOLUTION_STATUSES = [
  'verified_source',
  'pending_observation',
  'temporarily_unavailable',
  'explicit_no_audio',
] as const;

export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export function isResolutionStatus(v: unknown): v is ResolutionStatus {
  return typeof v === 'string' && (RESOLUTION_STATUSES as readonly string[]).includes(v);
}

/** What was asked for. Every capability must answer for exactly this. */
export interface ChapterAudioIdentity {
  versionId: number;
  usfm: string;
}

export interface SourceProvenance {
  /** e.g. 'Biblica'. Travels with the row; never defaulted from another edition. */
  publisher: string;
  /** e.g. '當代譯本(繁體)'. */
  edition: string;
  /** the provider's own recording id for this row, as observed. */
  recordingId: string;
  /** human reference for display, e.g. '約13'. */
  reference: string;
  attribution: string;
}

/** One verse's position inside the chapter recording, as published by the provider's timing track. */
export interface VerseTiming {
  verse: number;
  start: number;
  end: number;
}

export interface ContentCapability {
  identity: ChapterAudioIdentity;
  text: boolean;
  audio: boolean;
  offline: false;
  status: ResolutionStatus;
  /** short zh-TW state for the product surface. Never a raw HTTP or exception string. */
  reason: string;
  uri?: string;
  /** what the SOURCE states, or null for genuinely unknown. Never fabricated. */
  providerExpiry?: string | null;
  /** OUR re-confirmation policy boundary. */
  validUntil?: string | null;
  provenance?: SourceProvenance;
  /** Ascending per-verse timing for the selected recording; absent when the provider gives none. */
  verseTiming?: VerseTiming[];
}

export type CapabilityRejection =
  | 'MALFORMED'
  | 'BAD_STATUS'
  | 'IDENTITY_MISMATCH'
  | 'AUDIO_WITHOUT_URI'
  | 'EXPIRED'
  | 'MALFORMED_EXPIRY'
  | 'URI_NOT_ALLOWED'
  | 'MISSING_PROVENANCE';

/**
 * Streaming-only means exactly one scheme (review 121 C3). Anything local (file, content), anything
 * inline (data), anything executable (javascript) and anything cleartext (http) is refused here rather
 * than at the player, so a bad address can never become a play attempt.
 */
export function isApprovedStreamUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false; // not a URL at all
  }
}

export type CapabilityCheck =
  | { ok: true; capability: ContentCapability & { uri: string; provenance: SourceProvenance } }
  | { ok: false; playable: false; rejection: CapabilityRejection; capability?: ContentCapability };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** null stays null (unknown). A present but unparseable value is an ERROR, never treated as unknown. */
function parseInstant(v: unknown): number | null | 'INVALID' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'INVALID';
  const t = Date.parse(v);
  return Number.isNaN(t) ? 'INVALID' : t;
}

function isProvenance(v: unknown): v is SourceProvenance {
  const p = v as Partial<SourceProvenance> | undefined;
  return !!p && nonEmpty(p.publisher) && nonEmpty(p.edition) && nonEmpty(p.recordingId)
    && nonEmpty(p.reference) && nonEmpty(p.attribution);
}

const sameUsfm = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Decide whether a raw payload is a PLAYABLE capability for exactly `requested`, at `nowMs`.
 *
 * Non-playable is not the same as broken: a well-formed explicit_no_audio is a legitimate answer and is
 * returned with ok:false plus the parsed capability so the UI can state it honestly. Only genuinely
 * unusable payloads come back without one.
 */
export function validateCapability(
  raw: unknown,
  requested: ChapterAudioIdentity,
  nowMs: number,
): CapabilityCheck {
  const c = raw as Partial<ContentCapability> | null | undefined;
  if (!c || typeof c !== 'object') return { ok: false, playable: false, rejection: 'MALFORMED' };
  if (typeof c.audio !== 'boolean' || typeof c.text !== 'boolean') {
    return { ok: false, playable: false, rejection: 'MALFORMED' };
  }
  if (!isResolutionStatus(c.status)) return { ok: false, playable: false, rejection: 'BAD_STATUS' };

  // R2: identity is REQUIRED and must answer for what was asked. A payload that omits it is refused
  // rather than assumed to be about the current chapter.
  const id = c.identity;
  if (!id || !isFiniteNumber(id.versionId) || !nonEmpty(id.usfm)) {
    return { ok: false, playable: false, rejection: 'IDENTITY_MISMATCH' };
  }
  if (id.versionId !== requested.versionId || !sameUsfm(id.usfm, requested.usfm)) {
    return { ok: false, playable: false, rejection: 'IDENTITY_MISMATCH' };
  }

  // Per-verse timing is optional and advisory (it only drives the reading highlight); keep the
  // well-formed ascending rows and silently drop the rest rather than rejecting the whole answer.
  const verseTiming: VerseTiming[] = Array.isArray(c.verseTiming)
    ? (c.verseTiming as unknown[]).flatMap((row) => {
        const r = row as { verse?: unknown; start?: unknown; end?: unknown } | null;
        return r && typeof r === 'object' && Number.isInteger(r.verse) && (r.verse as number) >= 1
          && typeof r.start === 'number' && Number.isFinite(r.start) && typeof r.end === 'number' && Number.isFinite(r.end) && r.end >= r.start
          ? [{ verse: r.verse as number, start: r.start, end: r.end }] : [];
      }).sort((left, right) => left.start - right.start)
    : [];
  const parsed: ContentCapability = {
    identity: { versionId: id.versionId, usfm: id.usfm },
    text: c.text,
    audio: c.audio,
    offline: false,
    status: c.status,
    reason: typeof c.reason === 'string' ? c.reason : '',
    providerExpiry: c.providerExpiry ?? null,
    validUntil: c.validUntil ?? null,
    provenance: c.provenance,
    uri: c.uri,
    ...(verseTiming.length > 0 ? { verseTiming } : {}),
  };

  // a non-audio answer is legitimate; hand it back so the surface can say so honestly
  if (!c.audio || c.status !== 'verified_source') {
    return { ok: false, playable: false, rejection: 'AUDIO_WITHOUT_URI', capability: parsed };
  }
  if (!nonEmpty(c.uri)) {
    return { ok: false, playable: false, rejection: 'AUDIO_WITHOUT_URI', capability: parsed };
  }

  // R3: expiry is enforced here, not merely passed through.
  const provider = parseInstant(c.providerExpiry);
  const valid = parseInstant(c.validUntil);
  if (provider === 'INVALID' || valid === 'INVALID') {
    return { ok: false, playable: false, rejection: 'MALFORMED_EXPIRY', capability: parsed };
  }
  if (provider !== null && provider <= nowMs) {
    return { ok: false, playable: false, rejection: 'EXPIRED', capability: parsed };
  }
  if (valid !== null && valid <= nowMs) {
    return { ok: false, playable: false, rejection: 'EXPIRED', capability: parsed };
  }
  // Review 121 C2. An UNKNOWN provider expiry is honest, but it is not a licence to serve forever: with
  // no provider boundary and no refresh boundary of our own, nothing would ever force re-confirmation
  // of an address we only ever observed once. Unknown therefore REQUIRES our own future validUntil.
  if (provider === null && valid === null) {
    return { ok: false, playable: false, rejection: 'MALFORMED_EXPIRY', capability: parsed };
  }

  // Review 121 C3. Only an approved https stream may reach a player. A non-empty string is not enough:
  // a file:// or content:// address would be local playback, which is outside the streaming-only scope,
  // and cleartext http would be an unprotected stream.
  if (!isApprovedStreamUri(c.uri)) {
    return { ok: false, playable: false, rejection: 'URI_NOT_ALLOWED', capability: parsed };
  }

  // R5: provenance must come from the row. No publisher/edition default.
  if (!isProvenance(c.provenance)) {
    return { ok: false, playable: false, rejection: 'MISSING_PROVENANCE', capability: parsed };
  }

  return { ok: true, capability: { ...parsed, uri: c.uri, provenance: c.provenance } };
}

/** Short zh-TW state for the product surface. Raw errors stay in diagnostics (R5). */
export function statusMessage(status: ResolutionStatus): string {
  switch (status) {
    case 'verified_source':
      return '';
    case 'explicit_no_audio':
      return '這一章沒有朗讀';
    case 'temporarily_unavailable':
      return '暫時無法取得，稍後可再試';
    case 'pending_observation':
    default:
      return '這一章的朗讀還沒取得';
  }
}

/** Can the reader offer a retry for this state? temporary and pending are retryable; no-audio is not. */
export function isRetryable(status: ResolutionStatus): boolean {
  return status === 'temporarily_unavailable' || status === 'pending_observation';
}
