import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LineImage } from './bulletins';
import { parseDevotionalPost } from './devotional';

/**
 * Receives the pastor's daily 靈修 from the church's LINE group the moment it is posted (between about 5:30 and
 * 7:30 every morning), instead of someone copying it by hand. LINE forwards every message in a group the bot is
 * in; this keeps only a group text that the 靈修 reader parses (server/devotional.ts) and writes it as that day's
 * YYYYMMDD.txt. A photo in a group goes to the 週刊 collector (server/bulletins.ts), which keeps only a set of
 * A4 pages. Everything else is dropped: not stored, not logged. The bot never replies or posts.
 *
 * LINE signs each delivery with the channel secret (X-Line-Signature = base64 HMAC-SHA256 of the raw body,
 * https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/); unsigned requests get 401.
 */

export const LINE_WEBHOOK_PATH = '/api/line/webhook';
/** LINE batches events, each text at most 5,000 characters; anything near this is not from LINE. */
export const LINE_WEBHOOK_BODY_LIMIT = 256 * 1024;
// A post that looks like the pastor's is worth a note when it fails to parse, so a format change is noticed.
const LOOKS_LIKE_DEVOTIONAL = /^\s*📖|溪邊的樹|背誦經文/u;

export interface LineWebhookConfig {
  channelSecret: string;
  devotionalDir: string;
  log?: (line: string) => void;
  /** A day's file was written or corrected (the server prepares its audio); not awaited. */
  onSaved?: (date: string) => void;
  /** A photo posted in a group (the 週刊, server/bulletins.ts); not awaited, so LINE is answered at once. */
  onImage?: (image: LineImage) => Promise<void>;
}

export interface LineDelivery {
  rawBody: Buffer;
  signature: string | undefined;
}

export function readLineChannelSecret(file: string | undefined): string | null {
  if (!file?.trim()) return null;
  try {
    const secret = (JSON.parse(readFileSync(file.trim(), 'utf8')) as { channelSecret?: unknown }).channelSecret;
    return typeof secret === 'string' && /^[0-9a-f]{32}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

function signedByLine(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface LineEvent {
  type?: unknown;
  timestamp?: unknown;
  source?: { type?: unknown; userId?: unknown };
  message?: { type?: unknown; text?: unknown; id?: unknown; contentProvider?: { type?: unknown } };
}

function groupImage(event: LineEvent): LineImage | null {
  const message = event.message;
  if (event.type !== 'message' || event.source?.type !== 'group' || message?.type !== 'image' || typeof message.id !== 'string') return null;
  // Only a photo sent from LINE itself can be downloaded; one linked from elsewhere has no content to fetch.
  if (message.contentProvider?.type !== 'line') return null;
  return {
    messageId: message.id,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    ...(typeof event.source.userId === 'string' ? { senderId: event.source.userId } : {}),
  };
}

export function createLineWebhook(config: LineWebhookConfig) {
  const log = config.log ?? ((line: string) => console.log(line));

  async function save(message: string): Promise<void> {
    const text = message.trim();
    const post = parseDevotionalPost(text);
    if (!post) {
      log('LINE_DEVOTIONAL_REJECTED reason=FORMAT');
      return;
    }
    const target = join(config.devotionalDir, `${post.date.replace(/-/g, '')}.txt`);
    const previous = await readFile(target, 'utf8').catch(() => null);
    if (previous === text) {
      log(`LINE_DEVOTIONAL_UNCHANGED date=${post.date}`);
      return;
    }
    await mkdir(config.devotionalDir, { recursive: true });
    // Written beside the target and renamed over it, so the reader never sees half a post.
    const partial = `${target}.${randomUUID()}.partial`;
    await writeFile(partial, text, 'utf8');
    await rename(partial, target);
    log(`LINE_DEVOTIONAL_SAVED date=${post.date}`);
    try { config.onSaved?.(post.date); } catch { /* Audio preparation never changes what LINE is told. */ }
  }

  return async function receive(delivery: LineDelivery): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!signedByLine(config.channelSecret, delivery.rawBody, delivery.signature)) return { status: 401, body: { error: 'LINE_SIGNATURE_INVALID' } };
    let events: unknown;
    try { events = (JSON.parse(delivery.rawBody.toString('utf8')) as { events?: unknown }).events; } catch { return { status: 400, body: { error: 'INVALID_JSON' } }; }
    for (const event of Array.isArray(events) ? events as LineEvent[] : []) {
      const image = config.onImage && event ? groupImage(event) : null;
      if (image) { void config.onImage!(image).catch(() => log('LINE_BULLETIN_FAILED')); continue; }
      if (event?.type !== 'message' || event.source?.type !== 'group' || event.message?.type !== 'text' || typeof event.message.text !== 'string') continue;
      if (!LOOKS_LIKE_DEVOTIONAL.test(event.message.text)) continue;
      await save(event.message.text);
    }
    return { status: 200, body: { ok: true } };
  };
}
