import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkDownloadHref, findDownloadHref } from '../src/config/installLink';

// usage: tsx scripts/verify-install-link.ts <install page URL> <the APK that should be served>
// Run after publishing: the button must point at an APK next to the page, and that URL must serve
// exactly the file that was built, as an Android package.
async function main(): Promise<void> {
  const [pageUrl, apkPath] = process.argv.slice(2);
  if (!pageUrl || !apkPath) throw new Error('usage: tsx scripts/verify-install-link.ts <pageUrl> <apk>');
  const page = await fetch(pageUrl, { redirect: 'manual' });
  if (page.status !== 200) throw new Error(`install page answered ${page.status}`);
  const href = findDownloadHref(await page.text());
  if (!href) throw new Error('install page has no download button');
  const problems = checkDownloadHref(pageUrl, href);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const apkUrl = new URL(href, pageUrl).toString();
  const download = await fetch(apkUrl, { redirect: 'manual' });
  if (download.status !== 200) throw new Error(`APK link answered ${download.status}`);
  const type = download.headers.get('content-type');
  if (type !== 'application/vnd.android.package-archive') throw new Error(`APK served as ${type}`);
  const served = createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex');
  const built = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
  if (served !== built) throw new Error(`served APK ${served} is not the built APK ${built}`);
  console.log(`install link ok: ${apkUrl} serves the built APK (${served.slice(0, 16)}…)`);
}

main().catch((error) => { console.error(String(error instanceof Error ? error.message : error)); process.exit(1); });
