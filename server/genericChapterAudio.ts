import { statusMessage, type ContentCapability, type ResolutionStatus, type VerseTiming } from '../src/domain/chapterAudioContract';
import { formatReferenceZhTw } from '../src/domain/scriptureReference';
import observedAttributions from './chapterAudioAttributions.json';

/** Observed YouVersion consumer endpoint, also exercised by the accepted native POC.
 * No chapter registry, filename construction, app credential or media download is used.
 */
export const CHAPTER_AUDIO_ENDPOINT = 'https://audio-bible.youversionapi.com/3.1/chapter.json';
// Provider catalogue rows are stable; a 6 h server cache means a chapter's first open of the day
// does not pay the 1–8 s upstream hop (the client re-confirms every 5 min against this cache).
const CACHE_MS = 6 * 60 * 60 * 1000;
const RECONFIRM_MS = 300_000; // Our refresh policy, never a claimed provider expiry.
const MAX_ENTRIES = 128;
const MAX_METADATA_BYTES = 2_000_000;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function unavailable(versionId: number, usfm: string, status: ResolutionStatus, reason = statusMessage(status)): ContentCapability {
  return { identity: { versionId, usfm }, text: false, audio: false, offline: false, status, reason };
}
function matchedChapter(timing: unknown, usfm: string): boolean {
  return Array.isArray(timing) && timing.some(value => {
    const row = object(value);
    return typeof row?.usfm === 'string' && row.usfm.toUpperCase().startsWith(`${usfm}.`);
  });
}
/** Per-verse timing of THIS recording for THIS chapter; malformed or foreign rows are dropped, never guessed. */
export function verseTimingOf(timing: unknown, usfm: string): VerseTiming[] {
  if (!Array.isArray(timing)) return [];
  const rows: VerseTiming[] = [];
  for (const value of timing) {
    const row = object(value);
    if (!row || typeof row.usfm !== 'string') continue;
    const match = /^([A-Z0-9]{2,5}\.[0-9]{1,3})\.([0-9]{1,3})$/.exec(row.usfm.trim().toUpperCase());
    if (!match || match[1] !== usfm) continue;
    const verse = Number(match[2]);
    const start = Number(row.start);
    const end = Number(row.end);
    if (!Number.isInteger(verse) || verse < 1 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    rows.push({ verse, start, end });
  }
  rows.sort((left, right) => left.start - right.start || left.verse - right.verse);
  return rows.filter((row, index) => index === 0 || row.verse !== rows[index - 1].verse);
}
function streamUri(downloads: unknown): string | null {
  const values = object(downloads);
  for (const key of ['format_mp3_32k', 'format_hls']) {
    const value = values?.[key]; if (!nonempty(value)) continue;
    try {
      const raw = value.trim(); const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.toString();
    } catch { /* A malformed MP3 can still have a valid endpoint-provided HLS alternative. */ }
  }
  return null;
}

/** Pure metadata boundary; selected source must answer for the requested version AND chapter. */
export function resolveChapterAudioMetadata(payload: unknown, versionId: number, usfm: string, observedAtMs: number, httpStatus = 200): ContentCapability {
  const response = object(object(payload)?.response);
  const errors = object(response?.data)?.errors;
  if (httpStatus === 404 && response?.code === 404 && Array.isArray(errors) && errors.length > 0
    && errors.every(error => object(error)?.key === 'audio_bible.reference.not_found')) {
    return unavailable(versionId, usfm, 'explicit_no_audio');
  }
  if (httpStatus !== 200 || response?.code !== 200 || !Array.isArray(response.data)) return unavailable(versionId, usfm, 'temporarily_unavailable');
  const rows = response.data;
  if (!rows.length) return unavailable(versionId, usfm, 'explicit_no_audio');
  const identityMatches = rows.map(object).filter((row): row is Record<string, unknown> => Boolean(row && row.version_id === versionId && matchedChapter(row.timing, usfm)));
  if (!identityMatches.length) return unavailable(versionId, usfm, 'temporarily_unavailable');
  // Keep the accepted POC rule: reject explicit drama and any title naming synthetic voice.
  // Metadata has no independent human-narrator attestation; do not invent one from a missing field.
  const eligible = identityMatches.filter(row => !row.dramatized && !(typeof row.title === 'string' && row.title.toLowerCase().includes('synthetic')));
  if (!eligible.length) return unavailable(versionId, usfm, 'explicit_no_audio', '這一章目前沒有可用的一般朗讀');
  const sources = eligible.flatMap(row => {
    const uri = streamUri(row.download_urls);
    return uri && (typeof row.id === 'number' || nonempty(row.id)) && nonempty(row.title) ? [{ row, uri }] : [];
  });
  if (!sources.length) return unavailable(versionId, usfm, 'temporarily_unavailable');
  const defaults = sources.filter(({ row }) => row.default === true);
  if (defaults.length > 1) return unavailable(versionId, usfm, 'temporarily_unavailable');
  const { row, uri } = defaults[0] ?? sources[0];
  // Static recording attribution is distinct from a chapter URL registry. Apply
  // it only when both observed version and recording id match the live source.
  const edition = observedAttributions.find(value => value.versionId === versionId);
  const recording = edition?.recordings.find(value => String(value.id) === String(row.id));
  const verseTiming = verseTimingOf(row.timing, usfm);
  return {
    identity: { versionId, usfm }, text: true, audio: true, offline: false, status: 'verified_source', reason: '', uri,
    providerExpiry: null, validUntil: new Date(observedAtMs + RECONFIRM_MS).toISOString(),
    ...(verseTiming.length > 0 ? { verseTiming } : {}),
    provenance: {
      publisher: recording?.publisher ?? '錄音出版者未由目錄提供', edition: edition?.edition ?? `版本 ${versionId}`, recordingId: String(row.id),
      reference: formatReferenceZhTw(usfm),
      attribution: [recording?.copyrightNotice, `YouVersion 音訊目錄 · ${String(row.title)} · https://www.bible.com/audio-bible/${versionId}/${usfm}`].filter(Boolean).join('\n'),
    },
  };
}

export function createChapterAudioResolver(options: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, { expiresAt: number; value: ContentCapability }>();
  const inflight = new Map<string, Promise<ContentCapability>>();
  async function query(versionId: number, usfm: string): Promise<ContentCapability> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
    try {
      const query = new URLSearchParams({ version_id: String(versionId), reference: usfm });
      const response = await fetchImpl(`${CHAPTER_AUDIO_ENDPOINT}?${query}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (Number(response.headers.get('content-length')) > MAX_METADATA_BYTES) { await response.body?.cancel(); return unavailable(versionId, usfm, 'temporarily_unavailable'); }
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_METADATA_BYTES) return unavailable(versionId, usfm, 'temporarily_unavailable');
      return resolveChapterAudioMetadata(JSON.parse(text), versionId, usfm, now(), response.status);
    } catch { return unavailable(versionId, usfm, 'temporarily_unavailable'); }
    finally { clearTimeout(timeout); }
  }
  const resolve = async (versionId: number, reference: string): Promise<ContentCapability> => {
    const usfm = reference.trim().toUpperCase();
    if (!Number.isSafeInteger(versionId) || versionId < 1 || !/^[A-Z0-9]{2,5}\.[1-9][0-9]{0,2}$/.test(usfm)) return unavailable(versionId, usfm, 'temporarily_unavailable');
    const key = `${versionId}:${usfm}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    cache.delete(key);
    const pending = inflight.get(key); if (pending) return pending;
    const work = query(versionId, usfm).then(value => {
      if (value.status !== 'temporarily_unavailable') {
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { expiresAt: now() + CACHE_MS, value });
      }
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, work); return work;
  };
  return resolve;
}

/** Warm the metadata cache for the given chapters × versions with bounded concurrency; failures are ignored. */
export async function prewarmChapterAudio(resolve: (versionId: number, reference: string) => Promise<ContentCapability>, versionIds: readonly number[], usfms: readonly string[], concurrency = 2): Promise<number> {
  const pairs = usfms.flatMap((usfm) => versionIds.map((versionId) => ({ versionId, usfm })));
  let index = 0; let done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, async () => {
    while (index < pairs.length) {
      const pair = pairs[index++];
      try { await resolve(pair.versionId, pair.usfm); done++; } catch { /* best effort */ }
    }
  }));
  return done;
}
