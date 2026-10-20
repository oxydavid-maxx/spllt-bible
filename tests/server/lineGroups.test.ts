import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBulletinCollector, listBulletins } from '../../server/bulletins';
import { createLineClient } from '../../server/lineContent';
import { createLineGroupDirectory, lineGroupPurpose } from '../../server/lineGroups';
import { createLineWebhook } from '../../server/lineWebhook';

// 2026-10-20 (維護者): the bot is being added to the youth groups as well as the church's 公布欄. Only the 公布欄's
// 靈修 and 週刊 are taken; the youth groups are only recorded for now. Shapes follow LINE's own examples:
// the join event (https://developers.line.biz/en/reference/messaging-api/#join-event) and the group summary
// response (https://developers.line.biz/en/reference/messaging-api/#get-group-summary). No test reaches LINE:
// every request goes to the fake below.

const SECRET = '0123456789abcdef0123456789abcdef';
const CHANNEL_ID = '2000000001';
const TOKEN_URL = 'https://api.line.me/oauth2/v3/token';
// Group IDs in the shape of the documented examples ("Ca56f94637c...", "C4af4980629..."), made up.
const BOARD = `Ca56f94637c${'b'.repeat(22)}`;
const YOUTH = `C4af4980629${'c'.repeat(22)}`;
const LEADERS = `C4af4980629${'d'.repeat(22)}`;
const OTHER = `C4af4980629${'e'.repeat(22)}`;
const NAMES: Record<string, string> = {
  [BOARD]: '竹科靈糧堂訊息公布欄 (教會公告用，請不要回覆)',
  [YOUTH]: '青少牧區公告群',
  [LEADERS]: '青崇輔導/小組長群組',
  [OTHER]: '測試用的別的群組',
};
const SENDER = `U4af4980629${'f'.repeat(22)}`;
const SATURDAY = Date.parse('2026-10-10T02:00:00Z');
// Made-up content in the pastor's format; the real posts never enter this public repository.
const POST = [
  '📖🌾 《 測試的樹 》',
  '2030.01.02 (三) 讀經：彼前5、詩118',
  '背誦經文：',
  '彼得前書 5:7 這是一段測試經文。',
  '默想經文：',
  '5:8-9 這是測試默想的第一段。',
  '用經文禱告：',
  '主啊，這是測試禱告。',
  '阿們！',
  'https://youtu.be/abcdefghijk',
].join('\n');

/** The smallest JPEG header jpegSize reads, sized like the 公布欄's A4 pages (1722 × 2435). */
function a4Page(tag: number): Uint8Array {
  const [width, height] = [1722, 2435];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, tag & 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0xff, 0xd9]);
}

// LINE's join event example, with its group ID swapped for ours.
function joinEvent(groupId: string) {
  return { replyToken: 'nHuyWiB7yP5Zw52FIkcQobQuGDXCTA', type: 'join', mode: 'active', timestamp: 1462629479859, source: { type: 'group', groupId }, webhookEventId: '01FZ74A0TDDPYRVKNK77XKC3ZR', deliveryContext: { isRedelivery: false } };
}

function textEvent(groupId: string, text: string) {
  return { replyToken: 'b60d1f7e2a4c4bd3', type: 'message', mode: 'active', timestamp: SATURDAY, source: { type: 'group', groupId, userId: SENDER }, webhookEventId: '01FZ74A0TDDPYRVKNK77XKC3ZS', deliveryContext: { isRedelivery: false }, message: { id: '444573844083572737', type: 'text', quoteToken: 'q3Plxr4AgKd', text } };
}

function imageEvent(groupId: string, id: string, timestamp: number) {
  return { replyToken: 'c71e2f8a3b5d4ce4', type: 'message', mode: 'active', timestamp, source: { type: 'group', groupId, userId: SENDER }, webhookEventId: `01FZ74A0TDDPYRVKNK77XK${id}`, deliveryContext: { isRedelivery: false }, message: { id, type: 'image', quoteToken: 'yHAz4Ua2wx7', contentProvider: { type: 'line' } } };
}

interface Call { url: string; method: string }

/** Stands in for LINE: a token, the group summary in its documented shape, and photo bytes. Records every request. */
function fakeLine() {
  const calls: Call[] = [];
  const unreachable = new Set<string>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url === TOKEN_URL) return json({ access_token: 'token-from-the-fake', expires_in: 900, token_type: 'Bearer' });
    const group = /^https:\/\/api\.line\.me\/v2\/bot\/group\/([^/]+)\/summary$/.exec(url);
    if (group) {
      if (unreachable.has(group[1])) throw new TypeError('fetch failed');
      const name = NAMES[group[1]];
      return name ? json({ groupId: group[1], groupName: name, pictureUrl: 'https://profile.line-scdn.net/abcdefghijklmn' }) : json({ message: 'Not found' }, 404);
    }
    const content = /^https:\/\/api-data\.line\.me\/v2\/bot\/message\/(\d+)\/content$/.exec(url);
    if (content) return new Response(Buffer.from(a4Page(Number(content[1]))), { status: 200 });
    return json({ message: 'unexpected request in a test' }, 500);
  }) as typeof fetch;
  return { fetchImpl, calls, unreachable };
}

describe('LINE webhook: only the 公布欄 group feeds the 靈修 and the 週刊', () => {
  let dir: string;
  let logs: string[];
  let line: ReturnType<typeof fakeLine>;
  let webhook: ReturnType<typeof createLineWebhook>;
  let closers: Array<() => void>;
  const pending: Array<Promise<void>> = [];
  const groupsFile = () => join(dir, 'line-groups.json');
  const weeks = () => listBulletins(join(dir, 'bulletins'));
  const quiet = () => { for (const close of closers.splice(0)) close(); };
  const summaries = () => line.calls.filter((call) => call.url.endsWith('/summary'));
  const downloads = () => line.calls.filter((call) => call.url.endsWith('/content'));

  /** A fresh server process: new LINE client, collector and group directory over the same private folder. */
  function start() {
    line = fakeLine();
    closers = [];
    const client = createLineClient({ channelId: CHANNEL_ID, channelSecret: SECRET, fetchImpl: line.fetchImpl });
    const log = (entry: string) => logs.push(entry);
    const collector = createBulletinCollector({ dir: join(dir, 'bulletins'), fetchContent: client.fetchContent, log, schedule: (run) => { closers.push(run); } });
    webhook = createLineWebhook({
      channelSecret: SECRET, devotionalDir: join(dir, 'devotionals'), log,
      groups: createLineGroupDirectory({ file: groupsFile(), lookup: client.groupSummary, log }),
      onImage: (image) => { const run = collector.receive(image); pending.push(run); return run; },
    });
  }

  async function deliver(events: unknown[]) {
    const body = JSON.stringify({ destination: 'U0123456789abcdef0123456789abcdef', events });
    const signature = createHmac('sha256', SECRET).update(Buffer.from(body)).digest('base64');
    const reply = await webhook({ rawBody: Buffer.from(body), signature });
    await Promise.all(pending.splice(0));
    return reply;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qm-line-groups-'));
    logs = [];
    start();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not download the A4 photos posted in another group', async () => {
    expect((await deliver([imageEvent(YOUTH, '901', SATURDAY), imageEvent(YOUTH, '902', SATURDAY + 30_000), imageEvent(YOUTH, '903', SATURDAY + 60_000)])).status).toBe(200);
    quiet();
    expect(downloads()).toEqual([]);
    expect(weeks()).toEqual([]);
    expect(logs).toEqual(['LINE_GROUP_SEEN name="青少牧區公告群" purpose=youth-announcements']);
  });

  it('does not save a post in the 靈修 format from another group', async () => {
    expect((await deliver([textEvent(LEADERS, POST), textEvent(OTHER, POST)])).status).toBe(200);
    expect(existsSync(join(dir, 'devotionals'))).toBe(false);
    expect(logs).toEqual(['LINE_GROUP_SEEN name="青崇輔導/小組長群組" purpose=youth-leaders', 'LINE_GROUP_SEEN name="測試用的別的群組" purpose=other']);
  });

  it('still keeps the 公布欄 group\'s 靈修 and 週刊, asking LINE for the group\'s name only the first time', async () => {
    await deliver([textEvent(BOARD, POST)]);
    expect(readFileSync(join(dir, 'devotionals', '20300102.txt'), 'utf8')).toBe(POST);
    await deliver([imageEvent(BOARD, '911', SATURDAY), imageEvent(BOARD, '912', SATURDAY + 30_000), imageEvent(BOARD, '913', SATURDAY + 70_000)]);
    quiet();
    expect(weeks().map((week) => [week.date, week.pages.length])).toEqual([['2026-10-11', 3]]);
    expect(summaries()).toHaveLength(1);
    expect(downloads()).toHaveLength(3);
    expect(logs).toEqual(['LINE_GROUP_SEEN name="竹科靈糧堂訊息公布欄 (教會公告用，請不要回覆)" purpose=bulletin-board', 'LINE_DEVOTIONAL_SAVED date=2030-01-02', 'LINE_BULLETIN_SAVED date=2026-10-11 pages=3']);
    expect(logs.join('\n')).not.toMatch(/U4af|測試經文|911/);
  });

  it('does not take a group for the 公布欄 while its name cannot be looked up, and asks again on the next event', async () => {
    line.unreachable.add(BOARD);
    await deliver([textEvent(BOARD, POST), imageEvent(BOARD, '921', SATURDAY), imageEvent(BOARD, '922', SATURDAY + 30_000)]);
    quiet();
    expect(existsSync(join(dir, 'devotionals'))).toBe(false);
    expect(downloads()).toEqual([]);
    expect(weeks()).toEqual([]);
    expect(existsSync(groupsFile())).toBe(false);
    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) expect(entry).toMatch(/^LINE_GROUP_LOOKUP_FAILED( reason=[A-Z0-9_]+)?$/);
    line.unreachable.delete(BOARD);
    await deliver([textEvent(BOARD, POST)]);
    expect(readFileSync(join(dir, 'devotionals', '20300102.txt'), 'utf8')).toBe(POST);
  });

  it('records the name of a group it joins, keeps only group IDs and names, and remembers them after a restart', async () => {
    expect((await deliver([joinEvent(YOUTH)])).status).toBe(200);
    expect(logs).toEqual(['LINE_GROUP_SEEN name="青少牧區公告群" purpose=youth-announcements']);
    expect(JSON.parse(readFileSync(groupsFile(), 'utf8'))).toEqual({ groups: { [YOUTH]: '青少牧區公告群' } });
    await deliver([joinEvent(BOARD)]);
    expect(JSON.parse(readFileSync(groupsFile(), 'utf8'))).toEqual({ groups: { [YOUTH]: '青少牧區公告群', [BOARD]: NAMES[BOARD] } });
    expect(readdirSync(dir)).toEqual(['line-groups.json']);

    logs = [];
    start();
    await deliver([textEvent(YOUTH, POST), textEvent(BOARD, POST)]);
    expect(line.calls.filter((call) => call.url !== TOKEN_URL)).toEqual([]);
    expect(logs).toEqual(['LINE_DEVOTIONAL_SAVED date=2030-01-02']);
  });

  it('never talks back: LINE is only asked for a token, a group\'s name or a photo; nothing is replied or pushed', async () => {
    await deliver([
      joinEvent(BOARD), joinEvent(YOUTH), textEvent(BOARD, POST), textEvent(YOUTH, POST), textEvent(BOARD, '大家早安'),
      imageEvent(BOARD, '931', SATURDAY), imageEvent(BOARD, '932', SATURDAY + 1_000), imageEvent(YOUTH, '933', SATURDAY),
      { type: 'memberJoined', mode: 'active', timestamp: SATURDAY, source: { type: 'group', groupId: LEADERS }, replyToken: 'r', joined: { members: [{ type: 'user', userId: SENDER }] } },
      { type: 'leave', mode: 'active', timestamp: SATURDAY, source: { type: 'group', groupId: OTHER } },
      { ...textEvent(BOARD, POST), source: { type: 'user', userId: SENDER } },
    ]);
    quiet();
    expect(line.calls.length).toBeGreaterThan(0);
    for (const call of line.calls) {
      const allowed = (call.url === TOKEN_URL && call.method === 'POST')
        || (call.method === 'GET' && (/^https:\/\/api\.line\.me\/v2\/bot\/group\/C[0-9a-f]+\/summary$/.test(call.url) || /^https:\/\/api-data\.line\.me\/v2\/bot\/message\/\d+\/content$/.test(call.url)));
      expect(allowed, `${call.method} ${call.url}`).toBe(true);
    }
    // The bot was removed from that group: there is nothing to look up.
    expect(summaries().some((call) => call.url.includes(OTHER))).toBe(false);
  });

  it('has no way to send anything to LINE anywhere in the server code', () => {
    const files = readdirSync('server', { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'));
    const urls = files.flatMap((name) => readFileSync(join('server', name), 'utf8').match(/https:\/\/[a-z-]+\.line\.me[^'"`\s]*/g) ?? []);
    expect([...new Set(urls)].sort()).toEqual(['https://api-data.line.me/v2/bot/message', 'https://api.line.me/oauth2/v3/token', 'https://api.line.me/v2/bot/group']);
    expect(readFileSync('server/lineContent.ts', 'utf8')).not.toMatch(/reply|push|multicast|broadcast|narrowcast/i);
  });
});

describe('telling the groups apart by name', () => {
  it('takes the 公布欄 and the two youth groups by how their names start, and nothing else', () => {
    expect(lineGroupPurpose('竹科靈糧堂訊息公布欄 (教會公告用，請不要回覆)')).toBe('bulletin-board');
    expect(lineGroupPurpose(' 竹科靈糧堂訊息公布欄')).toBe('bulletin-board');
    expect(lineGroupPurpose('青少牧區公告群')).toBe('youth-announcements');
    expect(lineGroupPurpose('青崇輔導/小組長群組')).toBe('youth-leaders');
    expect(lineGroupPurpose('轉傳：竹科靈糧堂訊息公布欄')).toBe('other');
    expect(lineGroupPurpose('竹科靈糧堂青年')).toBe('other');
    expect(lineGroupPurpose('')).toBe('other');
  });
});

describe('the group directory', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qm-line-groups-dir-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('asks LINE once when a new group\'s events arrive together', async () => {
    let asked = 0;
    let answer!: (summary: { groupId: string; groupName: string }) => void;
    const groups = createLineGroupDirectory({ lookup: (groupId) => { asked += 1; return new Promise((resolve) => { answer = resolve; }); }, log: () => undefined });
    const first = groups.purposeOf(BOARD);
    const second = groups.purposeOf(BOARD);
    answer({ groupId: BOARD, groupName: NAMES[BOARD] });
    expect(await Promise.all([first, second])).toEqual(['bulletin-board', 'bulletin-board']);
    expect(await groups.purposeOf(BOARD)).toBe('bulletin-board');
    expect(asked).toBe(1);
  });

  it('starts empty from a missing or damaged file without throwing, and still works', async () => {
    const file = join(dir, 'line-groups.json');
    writeFileSync(file, 'not json');
    const logs: string[] = [];
    const groups = createLineGroupDirectory({ file, lookup: async (groupId) => ({ groupId, groupName: NAMES[groupId] }), log: (entry) => logs.push(entry) });
    expect(await groups.purposeOf(YOUTH)).toBe('youth-announcements');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ groups: { [YOUTH]: NAMES[YOUTH] } });
    expect(createLineGroupDirectory({ file: join(dir, 'absent', 'line-groups.json'), lookup: async () => { throw new Error('LINE_GROUP_404'); }, log: () => undefined })).toBeTruthy();
  });

  it('answers null and notes the failure when LINE cannot be asked, without anything identifying', async () => {
    const logs: string[] = [];
    const groups = createLineGroupDirectory({ lookup: async () => { throw new Error('LINE_GROUP_404'); }, log: (entry) => logs.push(entry) });
    expect(await groups.purposeOf(BOARD)).toBeNull();
    expect(await groups.purposeOf(BOARD)).toBeNull();
    expect(logs).toEqual(['LINE_GROUP_LOOKUP_FAILED reason=LINE_GROUP_404', 'LINE_GROUP_LOOKUP_FAILED reason=LINE_GROUP_404']);
  });
});

describe('asking LINE for a group\'s name', () => {
  it('uses the same short-lived token as the photo downloads, and checks the group ID before asking', async () => {
    const line = fakeLine();
    const client = createLineClient({ channelId: CHANNEL_ID, channelSecret: SECRET, fetchImpl: line.fetchImpl });
    expect(await client.groupSummary(BOARD)).toEqual({ groupId: BOARD, groupName: NAMES[BOARD] });
    await client.fetchContent('941');
    expect(line.calls.map((call) => call.url)).toEqual([TOKEN_URL, `https://api.line.me/v2/bot/group/${BOARD}/summary`, 'https://api-data.line.me/v2/bot/message/941/content']);
    await expect(client.groupSummary(`C4af4980629${'0'.repeat(22)}`)).rejects.toThrow('LINE_GROUP_404');
    for (const bad of ['../x', 'Cabc/summary', `U${'a'.repeat(32)}`, '']) await expect(client.groupSummary(bad)).rejects.toThrow('LINE_GROUP_ID_INVALID');
    expect(line.calls).toHaveLength(4);
  });
});
