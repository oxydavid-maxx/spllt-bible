// contentCapabilityClient.ts
// Ask the service what it can offer for the chapter the reader is ACTUALLY on, and refuse anything that
// does not answer for that exact chapter.
//
// Review 119 R2 is the whole reason this file has a coordinator rather than a bare fetch function.
// Three independent defences, because each one alone has a hole:
//   1. ABORT      a superseded request is actually cancelled, so it stops competing.
//   2. GENERATION abort is not synchronous and an in-flight promise can still resolve, so a response
//                 from an older generation is dropped even if it arrives first.
//   3. IDENTITY   neither of the above helps if the SERVICE answers about the wrong chapter, so the
//                 payload's own identity is compared against what was requested.
// Prior art (AbortController + request-id guard) is the standard React race-condition fix; the identity
// check is the part that standard pattern does NOT give you, and 119 R2 requires it.
//
// R5: no raw HTTP status or exception text reaches the product surface. Those go to `diagnostic`,
// which the UI does not render.

import {
  isRetryable,
  statusMessage,
  validateCapability,
  type ChapterAudioIdentity,
  type ContentCapability,
  type ResolutionStatus,
  type SourceProvenance,
} from '../domain/chapterAudioContract';

export type CapabilityOutcome =
  | {
      kind: 'playable';
      identity: ChapterAudioIdentity;
      capability: ContentCapability & { uri: string; provenance: SourceProvenance };
    }
  | {
      kind: 'unavailable';
      identity: ChapterAudioIdentity;
      status: ResolutionStatus;
      /** short zh-TW, safe to render */
      message: string;
      retryable: boolean;
      /** raw detail for logs only; never rendered */
      diagnostic?: string;
    }
  /** superseded by a newer selection: the caller MUST NOT apply this to the current chapter */
  | { kind: 'stale'; identity: ChapterAudioIdentity };

/** The signed-in identity, exactly the shape src/services/authSession already exposes. */
export interface CapabilitySession {
  memberId: string;
  sessionToken: string;
}

export interface FetchArgs {
  baseUrl: string;
  identity: ChapterAudioIdentity;
  /**
   * Review 121 C1: a FUNCTION, not an instant. Expiry must be judged when the response ARRIVES.
   * Capturing a number before the await accepted capabilities that expired in flight.
   */
  now?: () => number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /**
   * Review 121 C6: the chapter route sits BEHIND authenticate() in server/routes.ts, so an anonymous
   * request is refused with 401 - no backend restart changes that. Credentials travel the same way the
   * rest of the App's API boundary sends them (see src/services/apiClient). Nothing is hardcoded here,
   * and the route is NOT made public.
   */
  session?: CapabilitySession | null;
}

function authHeaders(session: CapabilitySession | null | undefined): Record<string, string> {
  if (!session?.sessionToken || !session.memberId) return {};
  return {
    authorization: `Bearer ${session.sessionToken}`,
    'x-qingmu-member-id': session.memberId,
  };
}

export const sameCapabilitySession = (
  a: CapabilitySession | null | undefined,
  b: CapabilitySession | null | undefined,
): boolean =>
  (a?.memberId ?? null) === (b?.memberId ?? null) && (a?.sessionToken ?? null) === (b?.sessionToken ?? null);

const unavailable = (
  identity: ChapterAudioIdentity,
  status: ResolutionStatus,
  diagnostic?: string,
): CapabilityOutcome => ({
  kind: 'unavailable',
  identity,
  status,
  message: statusMessage(status),
  retryable: isRetryable(status),
  diagnostic,
});

export function capabilityUrl(baseUrl: string, identity: ChapterAudioIdentity): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/content-capabilities`
    + `?versionId=${encodeURIComponent(String(identity.versionId))}`
    + `&usfm=${encodeURIComponent(identity.usfm)}`;
}

/** One request. Any failure degrades to temporarily_unavailable, never to "this chapter has no audio". */
export async function fetchChapterCapability(args: FetchArgs): Promise<CapabilityOutcome> {
  const { baseUrl, identity } = args;
  const doFetch = args.fetchImpl ?? fetch;
  const clock = args.now ?? Date.now;
  let body: unknown;
  try {
    const res = await doFetch(capabilityUrl(baseUrl, identity), {
      signal: args.signal,
      headers: authHeaders(args.session),
    });
    if (!res.ok) return unavailable(identity, 'temporarily_unavailable', `HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return unavailable(identity, 'temporarily_unavailable', detail);
  }

  // C1: read the clock HERE, after the round trip. A capability that expired in flight must not be
  // accepted just because it was still valid at the moment the request left.
  const check = validateCapability(body, identity, clock());
  if (check.ok) return { kind: 'playable', identity, capability: check.capability };

  // A well-formed non-audio answer keeps its own honest status. Anything structurally wrong - bad
  // identity, bad enum, expired, missing provenance - is reported as temporarily unavailable and is
  // NEVER allowed to read as "no recording exists".
  const status: ResolutionStatus =
    check.capability && check.rejection === 'AUDIO_WITHOUT_URI' && check.capability.status !== 'verified_source'
      ? check.capability.status
      : 'temporarily_unavailable';
  return unavailable(identity, status, `rejected:${check.rejection}`);
}

export interface CapabilityCoordinator {
  /** Request for this identity, superseding any in flight. Resolves 'stale' if superseded meanwhile. */
  request(identity: ChapterAudioIdentity, now?: () => number): Promise<CapabilityOutcome>;
  /** Abandon whatever is in flight: chapter change, version change, leaving the reader, unmount. */
  cancel(): void;
  /** current generation, for tests and diagnostics */
  generation(): number;
}

export function createCapabilityCoordinator(config: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /**
   * Review 121 C6. Read at REQUEST time and checked again at RESPONSE time, so a result fetched under
   * one identity is never applied after a sign-in, sign-out, account switch or token refresh.
   */
  getSession?: () => CapabilitySession | null;
}): CapabilityCoordinator {
  let generation = 0;
  let inFlight: AbortController | null = null;

  const abortInFlight = () => {
    if (inFlight) {
      try {
        inFlight.abort();
      } catch {
        /* an already-aborted controller is fine */
      }
      inFlight = null;
    }
  };

  return {
    generation: () => generation,
    cancel: () => {
      generation += 1; // anything still in flight is now from an older generation
      abortInFlight();
    },
    request: async (identity, now) => {
      abortInFlight();
      generation += 1;
      const mine = generation;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      inFlight = controller;
      const sessionAtRequest = config.getSession?.() ?? null;

      const outcome = await fetchChapterCapability({
        baseUrl: config.baseUrl,
        identity,
        now,
        signal: controller?.signal,
        fetchImpl: config.fetchImpl,
        session: sessionAtRequest,
      });

      // The generation check is what actually protects the current chapter: abort is not synchronous,
      // and a slow earlier request can still resolve after a newer one has already been applied.
      if (mine !== generation) return { kind: 'stale', identity };
      // C6: the same argument applies to IDENTITY. A sign-out, account switch or token refresh while
      // this was in flight means the answer belongs to someone who is no longer signed in.
      if (config.getSession && !sameCapabilitySession(sessionAtRequest, config.getSession())) {
        return { kind: 'stale', identity };
      }
      if (inFlight === controller) inFlight = null;
      return outcome;
    },
  };
}
