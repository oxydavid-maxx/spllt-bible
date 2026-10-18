import { readFileSync } from 'node:fs';

/**
 * Downloads the photos the church group posts, for the 週刊 (server/bulletins.ts). LINE keeps sent content only for
 * a while, so each photo is fetched as its webhook arrives. The token is a stateless channel access token issued
 * from the channel ID and secret already configured for the webhook (valid 15 minutes,
 * https://developers.line.biz/en/docs/basics/channel-access-token/), so no long-lived token is stored anywhere.
 * Only GETs content; nothing here can post. The token is never logged.
 */
export interface LineContentOptions {
  channelId: string;
  channelSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const TOKEN_URL = 'https://api.line.me/oauth2/v3/token';
const CONTENT_URL = 'https://api-data.line.me/v2/bot/message';
// Reissued a little before LINE's 15 minutes run out.
const TOKEN_REUSE_MS = 12 * 60_000;
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;

export function createLineContentFetcher(options: LineContentOptions): (messageId: string) => Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; issuedAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && now() - token.issuedAt < TOKEN_REUSE_MS) return token.value;
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: options.channelId, client_secret: options.channelSecret }).toString(),
    });
    const body = await response.json().catch(() => null) as { access_token?: unknown } | null;
    if (!response.ok || typeof body?.access_token !== 'string') throw new Error(`LINE_TOKEN_${response.status}`);
    token = { value: body.access_token, issuedAt: now() };
    return token.value;
  }

  return async function fetchContent(messageId: string): Promise<Uint8Array> {
    if (!/^\d{1,30}$/.test(messageId)) throw new Error('LINE_MESSAGE_ID_INVALID');
    const response = await fetchImpl(`${CONTENT_URL}/${messageId}/content`, { headers: { authorization: `Bearer ${await accessToken()}` } });
    if (response.status === 401) token = null;
    if (!response.ok) throw new Error(`LINE_CONTENT_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_CONTENT_BYTES) throw new Error('LINE_CONTENT_TOO_LARGE');
    return bytes;
  };
}

/** The channel ID beside the secret in the same private file ({"channelSecret": …, "channelId": …}); null when absent. */
export function readLineChannelIdFile(file: string | undefined): string | null {
  if (!file?.trim()) return null;
  try {
    const value = (JSON.parse(readFileSync(file.trim(), 'utf8')) as { channelId?: unknown }).channelId;
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    return typeof text === 'string' && /^\d{6,20}$/.test(text) ? text : null;
  } catch {
    return null;
  }
}
