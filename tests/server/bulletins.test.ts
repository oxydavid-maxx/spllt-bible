import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulletinSunday, createBulletinCollector, isA4Portrait, jpegSize, listBulletins } from '../../server/bulletins';
import { createDatabase } from '../../server/db';
import { createLineContentFetcher } from '../../server/lineContent';
import { createLineWebhook } from '../../server/lineWebhook';
import { createApiHandler } from '../../server/routes';

// 主堂週刊 (維護者 2026-10-17): two or more A4 portrait pages one person posts together; nothing else is kept.
// The cases follow the group's history checked on 2026-10-17 (server/bulletins.ts).
const SECRET = '0123456789abcdef0123456789abcdef';
const SATURDAY = Date.parse('2026-10-10T02:00:00Z'); // 10:00 Saturday in Taipei
const SUNDAY_MIDNIGHT = Date.parse('2026-09-26T16:02:00Z'); // 00:02 Sunday 9/27 in Taipei, when that week's pages came
const MINUTE = 60_000;
const PAGE = [1722, 2435] as const; // every bulletin page in the history

/** The smallest JPEG header jpegSize reads: SOI, an APP0 segment, then a baseline frame of the given size. */
function jpeg(width: number, height: number, tag = 0): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, tag, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0xff, 0xd9]);
}

function imageEvent(id: string, timestamp: number, userId = 'Uoffice') {
  return { type: 'message', timestamp, source: { type: 'group', groupId: 'Cgroup', userId }, message: { id, type: 'image', contentProvider: { type: 'line' } } };
}

describe('telling a bulletin page apart', () => {
  it('reads a JPEG frame size and takes A4 portrait pages only', () => {
    expect(jpegSize(jpeg(760, 1075))).toEqual({ width: 760, height: 1075 });
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(isA4Portrait(760, 1075)).toBe(true);
    expect(isA4Portrait(1240, 1754)).toBe(true);
    expect(isA4Portrait(1080, 1080)).toBe(false);
    expect(isA4Portrait(1080, 1920)).toBe(false);
    expect(isA4Portrait(300, 424)).toBe(false);
  });

  it('dates a bulletin by the Sunday on or after it was posted, in Taipei', () => {
    expect(bulletinSunday(SATURDAY)).toBe('2026-10-11');
    expect(bulletinSunday(Date.parse('2026-10-10T17:00:00Z'))).toBe('2026-10-11'); // 01:00 Sunday in Taipei
    expect(bulletinSunday(Date.parse('2026-10-11T16:30:00Z'))).toBe('2026-10-18'); // 00:30 Monday in Taipei
  });
});

describe('collecting the 週刊 from the church group', () => {
  let dir: string;
  let logs: string[];
  let contents: Map<string, Uint8Array>;
  let fetchContent: ReturnType<typeof vi.fn>;
  let closers: Array<() => void>;
  let webhook: ReturnType<typeof createLineWebhook>;
  const pending: Array<Promise<void>> = [];
  const weeks = () => listBulletins(join(dir, 'bulletins'));
  const quiet = () => { for (const close of closers.splice(0)) close(); };

  async function deliver(events: unknown[]) {
    const body = JSON.stringify({ destination: 'Ubot', events });
    const signature = createHmac('sha256', SECRET).update(Buffer.from(body)).digest('base64');
    const reply = await webhook({ rawBody: Buffer.from(body), signature });
    await Promise.all(pending.splice(0));
    return reply;
  }
  const page = (id: string, at: number, userId?: string, size: readonly [number, number] = PAGE) => { contents.set(id, jpeg(size[0], size[1], Number(id) % 250)); return imageEvent(id, at, userId); };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qm-bulletin-'));
    logs = []; contents = new Map(); closers = [];
    fetchContent = vi.fn(async (id: string) => contents.get(id) ?? jpeg(100, 100));
    const collector = createBulletinCollector({ dir: join(dir, 'bulletins'), fetchContent, log: (line) => logs.push(line), schedule: (run) => { closers.push(run); } });
    // Cgroup is the 公布欄; photos from any other group are never fetched (tests/server/lineGroups.test.ts).
    webhook = createLineWebhook({ channelSecret: SECRET, devotionalDir: join(dir, 'devotionals'), log: (line) => logs.push(line),
      groups: { purposeOf: async (groupId: string) => (groupId === 'Cgroup' ? 'bulletin-board' as const : 'other' as const) },
      onImage: (image) => { const run = collector.receive(image); pending.push(run); return run; } });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps a usual week: three A4 pages from one person within two minutes, in posting order, under its Sunday', async () => {
    expect((await deliver([page('103', SATURDAY + 70_000), page('101', SATURDAY), page('102', SATURDAY + 30_000)])).status).toBe(200);
    expect(weeks()).toEqual([]);
    quiet();
    expect(weeks()).toEqual([{ date: '2026-10-11', postedAt: new Date(SATURDAY).toISOString(), pages: [1, 2, 3].map((index) => ({ index, width: 1722, height: 2435 })) }]);
    expect([...readFileSync(join(dir, 'bulletins', '2026-10-11', '3.jpg'))]).toEqual([...contents.get('103')!]);
    expect(logs).toContain('LINE_BULLETIN_SAVED date=2026-10-11 pages=3');
  });

  it('adds a page the same person posts 46 minutes later to that week (9/27)', async () => {
    await deliver([page('201', SUNDAY_MIDNIGHT), page('202', SUNDAY_MIDNIGHT + 20_000)]);
    quiet();
    expect(weeks().map((week) => [week.date, week.pages.length])).toEqual([['2026-09-27', 2]]);
    await deliver([page('203', SUNDAY_MIDNIGHT + 46 * MINUTE)]);
    expect(weeks().map((week) => [week.date, week.pages.length])).toEqual([['2026-09-27', 3]]);
  });

  it('leaves out a lone A4 flyer, an A4 page from someone else after the bulletin, and every other shape', async () => {
    await deliver([page('301', SATURDAY - 3 * 86_400_000, 'Uflyer')]); // 8/6: one A4-shaped flyer, nobody else
    quiet();
    await deliver([page('302', SATURDAY, 'Uoffice'), page('303', SATURDAY + MINUTE, 'Uoffice')]);
    quiet();
    await deliver([page('304', SATURDAY + 30 * MINUTE, 'Uflyer')]);
    quiet();
    await deliver([page('305', SATURDAY + 2 * MINUTE, 'Uposter', [1270, 730]), page('306', SATURDAY + 3 * MINUTE, 'Ushot', [869, 1884]), page('307', SATURDAY + 4 * MINUTE, 'Uphoto', [715, 960])]);
    quiet();
    expect(weeks().map((week) => [week.date, week.pages.length])).toEqual([['2026-10-11', 2]]);
    expect(logs.filter((line) => line === 'LINE_IMAGE_SKIPPED reason=SINGLE')).toHaveLength(2);
    expect(logs.filter((line) => line === 'LINE_IMAGE_SKIPPED reason=SHAPE')).toHaveLength(3);
    expect(logs.join('\n')).not.toMatch(/30\d|Uflyer|Uoffice|Cgroup/);
  });

  it('never downloads a photo from outside a group, or one linked from elsewhere', async () => {
    await deliver([{ ...imageEvent('401', SATURDAY), source: { type: 'user', userId: 'U1' } }, { ...imageEvent('402', SATURDAY), message: { id: '402', type: 'image', contentProvider: { type: 'external', originalContentUrl: 'https://example.test/x.jpg' } } }]);
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it('replaces a Sunday that is posted again and keeps the newest 8 Sundays', async () => {
    const post = async (prefix: string, at: number, pages: number) => {
      await deliver(Array.from({ length: pages }, (_, i) => page(`${prefix}${i}`, at + i * 1000)));
      quiet();
    };
    for (let week = 0; week < 9; week += 1) await post(`5${week}`, SATURDAY + week * 7 * 86_400_000, 2);
    await post('60', SATURDAY + 8 * 7 * 86_400_000 + 5 * 3_600_000, 3);
    expect(weeks()).toHaveLength(8);
    expect(weeks()[0]).toMatchObject({ date: '2026-12-06' });
    expect(weeks()[0].pages).toHaveLength(3);
    expect(weeks().at(-1)!.date).toBe('2026-10-18');
  });
});

describe('reading the 週刊 from the app', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qm-bulletin-api-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the Sundays newest first and serves each page to members only', async () => {
    const closers: Array<() => void> = [];
    const collector = createBulletinCollector({ dir, fetchContent: async () => jpeg(760, 1075, 7), log: () => undefined, schedule: (run) => { closers.push(run); } });
    for (const at of [SATURDAY, SATURDAY + 7 * 86_400_000]) {
      for (const index of [1, 2]) await collector.receive({ messageId: `${at}${index}`, timestamp: at + index, senderId: 'Uoffice' });
      closers.splice(0).forEach((close) => close());
    }
    const db = createDatabase({ members: [{ id: 'm', displayName: '王姊妹', groupId: 'g' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'fixture', bulletinDir: dir });
      const as = { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'm' };
      const list = await api({ method: 'GET', url: '/api/bulletins', headers: as });
      expect((list.body as { weeks: Array<{ date: string }> }).weeks.map((week) => week.date)).toEqual(['2026-10-18', '2026-10-11']);
      const page = await api({ method: 'GET', url: '/api/bulletins/2026-10-11/2', headers: as });
      expect(page.status).toBe(200);
      expect(page.headers?.['content-type']).toBe('image/jpeg');
      expect([...page.binaryBody!]).toEqual([...jpeg(760, 1075, 7)]);
      expect((await api({ method: 'GET', url: '/api/bulletins/2026-10-11/3', headers: as })).status).toBe(404);
      expect((await api({ method: 'GET', url: '/api/bulletins/2026-10-11/1', headers: {} })).status).toBe(401);
      expect((await createApiHandler({ db, fixtureToken: 'fixture' })({ method: 'GET', url: '/api/bulletins', headers: as })).body).toEqual({ weeks: [] });
    } finally { db.close(); }
  });

  // 2026-10-19: React Native's Android Image sends no headers for a single-object source, so the page request
  // arrives without the bearer token (blank pages on the Pixel). Listing hands out a cookie that opens the pages only;
  // Android keeps it in the cookie store that fetch and image loading share (FrescoModule, NetworkingModule).
  it('opens the pages to a member’s list cookie, and to nothing else', async () => {
    const closers: Array<() => void> = [];
    const collector = createBulletinCollector({ dir, fetchContent: async () => jpeg(760, 1075, 7), log: () => undefined, schedule: (run) => { closers.push(run); } });
    for (const index of [1, 2]) await collector.receive({ messageId: `p${index}`, timestamp: SATURDAY + index, senderId: 'Uoffice' });
    closers.splice(0).forEach((close) => close());
    const db = createDatabase({ members: [{ id: 'm', displayName: '王姊妹', groupId: 'g' }] });
    try {
      let at = Date.parse('2026-10-19T14:00:00Z');
      const api = createApiHandler({ db, fixtureToken: 'fixture', bulletinDir: dir, now: () => new Date(at) });
      const list = await api({ method: 'GET', url: '/api/bulletins', headers: { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'm' } });
      const setCookie = list.headers?.['set-cookie'] ?? '';
      expect(setCookie).toMatch(/^qm_bulletin=[^;\s]+; Path=\/api\/bulletins\/; Max-Age=604800; HttpOnly; Secure$/);
      const cookie = setCookie.split(';')[0];
      const page = await api({ method: 'GET', url: '/api/bulletins/2026-10-11/2', headers: { cookie: `other=1; ${cookie}` } });
      expect(page.status).toBe(200);
      expect([...page.binaryBody!]).toEqual([...jpeg(760, 1075, 7)]);
      const tampered = cookie.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'));
      expect((await api({ method: 'GET', url: '/api/bulletins/2026-10-11/2', headers: { cookie: tampered } })).status).toBe(401);
      expect((await api({ method: 'GET', url: '/api/bulletins', headers: { cookie } })).status).toBe(401);
      expect((await api({ method: 'GET', url: '/api/me/profile', headers: { cookie } })).status).toBe(401);
      db.db.prepare('UPDATE members SET disabled_at = ? WHERE id = ?').run(at, 'm');
      expect((await api({ method: 'GET', url: '/api/bulletins/2026-10-11/2', headers: { cookie } })).status).toBe(401);
      db.db.prepare('UPDATE members SET disabled_at = NULL WHERE id = ?').run('m');
      at += 604_800_000 + 1;
      expect((await api({ method: 'GET', url: '/api/bulletins/2026-10-11/2', headers: { cookie } })).status).toBe(401);
    } finally { db.close(); }
  });
});

describe('downloading a photo from LINE', () => {
  it('issues a short-lived token from the channel ID and secret, reuses it, and never puts it in an error', async () => {
    let clock = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith('/oauth2/v3/token')) {
        expect(String(init?.body)).toContain('grant_type=client_credentials');
        expect(String(init?.body)).toContain('client_id=2000000001');
        return new Response(JSON.stringify({ access_token: 'secret-token-value', expires_in: 900, token_type: 'Bearer' }), { status: 200 });
      }
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token-value');
      return url.includes('/999/') ? new Response('gone', { status: 404 }) : new Response(Buffer.from(jpeg(760, 1075)), { status: 200 });
    }) as unknown as typeof fetch;
    const fetchContent = createLineContentFetcher({ channelId: '2000000001', channelSecret: SECRET, fetchImpl, now: () => clock });
    expect(jpegSize(await fetchContent('111'))).toEqual({ width: 760, height: 1075 });
    clock = 60_000;
    await fetchContent('112');
    expect(calls.filter((url) => url.endsWith('/token'))).toHaveLength(1);
    expect(calls).toContain('https://api-data.line.me/v2/bot/message/112/content');
    await expect(fetchContent('999')).rejects.toThrow('LINE_CONTENT_404');
    await expect(fetchContent('../x')).rejects.toThrow('LINE_MESSAGE_ID_INVALID');
    clock = 13 * 60_000;
    await fetchContent('113');
    expect(calls.filter((url) => url.endsWith('/token'))).toHaveLength(2);
  });
});
