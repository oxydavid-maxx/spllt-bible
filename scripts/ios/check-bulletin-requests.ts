// scripts/ios/check-bulletin-requests.ts — CI only, run by scripts/ios/run-flows.sh right after flow 44-bulletin.
// The flow shows the fixture 週刊 (公告 › 主堂), but to Maestro a page that never loaded is the same frame as one that
// did. A page needs the member's token (Android once dropped it and the pages stayed blank, 2026-10-19), so this reads
// what count-proxy recorded while the flow ran: every fixture page asked for with a bearer token and answered 200, and
// no 週刊 request answered 4xx/5xx. A page that loaded without the token (for example by cookie) does not count.
// usage: tsx scripts/ios/check-bulletin-requests.ts <requests.log> <first-line> <bulletin-dir> [<receipt.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBulletins } from '../../server/bulletins';

export interface PageEvidence { path: string; requests: number; withBearer: number; statuses: number[] }
export interface BulletinRequestCheck { ok: boolean; problems: string[]; list: number[]; pages: PageEvidence[] }

const LIST = '/api/bulletins';

/** `log` is count-proxy's format: "<ms> <METHOD> <path> bearer=yes|no" per request, "<ms> = <status> <path>[ CODE]" per answer. */
export function checkBulletinRequests(log: string, weeks: ReadonlyArray<{ date: string; pages: ReadonlyArray<{ index: number }> }>): BulletinRequestCheck {
  const pages = new Map<string, PageEvidence>();
  for (const week of weeks) for (const page of week.pages) {
    const path = `${LIST}/${week.date}/${page.index}`;
    pages.set(path, { path, requests: 0, withBearer: 0, statuses: [] });
  }
  const list: number[] = [];
  const problems: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    const answer = line.match(/^\d+ = (\d{3}) (\/api\/bulletins(?:\/\S*)?)(?:\s|$)/);
    if (answer) {
      const status = Number(answer[1]);
      const path = answer[2].split('?')[0];
      if (path === LIST) list.push(status);
      else pages.get(path)?.statuses.push(status);
      if (status >= 400) problems.push(`${status} ${path}`);
      continue;
    }
    const request = line.match(/^\d+ [A-Z]+ (\/api\/bulletins\/\S+)(?: bearer=(yes|no))?(?:\s|$)/);
    const page = request ? pages.get(request[1].split('?')[0]) : undefined;
    if (page) { page.requests += 1; if (request![2] === 'yes') page.withBearer += 1; }
  }
  if (pages.size === 0) problems.push('no fixture 週刊 pages to look for');
  if (!list.includes(200)) problems.push(`${LIST} was not answered 200`);
  for (const page of pages.values()) {
    if (page.requests === 0) problems.push(`${page.path} was never asked for`);
    else if (page.withBearer < page.requests) problems.push(`${page.path}: ${page.requests - page.withBearer} of ${page.requests} requests carried no bearer token`);
    if (!page.statuses.includes(200)) problems.push(`${page.path} was not answered 200`);
  }
  return { ok: problems.length === 0, problems, list, pages: [...pages.values()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [logFile, firstLine, dir, receipt] = process.argv.slice(2);
  const log = readFileSync(logFile, 'utf8').split('\n').slice(Number(firstLine) || 0).join('\n');
  const result = checkBulletinRequests(log, listBulletins(dir));
  if (receipt) writeFileSync(receipt, JSON.stringify(result, null, 2));
  for (const page of result.pages) console.log(`${page.path} requests=${page.requests} bearer=${page.withBearer} answers=${page.statuses.join(',') || '-'}`);
  console.log(`${LIST} answers=${result.list.join(',') || '-'}`);
  console.log(result.ok ? 'BULLETIN_REQUESTS PASS' : `BULLETIN_REQUESTS FAIL\n${result.problems.join('\n')}`);
  process.exit(result.ok ? 0 : 1);
}
