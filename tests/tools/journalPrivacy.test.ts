import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const decision = 'docs/features/journal.md 的「決定」：日記不上傳到伺服器，內容只存在手機';
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.[jt]sx?$/.test(name) ? [path] : [];
});
const journalFiles = [...files('src'), ...files('app')].filter(path => /journal/i.test(path));

describe('journal privacy is enforced at the source boundary', () => {
  it('has no journal transport or outgoing content path', () => {
    const offenders = journalFiles.filter(path => /\b(?:fetch|fetchImpl|request)\s*\(|\b(?:XMLHttpRequest|WebSocket|axios|createApiClient|createJournalApiClient)\b|\/api\/me\/journal|\.(?:post|put|send)\s*\(|async\s+function\s+flushOnce|async\s+saveEntry\s*\(/.test(readFileSync(path, 'utf8')));
    expect(offenders, decision).toEqual([]);
    expect(existsSync('src/services/journalApiClient.ts'), decision).toBe(false);
  });

  it('explains local storage and export on the journal page without an upload status', () => {
    const page = readFileSync('app/(tabs)/journal.tsx', 'utf8');
    expect(page, decision).toContain('日記只存在這支手機，不會上傳。換手機或重裝前，請先「匯出全部」。');
    for (const path of ['app/(tabs)/journal.tsx', 'src/ui/JournalPanel.tsx']) {
      expect(readFileSync(path, 'utf8'), decision).not.toContain('尚未上傳');
    }
  });
});
