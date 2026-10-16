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
