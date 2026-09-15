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
  /** Optional owner/generation guard checked before each attempt and after backoff. */
  isCurrent?: () => boolean;
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

const CAPABILITY_MAX_ATTEMPTS = 2;
const CAPABILITY_RETRY_BACKOFF_MS = 100;
// The backend resolver itself has an 8s upstream cap. Keep a client-side margin so a normal
// backend response is not aborted just as that producer finishes, while the whole operation remains bounded.
const CAPABILITY_ATTEMPT_TIMEOUT_MS = 10_000;
const CAPABILITY_OVERALL_DEADLINE_MS = 21_000;
const REQUEST_TIMEOUT = Symbol('CAPABILITY_REQUEST_TIMEOUT');
const REQUEST_ABORTED = Symbol('CAPABILITY_REQUEST_ABORTED');

type RequestAttempt =
  | { kind: 'body'; body: unknown }
  | { kind: 'http'; status: number; retryable: boolean; retryAfterMs?: number }
  | { kind: 'transport'; diagnostic: string; retryable: boolean }
  | { kind: 'schema'; diagnostic: string }
  | { kind: 'aborted' };

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = value.trim();
  if (/^\d+$/u.test(seconds)) return Number(seconds) * 1000;
  const when = Date.parse(seconds);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

function isCurrentRequest(args: FetchArgs): boolean {
  return !args.signal?.aborted && (args.isCurrent?.() ?? true);
}

async function requestAttempt(args: FetchArgs, deadline: number): Promise<RequestAttempt> {
  if (!isCurrentRequest(args)) return { kind: 'aborted' };
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { kind: 'transport', diagnostic: 'CAPABILITY_REQUEST_TIMEOUT', retryable: false };

  const attemptController = typeof AbortController === 'function' ? new AbortController() : null;
  const outerSignal = args.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let outerAborted = false;
  let removeOuterAbort: (() => void) | undefined;
  const work = (async (): Promise<RequestAttempt> => {
    try {
      const response = await (args.fetchImpl ?? fetch)(capabilityUrl(args.baseUrl, args.identity), {
        signal: attemptController?.signal,
        headers: authHeaders(args.session),
      });
      if (!response.ok) {
        const retryAfterHeader = response.status === 429 && typeof response.headers?.get === 'function'
          ? response.headers.get('retry-after')
          : null;
        const retryAfterMs = response.status === 429 ? parseRetryAfter(retryAfterHeader) : undefined;
        return {
          kind: 'http',
          status: response.status,
          // A throttled response without a usable Retry-After is final for this read. Retrying it
          // after a fixed 100ms would ignore the provider's pacing contract.
          retryable: retryableHttpStatus(response.status) && (response.status !== 429 || retryAfterMs !== null),
          retryAfterMs: retryAfterMs ?? undefined,
        };
      }
      try {
        return { kind: 'body', body: await response.json() };
      } catch (error) {
        if (outerAborted || outerSignal?.aborted) return { kind: 'aborted' };
        if (timedOut) return { kind: 'transport', diagnostic: 'CAPABILITY_REQUEST_TIMEOUT', retryable: true };
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'SyntaxError')) {
          return error.name === 'AbortError'
            ? { kind: 'aborted' }
            : { kind: 'schema', diagnostic: 'CAPABILITY_RESPONSE_INVALID' };
        }
        return { kind: 'transport', diagnostic: error instanceof Error ? error.message : String(error), retryable: true };
      }
    } catch (error) {
      if (outerAborted || outerSignal?.aborted) return { kind: 'aborted' };
      if (timedOut) return { kind: 'transport', diagnostic: 'CAPABILITY_REQUEST_TIMEOUT', retryable: true };
      if (error instanceof Error && error.name === 'AbortError') return { kind: 'aborted' };
      return { kind: 'transport', diagnostic: error instanceof Error ? error.message : String(error), retryable: true };
    }
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try { attemptController?.abort(); } catch { /* the timeout result is still bounded */ }
      reject(REQUEST_TIMEOUT);
    }, Math.min(CAPABILITY_ATTEMPT_TIMEOUT_MS, remaining));
  });
  const abort = outerSignal
    ? new Promise<never>((_, reject) => {
      const onAbort = () => {
        outerAborted = true;
        try { attemptController?.abort(); } catch { /* already aborted */ }
        reject(REQUEST_ABORTED);
      };
      removeOuterAbort = () => outerSignal.removeEventListener('abort', onAbort);
      if (outerSignal.aborted) onAbort();
      else outerSignal.addEventListener('abort', onAbort, { once: true });
    })
    : new Promise<never>(() => {});
  try {
    return await Promise.race([work, timeout, abort]);
  } catch (error) {
    if (error === REQUEST_ABORTED || outerAborted || outerSignal?.aborted) return { kind: 'aborted' };
    if (error === REQUEST_TIMEOUT || timedOut) return { kind: 'transport', diagnostic: 'CAPABILITY_REQUEST_TIMEOUT', retryable: true };
    return { kind: 'transport', diagnostic: error instanceof Error ? error.message : String(error), retryable: true };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeOuterAbort?.();
  }
}

function waitForRetry(ms: number, args: FetchArgs): Promise<boolean> {
  if (!isCurrentRequest(args)) return Promise.resolve(false);
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const outerSignal = args.signal;
    const onAbort = () => finish(false);
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    timer = setTimeout(() => finish(isCurrentRequest(args)), ms);
    outerSignal?.addEventListener('abort', onAbort, { once: true });
    if (outerSignal?.aborted) finish(false);
  });
}

function classifyCapabilityBody(raw: unknown, identity: ChapterAudioIdentity, nowMs: number): { outcome: CapabilityOutcome; retryable: boolean } {
  const check = validateCapability(raw, identity, nowMs);
  if (check.ok) return { outcome: { kind: 'playable', identity, capability: check.capability }, retryable: false };
  const status: ResolutionStatus =
    check.capability && check.rejection === 'AUDIO_WITHOUT_URI' && check.capability.status !== 'verified_source'
      ? check.capability.status
      : 'temporarily_unavailable';
  return {
    outcome: unavailable(identity, status, `rejected:${check.rejection}`),
    // A well-formed backend temporary/pending answer is transient. Identity/schema and explicit
    // absence answers stay final so retry cannot turn a bad/missing record into a different claim.
    retryable: check.rejection === 'AUDIO_WITHOUT_URI' && (status === 'temporarily_unavailable' || status === 'pending_observation'),
  };
}

export function capabilityUrl(baseUrl: string, identity: ChapterAudioIdentity): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/content-capabilities`
    + `?versionId=${encodeURIComponent(String(identity.versionId))}`
    + `&usfm=${encodeURIComponent(identity.usfm)}`;
}

/** One bounded request with one automatic retry for transient transport/backend failures. */
export async function fetchChapterCapability(args: FetchArgs): Promise<CapabilityOutcome> {
  const { identity } = args;
  const clock = args.now ?? Date.now;
  const deadline = Date.now() + CAPABILITY_OVERALL_DEADLINE_MS;
  let attempt = 0;
  while (attempt < CAPABILITY_MAX_ATTEMPTS) {
    if (!isCurrentRequest(args)) return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');
    const result = await requestAttempt(args, deadline);
    if (result.kind === 'aborted') return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');
    if (!isCurrentRequest(args)) return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');

    let outcome: CapabilityOutcome;
    let retryable = false;
    if (result.kind === 'body') {
      const classified = classifyCapabilityBody(result.body, identity, clock());
      outcome = classified.outcome;
      retryable = classified.retryable;
    } else if (result.kind === 'http') {
      outcome = unavailable(identity, 'temporarily_unavailable', `HTTP ${result.status}`);
      retryable = result.retryable;
    } else if (result.kind === 'schema') {
      outcome = unavailable(identity, 'temporarily_unavailable', result.diagnostic);
    } else {
      outcome = unavailable(identity, 'temporarily_unavailable', result.diagnostic);
      retryable = result.retryable;
    }

    if (!isCurrentRequest(args)) return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');
    if (!retryable || attempt + 1 >= CAPABILITY_MAX_ATTEMPTS) return outcome;
    if (!isCurrentRequest(args)) return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');
    const remaining = deadline - Date.now();
    const retryDelay = result.kind === 'http' && result.status === 429
      ? result.retryAfterMs!
      : CAPABILITY_RETRY_BACKOFF_MS;
    if (remaining <= retryDelay) return outcome;
    if (!await waitForRetry(Math.min(retryDelay, remaining), args)) {
      return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_ABORTED');
    }
    attempt += 1;
  }
  return unavailable(identity, 'temporarily_unavailable', 'CAPABILITY_REQUEST_TIMEOUT');
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
        isCurrent: () => mine === generation && (!config.getSession || sameCapabilitySession(sessionAtRequest, config.getSession())),
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
