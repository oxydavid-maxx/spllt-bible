import { backfillBibleVersion } from '../server/bibleCacheBackfill';
import { installNat64Fallback } from '../server/nat64Fallback';

// Usage: npx tsx scripts/bible-cache-backfill.ts --dir <QingmuYouthPilot>/bible-cache [--version 46] [--pause-ms 1500]
// Writes into the folder the running server reads (file by file, through a temporary name), so no restart is needed.
async function main(): Promise<void> {
  const arg = (name: string, fallback?: string) => {
    const at = process.argv.indexOf(`--${name}`);
    return at > 0 ? process.argv[at + 1] : fallback;
  };
  const dir = arg('dir');
  if (!dir) throw new Error('--dir is required');
  // The same outbound fallback the server uses (server/http.ts), or bible.com is unreachable on this network.
  if (process.env.QINGMU_NAT64_FALLBACK?.trim() !== '0') installNat64Fallback();
  const result = await backfillBibleVersion({
    versionId: Number(arg('version', '46')),
    diskCacheDir: dir,
    pauseMs: Number(arg('pause-ms', '1500')),
    progress: (line) => console.log(line),
  });
  console.log(`BACKFILL_DONE chapters=${result.chapters} from_bible_com=${result.fromBibleCom} failed=${result.failed.length}${result.failed.length ? ` ${result.failed.join(',')}` : ''}`);
  if (result.failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
