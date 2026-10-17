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

// 主堂週刊 (維護者 2026-10-17): a set of A4 portrait pages sent together to the church group; nothing else is kept.
const SECRET = '0123456789abcdef0123456789abcdef';
const SATURDAY = Date.parse('2026-10-10T02:00:00Z'); // 10:00 Saturday in Taipei

/** The smallest JPEG header jpegSize reads: SOI, an APP0 segment, then a baseline frame of the given size. */
function jpeg(width: number, height: number, tag = 0): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, tag, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0xff, 0xd9]);
}

function imageEvent(id: string, timestamp: number, imageSet?: { id: string; index?: number; total?: number }) {
  return { type: 'message', timestamp, source: { type: 'group', groupId: 'Cgroup', userId: 'Uoffice' }, message: { id, type: 'image', contentProvider: { type: 'line' }, ...(imageSet ? { imageSet } : {}) } };
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
  let collector: ReturnType<typeof createBulletinCollector>;
  const pending: Array<Promise<void>> = [];

  async function deliver(events: unknown[]) {
    const body = JSON.stringify({ destination: 'Ubot', events });
    const signature = createHmac('sha256', SECRET).update(Buffer.from(body)).digest('base64');
    const reply = await webhook({ rawBody: Buffer.from(body), signature });
    await Promise.all(pending.splice(0));
    return reply;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qm-bulletin-'));
    logs = []; contents = new Map(); closers = [];
    fetchContent = vi.fn(async (id: string) => contents.get(id) ?? jpeg(100, 100));
    collector = createBulletinCollector({ dir: join(dir, 'bulletins'), fetchContent, log: (line) => logs.push(line), schedule: (run) => { closers.push(run); } });
    webhook = createLineWebhook({ channelSecret: SECRET, devotionalDir: join(dir, 'devotionals'), log: (line) => logs.push(line),
      onImage: (image) => { const run = collector.receive(image); pending.push(run); return run; } });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps a set of A4 pages sent together, in their order, under its Sunday', async () => {
    contents.set('101', jpeg(760, 1075, 1)); contents.set('102', jpeg(760, 1075, 2)); contents.set('103', jpeg(760, 1075, 3));
    expect((await deliver([imageEvent('103', SATURDAY, { id: 'S1', index: 3, total: 3 }), imageEvent('101', SATURDAY, { id: 'S1', index: 1, total: 3 }), imageEvent('102', SATURDAY, { id: 'S1', index: 2, total: 3 })])).status).toBe(200);
    expect(listBulletins(join(dir, 'bulletins'))).toEqual([{ date: '2026-10-11', postedAt: new Date(SATURDAY).toISOString(), pages: [1, 2, 3].map((index) => ({ index, width: 760, height: 1075 })) }]);
    expect([...readFileSync(join(dir, 'bulletins', '2026-10-11', '2.jpg'))]).toEqual([...jpeg(760, 1075, 2)]);
    expect(logs).toContain('LINE_BULLETIN_SAVED date=2026-10-11 pages=3');
  });

  it('drops a set with any photo that is not an A4 page, a single photo, and a photo from outside a group', async () => {
    contents.set('201', jpeg(760, 1075)); contents.set('202', jpeg(1080, 1080));
    await deliver([imageEvent('201', SATURDAY, { id: 'S2', index: 1, total: 2 }), imageEvent('202', SATURDAY, { id: 'S2', index: 2, total: 2 })]);
    await deliver([imageEvent('203', SATURDAY)]);
    await deliver([{ ...imageEvent('204', SATURDAY, { id: 'S3', index: 1, total: 1 }), source: { type: 'user', userId: 'U1' } }]);
    expect(existsSync(join(dir, 'bulletins')) ? readdirSync(join(dir, 'bulletins')) : []).toEqual([]);
    expect(fetchContent).not.toHaveBeenCalledWith('203');
    expect(fetchContent).not.toHaveBeenCalledWith('204');
    expect(logs).toEqual(expect.arrayContaining(['LINE_IMAGE_SET_SKIPPED pages=2 reason=SHAPE', 'LINE_IMAGE_SKIPPED reason=SINGLE']));
    expect(logs.join('\n')).not.toMatch(/20[1-4]|S2|Cgroup|Uoffice/);
  });

  it('closes a set whose phone left out the total after a quiet while', async () => {
    contents.set('301', jpeg(1240, 1754)); contents.set('302', jpeg(1240, 1754));
    await deliver([imageEvent('301', SATURDAY, { id: 'S4' }), imageEvent('302', SATURDAY, { id: 'S4' })]);
    expect(listBulletins(join(dir, 'bulletins'))).toEqual([]);
    closers.at(-1)!();
    expect(listBulletins(join(dir, 'bulletins')).map((week) => week.pages.length)).toEqual([2]);
  });

  it('replaces a Sunday that is posted again and keeps the newest 8 Sundays', async () => {
    const post = async (prefix: string, at: number, pages: number) => {
      const events = Array.from({ length: pages }, (_, i) => { contents.set(`${prefix}${i}`, jpeg(760, 1075)); return imageEvent(`${prefix}${i}`, at, { id: `set${prefix}`, index: i + 1, total: pages }); });
      await deliver(events);
    };
    for (let week = 0; week < 9; week += 1) await post(`9${week}`, SATURDAY + week * 7 * 86_400_000, 2);
    await post('80', SATURDAY + 8 * 7 * 86_400_000, 3);
    const weeks = listBulletins(join(dir, 'bulletins'));
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toMatchObject({ date: '2026-12-06' });
    expect(weeks[0].pages).toHaveLength(3);
    expect(weeks.at(-1)!.date).toBe('2026-10-18');
  });
});

describe('reading the 週刊 from the app', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qm-bulletin-api-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the Sundays newest first and serves each page to members only', async () => {
    const collector = createBulletinCollector({ dir, fetchContent: async () => jpeg(760, 1075, 7), log: () => undefined });
    for (const [at, set] of [[SATURDAY, 'A'], [SATURDAY + 7 * 86_400_000, 'B']] as const) {
      for (const index of [1, 2]) await collector.receive({ messageId: `${set}${index}`, timestamp: at, imageSet: { id: set, index, total: 2 } });
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
