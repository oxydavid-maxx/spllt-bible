import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { checkBulletinRequests } from '../../scripts/ios/check-bulletin-requests';
import { checkViewerTop, type Bitmap } from '../../scripts/ios/check-bulletin-viewer';
import { FIXTURE_PAGE, FIXTURE_WEEK, writeFixtureBulletin } from '../../scripts/ios/make-bulletin-fixture';
import { isA4Portrait, jpegSize, listBulletins } from '../../server/bulletins';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { bulletinHeading } from '../../src/services/bulletinClient';

// iOS flow 44-bulletin (2026-10-19, 2026-10-20): 週刊 pages need the member's token, the list asks for a phone-size copy
// and full screen for the original, and the full-screen bar stays under the status bar. A page that has not loaded
// says so in its label, so the flow waits for the loaded label; run-flows.sh then reads count-proxy's request log
// (token, 200, list copy smaller than the original) and the full-screen screenshot (status bar not covered).
const WEEK = [{ date: '2026-08-30', pages: [{ index: 1 }, { index: 2 }] }];
const okLog = [
  '1 GET /api/bulletins bearer=yes', '2 = 200 /api/bulletins bytes=180',
  '3 GET /api/bulletins/2026-08-30/1?w=1080 bearer=yes', '4 GET /api/bulletins/2026-08-30/2?w=1080 bearer=yes',
  '5 = 200 /api/bulletins/2026-08-30/2?w=1080 bytes=210000', '6 = 200 /api/bulletins/2026-08-30/1?w=1080 bytes=205000',
  '7 GET /api/bulletins/2026-08-30/1 bearer=yes', '8 GET /api/bulletins/2026-08-30/2 bearer=yes',
  '9 = 200 /api/bulletins/2026-08-30/1 bytes=1100000', '10 = 200 /api/bulletins/2026-08-30/2 bytes=1120000',
].join('\n');

describe('reading the request log after the 週刊 flow', () => {
  it('passes when every page came as a phone copy in the list and as the original full screen, with the token', () => {
    const result = checkBulletinRequests(okLog, WEEK);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([
      { path: '/api/bulletins/2026-08-30/1', list: { requests: 1, withBearer: 1, statuses: [200], bytes: [205000] }, full: { requests: 1, withBearer: 1, statuses: [200], bytes: [1100000] } },
      { path: '/api/bulletins/2026-08-30/2', list: { requests: 1, withBearer: 1, statuses: [200], bytes: [210000] }, full: { requests: 1, withBearer: 1, statuses: [200], bytes: [1120000] } },
    ]);
  });

  it('fails a page answered 401, a page asked for without the token, a page never asked for, and a list that did not load', () => {
    const unauthorized = okLog.replace('6 = 200 /api/bulletins/2026-08-30/1?w=1080 bytes=205000', '6 = 401 /api/bulletins/2026-08-30/1?w=1080 UNAUTHORIZED bytes=40');
    expect(checkBulletinRequests(unauthorized, WEEK)).toMatchObject({ ok: false, problems: expect.arrayContaining(['401 /api/bulletins/2026-08-30/1?w=1080']) });
    const bare = okLog.replace('4 GET /api/bulletins/2026-08-30/2?w=1080 bearer=yes', '4 GET /api/bulletins/2026-08-30/2?w=1080 bearer=no');
    expect(checkBulletinRequests(bare, WEEK).ok).toBe(false);
    const missing = okLog.split('\n').filter((line) => !line.includes('2026-08-30/2')).join('\n');
    expect(checkBulletinRequests(missing, WEEK).ok).toBe(false);
    expect(checkBulletinRequests(okLog.replace('2 = 200 /api/bulletins bytes', '2 = 503 /api/bulletins bytes'), WEEK).ok).toBe(false);
    // An old proxy line without the bearer mark is not proof that the token was sent.
    expect(checkBulletinRequests(okLog.replace(/ bearer=yes/g, ''), WEEK).ok).toBe(false);
  });

  it('fails a list that asked for the original, a viewer that never asked for it, and a copy that is not smaller', () => {
    const originalInList = okLog.replace(/\?w=1080/g, '');
    expect(checkBulletinRequests(originalInList, WEEK)).toMatchObject({ ok: false, problems: expect.arrayContaining(['/api/bulletins/2026-08-30/1: the list never asked for a phone copy (?w=)']) });
    const neverOpened = okLog.split('\n').filter((line) => !/\/2026-08-30\/\d bytes|\/2026-08-30\/\d bearer/.test(line)).join('\n');
    expect(checkBulletinRequests(neverOpened, WEEK)).toMatchObject({ ok: false, problems: expect.arrayContaining(['/api/bulletins/2026-08-30/1: the original was never asked for']) });
    const notSmaller = okLog.replace('bytes=205000', 'bytes=1100000');
    expect(checkBulletinRequests(notSmaller, WEEK)).toMatchObject({ ok: false, problems: expect.arrayContaining(['/api/bulletins/2026-08-30/1: the phone copy (1100000 bytes) is not smaller than the original (1100000 bytes)']) });
    expect(checkBulletinRequests(okLog.replace(/ bytes=\d+/g, ''), WEEK).ok).toBe(false);
  });
});

describe('the full-screen screenshot', () => {
  // An iPhone 17 screenshot is 1206 × 2622; the status bar is the top 62 pt (186 px).
  const shot = (rows: (y: number) => [number, number, number], width = 120, height = 2622): Bitmap => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const [r, g, b] = rows(y);
      for (let x = 0; x < width; x += 1) data.set([r, g, b, 255], (y * width + x) * 4);
    }
    return { width, height, data };
  };
  const LIGHT: [number, number, number] = [0xed, 0xf1, 0xea];
  const BAR: [number, number, number] = [0x06, 0x06, 0x06];

  it('passes when the status bar sits on the app background and the black viewer starts under it', () => {
    const result = checkViewerTop(shot((y) => (y < 186 ? LIGHT : BAR)));
    expect(result).toMatchObject({ ok: true, firstDarkRow: 186 });
    // The time and battery are dark marks on the light strip; they do not make it dark.
    const withClock = shot((y) => (y < 186 ? LIGHT : BAR));
    for (let y = 60; y < 110; y += 1) for (let x = 10; x < 40; x += 1) withClock.data.set([0, 0, 0, 255], (y * 120 + x) * 4);
    expect(checkViewerTop(withClock).ok).toBe(true);
  });

  it('fails the 0.5.35 viewer, whose black bar covered the status bar, and a screen with no viewer at all', () => {
    expect(checkViewerTop(shot(() => BAR))).toMatchObject({ ok: false, problems: ['the status bar area is dark: the viewer bar covers it'] });
    expect(checkViewerTop(shot(() => LIGHT))).toMatchObject({ ok: false, problems: ['no dark viewer near the top: the page was not open'] });
    expect(checkViewerTop(shot((y) => (y < 900 ? LIGHT : BAR))).ok).toBe(false);
  });
});

describe('the fixture 週刊', () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'qm-fixture-bulletin-'));
    await writeFixtureBulletin(dir);
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is two synthetic A4 pages at the size the 10/18 週刊 came in, made by a script rather than kept in the repo', () => {
    expect(FIXTURE_PAGE).toEqual({ width: 2481, height: 3509 });
    const weeks = listBulletins(dir);
    expect(weeks.map((week) => ({ date: week.date, pages: week.pages.map((page) => ({ index: page.index })) }))).toEqual(WEEK);
    expect(weeks[0]).toMatchObject({ date: FIXTURE_WEEK.date, postedAt: FIXTURE_WEEK.postedAt });
    for (const page of weeks[0].pages) {
      const size = jpegSize(readFileSync(join(dir, '2026-08-30', `${page.index}.jpg`)));
      expect(size).toEqual({ width: page.width, height: page.height });
      expect(size).toEqual(FIXTURE_PAGE);
      expect(isA4Portrait(size!.width, size!.height)).toBe(true);
    }
    expect(readdirSync(join(dir, '2026-08-30')).sort()).toEqual(['1.jpg', '2.jpg', 'meta.json']);
    // No picture is kept in the repo, real or test: the CI copy is made by scripts/ios/make-bulletin-fixture.ts.
    expect(existsSync('scripts/ios/fixtures/bulletins')).toBe(false);
  });

  it('is served by the fixture backend only with the member token, as a phone copy when the list asks', async () => {
    // Same identity as the CI backend (scripts/ios/run-flows.sh): the token alone selects fixture:self.
    const db = createDatabase({ members: [{ id: 'fixture:self', displayName: '測試成員甲', groupId: 'G01' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'ci-fixture-token', fixtureDefaultMemberId: 'fixture:self', bulletinDir: dir });
      const list = await api({ method: 'GET', url: '/api/bulletins', headers: { authorization: 'Bearer ci-fixture-token' } });
      expect(list.status).toBe(200);
      const page = (headers: Record<string, string>, query = '') => api({ method: 'GET', url: `/api/bulletins/2026-08-30/1${query}`, headers });
      const original = await page({ authorization: 'Bearer ci-fixture-token' });
      expect(original.status).toBe(200);
      expect((await page({})).status).toBe(401);
      expect((await page({ authorization: 'Bearer wrong-token' })).status).toBe(401);
      const copy = await page({ authorization: 'Bearer ci-fixture-token' }, '?w=1080');
      expect(jpegSize(copy.binaryBody!)?.width).toBe(1080);
      expect(copy.binaryBody!.length).toBeLessThan(original.binaryBody!.length / 3);
    } finally { db.close(); }
  }, 60_000);
});

describe('the CI request log', () => {
  const roots: string[] = [];
  let proxy: ChildProcess | null = null;
  let upstream: ReturnType<typeof createServer> | null = null;
  afterEach(async () => {
    proxy?.kill(); proxy = null;
    if (upstream) await new Promise<void>((done) => upstream!.close(() => done()));
    upstream = null;
    roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('marks whether each request carried a bearer token, never the token itself, and how many bytes came back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ci-bearer-')); roots.push(dir);
    const log = join(dir, 'requests.log');
    upstream = createServer((request, response) => { response.writeHead(request.headers.authorization ? 200 : 401); response.end(request.headers.authorization ? Buffer.alloc(1234) : ''); });
    await new Promise<void>((done) => upstream!.listen(0, '127.0.0.1', done));
    const targetPort = (upstream.address() as { port: number }).port;
    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const proxyPort = (reservation.address() as { port: number }).port;
    await new Promise<void>((done) => reservation.close(() => done()));
    proxy = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/ios/count-proxy.ts', String(proxyPort), String(targetPort), log], { cwd: process.cwd(), stdio: 'ignore' });
    const url = `http://127.0.0.1:${proxyPort}/api/bulletins/2026-08-30/1`;
    let first: Response | null = null;
    const until = performance.now() + 5000;
    while (!first && performance.now() < until) {
      try { first = await fetch(url, { headers: { authorization: 'Bearer secret-member-token' } }); }
      catch { await new Promise((wait) => setTimeout(wait, 30)); }
    }
    expect(first?.status).toBe(200);
    expect((await first!.arrayBuffer()).byteLength).toBe(1234);
    expect((await fetch(url)).status).toBe(401);
    await new Promise((wait) => setTimeout(wait, 50));
    const recorded = readFileSync(log, 'utf8');
    expect(recorded).not.toContain('secret-member-token');
    const result = checkBulletinRequests(recorded, [{ date: '2026-08-30', pages: [{ index: 1 }] }]);
    expect(result.pages[0].full).toMatchObject({ requests: 2, withBearer: 1 });
    expect(result.pages[0].full.statuses.sort()).toEqual([200, 401]);
    expect(result.pages[0].full.bytes.sort((a, b) => a - b)).toEqual([0, 1234]);
  });
});

describe('flow 44-bulletin', () => {
  const flow = readFileSync('.maestro/ios/44-bulletin.yaml', 'utf8');
  const runner = readFileSync('scripts/ios/run-flows.sh', 'utf8');
  const commands = JSON.stringify(parseAllDocuments(flow)[1].toJSON());

  it('opens 公告 › 主堂, waits for each page to load and opens a page full screen', () => {
    for (const label of ['公告', '主堂', '2 張・點圖片放大', '8/30 週刊 1 / 2', '8/30 週刊 2 / 2', '關閉週刊']) expect(commands).toContain(label);
    // Maestro reads text as a regular expression: the heading's "(日)" is matched with "."
    expect(bulletinHeading('2026-08-30')).toBe('8/30 (日) 週刊');
    expect(new RegExp(`^${'8/30 .日. 週刊'}$`).test(bulletinHeading('2026-08-30'))).toBe(true);
    expect(commands).toContain('8/30 .日. 週刊');
    // A page says 載入中 in its label until its picture is in (src/ui/bulletin/BulletinBoard.tsx, ZoomablePage.tsx):
    // the flow waits for the loaded labels, so a page that never loads fails it.
    expect(commands).toContain('8/30 .日. 週刊第 1 頁，點了放大');
    expect(commands).toContain('"visible":"8/30 週刊第 1 頁"');
    expect(commands).toContain('"visible":"8/30 週刊第 2 頁"');
    expect(commands).toContain('載不到');
    expect(flow).not.toContain('clearState');
    // It ends full screen on page 2, loaded: run-flows.sh takes the screenshot that shows the status bar from there.
    const steps = parseAllDocuments(flow)[1].toJSON() as unknown[];
    expect(JSON.stringify(steps.at(-1))).toContain('8/30 週刊第 2 頁');
  });

  it('gives the fixture backend a 週刊 made for the run and turns a page without its token, an original in the list or a covered status bar into a failed flow', () => {
    expect(runner).toMatch(/make-bulletin-fixture\.ts "\$OUT\/bulletins"/);
    expect(runner).not.toContain('scripts/ios/fixtures/bulletins');
    expect(runner).toContain('QINGMU_BULLETIN_DIR="$OUT/bulletins"');
    // The log is read from the line where this flow started, so earlier flows cannot pass or fail it.
    expect(runner).toMatch(/FROM=\$\(wc -l < "\$OUT\/requests\.log"\)/);
    expect(runner).toMatch(/44-bulletin\)[\s\S]*?check-bulletin-requests\.ts "\$OUT\/requests\.log" "\$FROM" "\$OUT\/bulletins"/);
    expect(runner).toMatch(/44-bulletin\)[\s\S]*?xcrun simctl io "\$UDID" screenshot "\$OUT\/maestro\/44-bulletin-viewer\.png"/);
    expect(runner).toMatch(/check-bulletin-viewer\.ts "\$OUT\/maestro\/44-bulletin-viewer\.png"/);
    expect(runner).toMatch(/record 44-bulletin FAIL/);
  });
});
