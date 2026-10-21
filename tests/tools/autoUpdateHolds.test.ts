import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 光佑 (2026-10-21): a downloaded update is put in place when the app comes back after 30 minutes away, but
// never while narration plays, an input is unsaved or a panel is open (src/ui/admin/OtaUpdates.tsx). The
// reload only knows about those through src/services/autoUpdateGuard.ts, so a new panel, input or player that
// forgets to tell it would be thrown away mid-use. These checks fail for that whole class, not one screen.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path.replaceAll('\\', '/')] : [];
  });
}
const files = [...sources('src'), ...sources('app')].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('everything the reload must not interrupt tells the guard', () => {
  it('every text input holds the update while its content is unsaved', () => {
    const missing = files.filter((file) => /<TextInput\b/.test(file.text) && !/useAutoUpdateHold\(|useJournalEntry\(/.test(file.text)).map((file) => file.path);
    expect(missing, 'a TextInput screen must call useAutoUpdateHold(unsaved, …) or keep its text in useJournalEntry').toEqual([]);
    expect(readFileSync('src/ui/useJournalEntry.ts', 'utf8')).toMatch(/useAutoUpdateHold\(saveStatus === 'unsaved'/);
  });

  it('every modal panel holds the update while it is open', () => {
    // The update prompt is not work in progress: a reload shows it again, and holding on it would keep a
    // phone with a pending store update from ever taking its OTA update.
    const exempt = new Set(['src/ui/UpdatePrompt.tsx']);
    const missing = files.filter((file) => /<Modal\b/.test(file.text) && !exempt.has(file.path) && !/<SheetBackdrop\b|useAutoUpdateHold\(/.test(file.text)).map((file) => file.path);
    expect(missing, 'a Modal must contain the shared SheetBackdrop or call useAutoUpdateHold(open, …)').toEqual([]);
    expect(readFileSync('src/ui/SheetBackdrop.tsx', 'utf8')).toContain('useAutoUpdateHold(true');
    expect(readFileSync('src/ui/sheet/bottomSheet.tsx', 'utf8')).toMatch(/useAutoUpdateHold\(index === 0/);
  });

  it('every audio player and speech engine tells the guard while it plays', () => {
    const players = files.filter((file) => /\b(createAudioPlayer|useAudioPlayer)\(/.test(file.text) && !/createChapterBoundPlayback\(/.test(file.text)).map((file) => file.path);
    expect(players, 'audio players go through createChapterBoundPlayback, which reports playing to the guard').toEqual([]);
    expect(readFileSync('src/services/expoAudioPlayback.ts', 'utf8')).toContain('addAutoUpdateProbe(');
    const speech = files.filter((file) => /Speech\.speak\(/.test(file.text) && !/addAutoUpdateProbe\(/.test(file.text)).map((file) => file.path);
    expect(speech, 'device speech must register Speech.isSpeakingAsync with addAutoUpdateProbe').toEqual([]);
  });

  it('reloads in exactly one place, behind the guard', () => {
    const reloads = files.filter((file) => /Updates\.reloadAsync\s*\(/.test(file.text)).map((file) => file.path);
    expect(reloads).toEqual(['src/ui/admin/OtaUpdates.tsx']);
    const source = readFileSync('src/ui/admin/OtaUpdates.tsx', 'utf8');
    expect(source.match(/Updates\.reloadAsync\s*\(/g)).toHaveLength(1);
    const reload = source.indexOf('Updates.reloadAsync(');
    const decision = source.slice(source.lastIndexOf('async function', reload), reload);
    expect(decision).toContain('autoUpdateBlockers()');
    expect(decision).toContain('AUTO_APPLY_AWAY_MS');
  });
});
