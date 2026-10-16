import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { speechUnits } from '../src/domain/devotionReading';
import { DEFAULT_DEVOTION_VOICE, DEVOTION_VOICES, type DevotionVoice } from '../src/domain/devotionVoice';
import { readDevotional } from './devotional';

export interface AzureSpeechConfig { key: string; region: string }
/** Optional configuration: never log secret bytes or make an old backend installation fail to boot. */
export function readAzureSpeechConfig(path: string | undefined): AzureSpeechConfig | null {
  if (!path?.trim()) return null;
  try {
    const value = JSON.parse(readFileSync(path.trim(), 'utf8').replace(/^\uFEFF/, ''));
    if (typeof value?.key !== 'string' || !value.key.trim() || typeof value?.region !== 'string' || !/^[a-z][a-z0-9]{1,40}$/.test(value.region)) return null;
    return { key: value.key.trim(), region: value.region };
  } catch { return null; }
}

// One process-wide queue: F0 must not overlap even when separate provider objects are created.
let synthesisTail: Promise<unknown> = Promise.resolve();
const xml = (value: string) => value.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!);

export interface DevotionalAudio {
  synthesize(date: string, index: number, voice: DevotionVoice, text: string): Promise<Uint8Array>;
}
export function createDevotionalAudio({ config, cacheDir, fetchImpl = fetch, timeoutMs = 15_000 }: {
  config: AzureSpeechConfig; cacheDir: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): DevotionalAudio {
  const pending = new Map<string, Promise<Uint8Array>>();
  return {
    synthesize(date, index, voice, text) {
      const digest = createHash('sha256').update(JSON.stringify(['devotion-tts-v1', date, index, voice, text])).digest('hex');
      const existing = pending.get(digest);
      if (existing) return existing;
      const path = join(cacheDir, `${digest}.mp3`);
      const job = synthesisTail.catch(() => undefined).then(async () => {
        try { const cached = await readFile(path); if (cached.length) return new Uint8Array(cached); } catch { /* Cache miss. */ }
        const response = await fetchImpl(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'Ocp-Apim-Subscription-Key': config.key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'qingmu-bible',
          },
          body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW"><voice name="${voice}">${xml(text)}</voice></speak>`,
        });
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) {
          await response.body?.cancel();
          throw new Error('DEVOTIONAL_AUDIO_UPSTREAM');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error('DEVOTIONAL_AUDIO_EMPTY');
        await mkdir(cacheDir, { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, path); }
        finally { await rm(temporary, { force: true }); }
        return bytes;
      });
      synthesisTail = job.catch(() => undefined);
      pending.set(digest, job);
      void job.finally(() => pending.delete(digest)).catch(() => undefined);
      return job;
    },
  };
}

/**
 * Synthesizes a day's whole post in both voices ahead of time, the default voice first. Azure answers only after
 * a paragraph is fully spoken: on 2026-10-16 the first paragraph took 11 s, past the app's 8 s wait, so every
 * paragraph fell back to the phone's voice. With the mp3 cached, the app's request is a file read. Runs on the
 * same F0 queue as listeners' requests; never throws, and logs counts only.
 */
export async function warmDevotionalAudio(audio: DevotionalAudio | undefined, devotionalDir: string | undefined, date: string, log: (line: string) => void = line => console.log(line)): Promise<{ units: number; ready: number; failed: number }> {
  const post = audio ? await readDevotional(devotionalDir, date, async () => null) : null;
  const units = post ? speechUnits(post) : [];
  if (!audio || units.length === 0) return { units: 0, ready: 0, failed: 0 };
  const voices = [DEFAULT_DEVOTION_VOICE, ...DEVOTION_VOICES.map(voice => voice.id).filter(id => id !== DEFAULT_DEVOTION_VOICE)];
  let ready = 0, failed = 0;
  for (const voice of voices) {
    for (const [index, unit] of units.entries()) {
      try { await audio.synthesize(date, index, voice, unit.text); ready++; } catch { failed++; }
    }
  }
  log(`DEVOTIONAL_AUDIO_WARMED date=${date} units=${units.length} ready=${ready} failed=${failed}`);
  return { units: units.length, ready, failed };
}

/** The newest saved post on or before `today` (the one listeners open first), or null. */
export function latestDevotionalDate(devotionalDir: string, today: string): string | null {
  let names: string[];
  try { names = readdirSync(devotionalDir); } catch { return null; }
  const dates = names.flatMap(name => {
    const match = /^(\d{4})(\d{2})(\d{2})\.txt$/.exec(name);
    return match ? [`${match[1]}-${match[2]}-${match[3]}`] : [];
  }).filter(date => date <= today).sort();
  return dates.at(-1) ?? null;
}
