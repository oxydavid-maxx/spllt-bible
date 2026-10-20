import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jpegSize } from '../../server/bulletins';
import { createBulletinPhoneCopies } from '../../server/bulletinsResize';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { syntheticBulletinPage } from '../../scripts/ios/make-bulletin-fixture';

// 主堂週刊 on a phone (2026-10-20): the 10/18 pages are 2481 × 3509, about three times what a phone list needs, so the
// list waited 2–5 s on LTE with nothing to show. The app now asks for ?w=<phone width> in the list and for the
// original only full screen; the backend makes each phone copy once and keeps it beside the page.
const DATE = '2026-10-18';
const A4 = { width: 1654, height: 2339 }; // A4 at 200 dpi: wide enough to be cut down, quick to make in a test
let original: Uint8Array;
let narrow: Uint8Array;
let dir: string;

beforeAll(async () => {
  original = await syntheticBulletinPage(A4, 1);
  narrow = await syntheticBulletinPage({ width: 620, height: 877 }, 2);
}, 60_000);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qm-bulletin-copies-'));
  mkdirSync(join(dir, DATE));
  writeFileSync(join(dir, DATE, '1.jpg'), original);
  writeFileSync(join(dir, DATE, '2.jpg'), narrow);
  writeFileSync(join(dir, DATE, 'meta.json'), JSON.stringify({ date: DATE, postedAt: '2026-10-17T22:00:00.000Z', pages: [{ index: 1, ...A4 }, { index: 2, width: 620, height: 877 }] }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the 週刊 page API', () => {
  it('serves the phone copy the app asks for, and the original without ?w', async () => {
    const db = createDatabase({ members: [{ id: 'm', displayName: '王姊妹', groupId: 'g' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'fixture', bulletinDir: dir });
      const as = { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'm' };
      const get = (url: string, headers: Record<string, string> = as) => api({ method: 'GET', url, headers });
      const small = await get(`/api/bulletins/${DATE}/1?w=1080`);
      expect(small.status).toBe(200);
      expect(small.headers?.['content-type']).toBe('image/jpeg');
      expect(small.headers?.['cache-control']).toBe('private, max-age=604800');
      expect(jpegSize(small.binaryBody!)).toEqual({ width: 1080, height: Math.round(A4.height * 1080 / A4.width) });
      expect(small.binaryBody!.length).toBeLessThan(original.length / 2);
      // Made once and kept beside the page; the next ask reads it from disk.
      expect(existsSync(join(dir, DATE, '1.w1080.jpg'))).toBe(true);
      expect([...(await get(`/api/bulletins/${DATE}/1?w=1080`)).binaryBody!]).toEqual([...readFileSync(join(dir, DATE, '1.w1080.jpg'))]);
      // Without ?w (full screen, and every app before this one): the original, byte for byte.
      expect([...(await get(`/api/bulletins/${DATE}/1`)).binaryBody!]).toEqual([...original]);
      // Only the backend's own widths are made: anything else is rounded to one, never a new file per number.
      expect(jpegSize((await get(`/api/bulletins/${DATE}/1?w=1000`)).binaryBody!)?.width).toBe(1080);
      expect(jpegSize((await get(`/api/bulletins/${DATE}/1?w=99999`)).binaryBody!)?.width).toBe(1440);
      expect([...(await get(`/api/bulletins/${DATE}/1?w=abc`)).binaryBody!]).toEqual([...original]);
      // A page already narrower than the copy is sent as it is.
      expect([...(await get(`/api/bulletins/${DATE}/2?w=720`)).binaryBody!]).toEqual([...narrow]);
      expect(existsSync(join(dir, DATE, '2.w720.jpg'))).toBe(false);
      // Members only, as before; a page that is not there is still 404.
      expect((await get(`/api/bulletins/${DATE}/1?w=1080`, {})).status).toBe(401);
      expect((await get(`/api/bulletins/${DATE}/3?w=1080`)).status).toBe(404);
      // The list cookie that older Android apps rely on (server/bulletinAccess.ts) opens the phone copy too.
      const list = await get('/api/bulletins');
      const cookie = String(list.headers?.['set-cookie']).split(';')[0];
      const byCookie = await get(`/api/bulletins/${DATE}/1?w=720`, { cookie });
      expect(byCookie.status).toBe(200);
      expect(jpegSize(byCookie.binaryBody!)?.width).toBe(720);
    } finally { db.close(); }
  }, 60_000);
});

describe('making the phone copies', () => {
  it('makes one copy at a time off the main thread, and the same copy only once', async () => {
    const copies = createBulletinPhoneCopies(dir);
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    const [a, b] = await Promise.all([copies.page(DATE, 1, 720), copies.page(DATE, 1, 720)]);
    clearInterval(timer);
    expect(a).toBe(b);
    expect(jpegSize(a!)?.width).toBe(720);
    // The event loop kept running while the page was decoded (a worker thread does the image work).
    expect(ticks).toBeGreaterThan(3);
  }, 60_000);

  it('sends the original when the image tools are not installed, so an older backend folder still serves pages', async () => {
    const logs: string[] = [];
    const copies = createBulletinPhoneCopies(dir, { jimpPath: () => { throw new Error('Cannot find module'); }, log: (line) => logs.push(line) });
    expect([...(await copies.page(DATE, 1, 1080))!]).toEqual([...original]);
    expect(existsSync(join(dir, DATE, '1.w1080.jpg'))).toBe(false);
    expect(logs).toEqual(['BULLETIN_PHONE_COPY_UNAVAILABLE']);
  });

  it('sends the original when a page cannot be decoded', async () => {
    writeFileSync(join(dir, DATE, '1.jpg'), Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x09, 0x23, 0x06, 0x76, 0x03, 0xff, 0xd9]));
    const broken = readFileSync(join(dir, DATE, '1.jpg'));
    const logs: string[] = [];
    const copies = createBulletinPhoneCopies(dir, { log: (line) => logs.push(line) });
    expect([...(await copies.page(DATE, 1, 1080))!]).toEqual([...broken]);
    expect(existsSync(join(dir, DATE, '1.w1080.jpg'))).toBe(false);
    expect(logs).toEqual([`BULLETIN_PHONE_COPY_FAILED date=${DATE} page=1`]);
  }, 60_000);

  it('does not keep a copy of a page that was posted again while the copy was being made', async () => {
    const copies = createBulletinPhoneCopies(dir);
    const pending = copies.page(DATE, 1, 720);
    // The church office posts that Sunday again (server/bulletins.ts swaps the folder in).
    writeFileSync(join(dir, DATE, '1.jpg'), narrow);
    expect(jpegSize((await pending)!)?.width).toBe(720);
    expect(existsSync(join(dir, DATE, '1.w720.jpg'))).toBe(false);
  }, 60_000);

  it('reads nothing outside the 週刊 folder', async () => {
    const copies = createBulletinPhoneCopies(dir);
    expect(await copies.page('../2026-10-18', 1, 720)).toBeNull();
    expect(await copies.page(DATE, 0, 720)).toBeNull();
    expect(await createBulletinPhoneCopies(undefined).page(DATE, 1, 720)).toBeNull();
  });
});
