import { readFileSync } from 'node:fs';

/**
 * Reads from LINE what the webhook needs: the photos the 公布欄 group posts, for the 週刊 (server/bulletins.ts), and
 * the name of each group the bot is in (server/lineGroups.ts). LINE keeps sent content only for a while, so each
 * photo is fetched as its webhook arrives. The token is a stateless channel access token issued from the channel ID
 * and secret already configured for the webhook (valid 15 minutes,
 * https://developers.line.biz/en/docs/basics/channel-access-token/), so no long-lived token is stored anywhere.
 * Only GETs content and group summaries; nothing here can post. The token is never logged.
 */
export interface LineContentOptions {
  channelId: string;
  channelSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A group's ID and name, as LINE's group summary gives them (its icon URL is not kept). */
export interface LineGroupSummary { groupId: string; groupName: string }

export interface LineClient {
  fetchContent(messageId: string): Promise<Uint8Array>;
  /** https://developers.line.biz/en/reference/messaging-api/#get-group-summary */
  groupSummary(groupId: string): Promise<LineGroupSummary>;
}

const TOKEN_URL = 'https://api.line.me/oauth2/v3/token';
const CONTENT_URL = 'https://api-data.line.me/v2/bot/message';
const GROUP_URL = 'https://api.line.me/v2/bot/group';
// Reissued a little before LINE's 15 minutes run out.
const TOKEN_REUSE_MS = 12 * 60_000;
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
// LINE's group IDs start with C (examples "Ca56f94637c...", "C4af4980629..."); anything else never reaches the URL.
const GROUP_ID = /^C[0-9A-Za-z]{1,64}$/;
// A group's name is asked while LINE waits for the webhook's answer; a hung request must not hold it.
const GROUP_TIMEOUT_MS = 10_000;

export function createLineClient(options: LineContentOptions): LineClient {
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

  return {
    async fetchContent(messageId: string): Promise<Uint8Array> {
      if (!/^\d{1,30}$/.test(messageId)) throw new Error('LINE_MESSAGE_ID_INVALID');
      const response = await fetchImpl(`${CONTENT_URL}/${messageId}/content`, { headers: { authorization: `Bearer ${await accessToken()}` } });
      if (response.status === 401) token = null;
      if (!response.ok) throw new Error(`LINE_CONTENT_${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_CONTENT_BYTES) throw new Error('LINE_CONTENT_TOO_LARGE');
      return bytes;
    },

    async groupSummary(groupId: string): Promise<LineGroupSummary> {
      if (!GROUP_ID.test(groupId)) throw new Error('LINE_GROUP_ID_INVALID');
      const response = await fetchImpl(`${GROUP_URL}/${groupId}/summary`, {
        headers: { authorization: `Bearer ${await accessToken()}` },
        signal: AbortSignal.timeout(GROUP_TIMEOUT_MS),
      });
      if (response.status === 401) token = null;
      if (!response.ok) throw new Error(`LINE_GROUP_${response.status}`);
      const body = await response.json().catch(() => null) as { groupName?: unknown } | null;
      if (typeof body?.groupName !== 'string') throw new Error('LINE_GROUP_SUMMARY_INVALID');
      return { groupId, groupName: body.groupName };
    },
  };
}

export function createLineContentFetcher(options: LineContentOptions): (messageId: string) => Promise<Uint8Array> {
  return createLineClient(options).fetchContent;
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
