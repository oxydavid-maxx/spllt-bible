import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { checkBulletinRequests } from '../../scripts/ios/check-bulletin-requests';
import { isA4Portrait, jpegSize, listBulletins } from '../../server/bulletins';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { bulletinHeading } from '../../src/services/bulletinClient';

// iOS flow 44-bulletin (2026-10-19): 週刊 pages need the member's token, and a blank frame looks the same as a loaded
// page to Maestro. The flow therefore shows the fixture 週刊 and run-flows.sh reads count-proxy's request log: every page
// asked for with a bearer token and answered 200, nothing answered 401.
const FIXTURE = 'scripts/ios/fixtures/bulletins';
const WEEK = [{ date: '2026-08-30', pages: [{ index: 1 }, { index: 2 }] }];
const okLog = [
  '1 GET /api/bulletins bearer=yes', '2 = 200 /api/bulletins',
  '3 GET /api/bulletins/2026-08-30/1 bearer=yes', '4 GET /api/bulletins/2026-08-30/2 bearer=yes',
  '5 = 200 /api/bulletins/2026-08-30/2', '6 = 200 /api/bulletins/2026-08-30/1',
].join('\n');

describe('reading the request log after the 週刊 flow', () => {
  it('passes when every page was asked for with the token and answered 200', () => {
    const result = checkBulletinRequests(okLog, WEEK);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([
      { path: '/api/bulletins/2026-08-30/1', requests: 1, withBearer: 1, statuses: [200] },
      { path: '/api/bulletins/2026-08-30/2', requests: 1, withBearer: 1, statuses: [200] },
    ]);
  });

  it('fails a page answered 401, a page asked for without the token, a page never asked for, and a list that did not load', () => {
    const unauthorized = okLog.replace('6 = 200 /api/bulletins/2026-08-30/1', '6 = 401 /api/bulletins/2026-08-30/1 UNAUTHORIZED');
    expect(checkBulletinRequests(unauthorized, WEEK)).toMatchObject({ ok: false, problems: expect.arrayContaining(['401 /api/bulletins/2026-08-30/1']) });
    const bare = okLog.replace('4 GET /api/bulletins/2026-08-30/2 bearer=yes', '4 GET /api/bulletins/2026-08-30/2 bearer=no');
    expect(checkBulletinRequests(bare, WEEK).ok).toBe(false);
    const missing = okLog.split('\n').filter((line) => !line.includes('2026-08-30/2')).join('\n');
    expect(checkBulletinRequests(missing, WEEK).ok).toBe(false);
    expect(checkBulletinRequests(okLog.replace('2 = 200 /api/bulletins', '2 = 503 /api/bulletins'), WEEK).ok).toBe(false);
    // An old proxy line without the bearer mark is not proof that the token was sent.
    expect(checkBulletinRequests(okLog.replace(/ bearer=yes/g, ''), WEEK).ok).toBe(false);
  });
});

describe('the fixture 週刊', () => {
  it('is two small A4 test pages, not a real bulletin, and the fixture backend serves them only with the member token', async () => {
    const weeks = listBulletins(FIXTURE);
    expect(weeks.map((week) => ({ date: week.date, pages: week.pages.map((page) => ({ index: page.index })) }))).toEqual(WEEK);
    for (const page of weeks[0].pages) {
      const file = join(FIXTURE, '2026-08-30', `${page.index}.jpg`);
      const size = jpegSize(readFileSync(file));
      expect(size).toEqual({ width: page.width, height: page.height });
      expect(isA4Portrait(size!.width, size!.height)).toBe(true);
      expect(statSync(file).size).toBeLessThan(40_000);
    }
    expect(readdirSync(join(FIXTURE, '2026-08-30')).sort()).toEqual(['1.jpg', '2.jpg', 'meta.json']);
    // Same identity as the CI backend (scripts/ios/run-flows.sh): the token alone selects fixture:self.
    const db = createDatabase({ members: [{ id: 'fixture:self', displayName: '測試成員甲', groupId: 'G01' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'ci-fixture-token', fixtureDefaultMemberId: 'fixture:self', bulletinDir: FIXTURE });
      const list = await api({ method: 'GET', url: '/api/bulletins', headers: { authorization: 'Bearer ci-fixture-token' } });
      expect(list.status).toBe(200);
      const page = (headers: Record<string, string>) => api({ method: 'GET', url: '/api/bulletins/2026-08-30/1', headers });
      expect((await page({ authorization: 'Bearer ci-fixture-token' })).status).toBe(200);
      expect((await page({})).status).toBe(401);
      expect((await page({ authorization: 'Bearer wrong-token' })).status).toBe(401);
    } finally { db.close(); }
  });
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

  it('marks whether each request carried a bearer token, never the token itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ci-bearer-')); roots.push(dir);
    const log = join(dir, 'requests.log');
    upstream = createServer((request, response) => { response.writeHead(request.headers.authorization ? 200 : 401); response.end(); });
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
    expect((await fetch(url)).status).toBe(401);
    await new Promise((wait) => setTimeout(wait, 50));
    const recorded = readFileSync(log, 'utf8');
    expect(recorded).not.toContain('secret-member-token');
    const result = checkBulletinRequests(recorded, [{ date: '2026-08-30', pages: [{ index: 1 }] }]);
    expect(result.pages[0]).toMatchObject({ requests: 2, withBearer: 1 });
    expect(result.pages[0].statuses.sort()).toEqual([200, 401]);
  });
});

describe('flow 44-bulletin', () => {
  const flow = readFileSync('.maestro/ios/44-bulletin.yaml', 'utf8');
  const runner = readFileSync('scripts/ios/run-flows.sh', 'utf8');

  it('opens 公告 › 主堂, shows the fixture 週刊 and opens a page full screen', () => {
    const commands = JSON.stringify(parseAllDocuments(flow)[1].toJSON());
    for (const label of ['公告', '主堂', '2 張・點圖片放大', '8/30 週刊 1 / 2', '8/30 週刊 2 / 2', '關閉週刊']) expect(commands).toContain(label);
    // Maestro reads text as a regular expression: the heading's "(日)" is matched with "."
    expect(bulletinHeading('2026-08-30')).toBe('8/30 (日) 週刊');
    expect(new RegExp(`^${'8/30 .日. 週刊'}$`).test(bulletinHeading('2026-08-30'))).toBe(true);
    expect(commands).toContain('8/30 .日. 週刊');
    expect(flow).not.toContain('clearState');
  });

  it('gives the fixture backend the 週刊 and turns a page without its token into a failed flow', () => {
    expect(runner).toMatch(/cp -R scripts\/ios\/fixtures\/bulletins "\$OUT\/bulletins"/);
    expect(runner).toContain('QINGMU_BULLETIN_DIR="$OUT/bulletins"');
    // The log is read from the line where this flow started, so earlier flows cannot pass or fail it.
    expect(runner).toMatch(/FROM=\$\(wc -l < "\$OUT\/requests\.log"\)/);
    expect(runner).toMatch(/44-bulletin\)[^\n]*check-bulletin-requests\.ts "\$OUT\/requests\.log" "\$FROM" "\$OUT\/bulletins"[^\n]*record 44-bulletin FAIL/);
  });
});
