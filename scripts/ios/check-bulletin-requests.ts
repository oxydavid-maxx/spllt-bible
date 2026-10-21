// scripts/ios/check-bulletin-requests.ts — CI only, run by scripts/ios/run-flows.sh right after flow 44-bulletin.
// The flow shows the fixture 週刊 (公告 › 主堂) and opens it full screen. This reads what count-proxy recorded while the
// flow ran:
// - every page asked for with a bearer token and answered 200 (Android once dropped the token and the pages stayed
//   blank, 2026-10-19); a page that loaded without the token (for example by cookie) does not count;
// - the list asked for each page's phone copy (?w=) and full screen for the original, and the copy that came back is
//   smaller than the original (2026-10-20: the list used to download 2481 × 3509 originals);
// - no 週刊 request answered 4xx/5xx.
// usage: tsx scripts/ios/check-bulletin-requests.ts <requests.log> <first-line> <bulletin-dir> [<receipt.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBulletins } from '../../server/bulletins';

export interface Asked { requests: number; withBearer: number; statuses: number[]; bytes: number[] }
export interface PageEvidence { path: string; list: Asked; full: Asked }
export interface BulletinRequestCheck { ok: boolean; problems: string[]; list: number[]; pages: PageEvidence[] }

const LIST = '/api/bulletins';
const asked = (): Asked => ({ requests: 0, withBearer: 0, statuses: [], bytes: [] });

/**
 * `log` is count-proxy's format: "<ms> <METHOD> <path> bearer=yes|no" per request, "<ms> = <status> <path>[ CODE]
 * bytes=<n>" per answer. A path with ?w= is the list's phone copy; without it, the original.
 */
export function checkBulletinRequests(log: string, weeks: ReadonlyArray<{ date: string; pages: ReadonlyArray<{ index: number }> }>): BulletinRequestCheck {
  const pages = new Map<string, PageEvidence>();
  for (const week of weeks) for (const page of week.pages) {
    const path = `${LIST}/${week.date}/${page.index}`;
    pages.set(path, { path, list: asked(), full: asked() });
  }
  const kind = (target: string) => {
    const [path, query = ''] = target.split('?');
    const page = pages.get(path);
    return page ? (/(^|&)w=\d+/.test(query) ? page.list : page.full) : undefined;
  };
  const list: number[] = [];
  const problems: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    const answer = line.match(/^\d+ = (\d{3}) (\/api\/bulletins(?:[/?]\S*)?)(?:\s|$)/);
    if (answer) {
      const status = Number(answer[1]);
      const bytes = line.match(/ bytes=(\d+)$/);
      if (answer[2] === LIST) list.push(status);
      const target = kind(answer[2]);
      if (target) { target.statuses.push(status); if (bytes) target.bytes.push(Number(bytes[1])); else if (status === 200) problems.push(`${answer[2]}: no byte count in the log`); }
      if (status >= 400) problems.push(`${status} ${answer[2]}`);
      continue;
    }
    const request = line.match(/^\d+ [A-Z]+ (\/api\/bulletins\/\S+)(?: bearer=(yes|no))?(?:\s|$)/);
    const target = request ? kind(request[1]) : undefined;
    if (target) { target.requests += 1; if (request![2] === 'yes') target.withBearer += 1; }
  }
  if (pages.size === 0) problems.push('no fixture 週刊 pages to look for');
  if (!list.includes(200)) problems.push(`${LIST} was not answered 200`);
  for (const page of pages.values()) {
    const where = { list: 'the list never asked for a phone copy (?w=)', full: 'the original was never asked for' } as const;
    for (const side of ['list', 'full'] as const) {
      const evidence = page[side];
      if (evidence.requests === 0) { problems.push(`${page.path}: ${where[side]}`); continue; }
      if (evidence.withBearer < evidence.requests) problems.push(`${page.path}${side === 'list' ? ' (phone copy)' : ''}: ${evidence.requests - evidence.withBearer} of ${evidence.requests} requests carried no bearer token`);
      if (!evidence.statuses.includes(200)) problems.push(`${page.path}${side === 'list' ? ' (phone copy)' : ''} was not answered 200`);
    }
    const copy = page.list.bytes.filter((_, i) => page.list.statuses[i] === 200);
    const original = page.full.bytes.filter((_, i) => page.full.statuses[i] === 200);
    if (copy.length && original.length && Math.max(...copy) >= Math.min(...original)) {
      problems.push(`${page.path}: the phone copy (${Math.max(...copy)} bytes) is not smaller than the original (${Math.min(...original)} bytes)`);
    }
  }
  return { ok: problems.length === 0, problems, list, pages: [...pages.values()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [logFile, firstLine, dir, receipt] = process.argv.slice(2);
  const log = readFileSync(logFile, 'utf8').split('\n').slice(Number(firstLine) || 0).join('\n');
  const result = checkBulletinRequests(log, listBulletins(dir));
  if (receipt) writeFileSync(receipt, JSON.stringify(result, null, 2));
  const kb = (bytes: number[]) => bytes.map((n) => `${(n / 1024).toFixed(1)}KB`).join(',') || '-';
  for (const page of result.pages) {
    console.log(`${page.path} list: requests=${page.list.requests} bearer=${page.list.withBearer} answers=${page.list.statuses.join(',') || '-'} size=${kb(page.list.bytes)}`);
    console.log(`${page.path} full: requests=${page.full.requests} bearer=${page.full.withBearer} answers=${page.full.statuses.join(',') || '-'} size=${kb(page.full.bytes)}`);
  }
  console.log(`${LIST} answers=${result.list.join(',') || '-'}`);
  console.log(result.ok ? 'BULLETIN_REQUESTS PASS' : `BULLETIN_REQUESTS FAIL\n${result.problems.join('\n')}`);
  process.exit(result.ok ? 0 : 1);
}
