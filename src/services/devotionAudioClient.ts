import type { DevotionSpeechRequest } from './devotionSpeech';
import type { DevotionClientOptions } from './devotionClient';
import { notifyAuthExpired } from './authState';

export async function fetchDevotionAudio(options: DevotionClientOptions, request: DevotionSpeechRequest, signal: AbortSignal): Promise<Uint8Array> {
  const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl}/api/devotional/${encodeURIComponent(request.date)}/audio/${request.index}?voice=${request.voice}`, {
    signal, headers: { authorization: `Bearer ${options.token}` },
  });
  if (response.status === 401) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) {
    await response.body?.cancel();
    throw new Error('DEVOTIONAL_AUDIO_UNAVAILABLE');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted || !bytes.length) throw new Error('DEVOTIONAL_AUDIO_UNAVAILABLE');
  return bytes;
}

type FetchOne = (request: DevotionSpeechRequest, signal: AbortSignal) => Promise<Uint8Array>;

/**
 * Downloads paragraph N+1 as soon as N has arrived, so only the first paragraph waits on the network: on
 * 2026-10-16 a 355 KB paragraph mid-devotion once missed the engine's 8 s wait and fell back to device speech.
 * One download is kept ahead; another voice, day or paragraph cancels it. A failed early download is retried once.
 */
export function createPrefetchingDevotionAudio(fetchOne: FetchOne): FetchOne {
  const keyOf = (r: DevotionSpeechRequest) => `${r.date}|${r.index}|${r.voice}`;
  let ahead: { key: string; bytes: Promise<Uint8Array>; controller: AbortController } | undefined;
  function start(request: DevotionSpeechRequest) {
    const controller = new AbortController();
    const bytes = fetchOne(request, controller.signal);
    bytes.catch(() => undefined);
    return { key: keyOf(request), bytes, controller };
  }
  return async function fetchAudio(request, signal) {
    const key = keyOf(request);
    if (ahead?.key !== key) { ahead?.controller.abort(); ahead = start(request); }
    const entry = ahead;
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const stop = () => reject(new Error('DEVOTIONAL_AUDIO_CANCELLED'));
      if (signal.aborted) { stop(); return; }
      signal.addEventListener('abort', stop, { once: true });
      entry.bytes.catch(() => {
        // An early download that failed gets one fresh try, now that this paragraph is really wanted.
        if (ahead !== entry) throw new Error('DEVOTIONAL_AUDIO_CANCELLED');
        ahead = start(request);
        return ahead.bytes;
      }).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
    });
    if (ahead?.key === key) ahead = start({ ...request, index: request.index + 1 });
    return bytes;
  };
}
