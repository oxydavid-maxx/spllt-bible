import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every .ps1 that contains non-ASCII must start with a UTF-8 BOM.
 *
 * Windows PowerShell 5.1 — still what `powershell.exe` runs on a stock Windows 11 box — decodes a
 * BOM-less file as the system codepage. On a Traditional Chinese machine that turns every Chinese
 * string literal in a script into mojibake, which breaks quote pairing, and the parse error it
 * produces blames a stray parenthesis and never mentions encoding. PowerShell 7 defaults to UTF-8
 * and hides the whole thing, so the failure only appears on a machine that is not the one the
 * script was written on.
 *
 * This is regression insurance, not the fix. The fix is writing the BOM at the point a script is
 * created; a check that runs afterwards is what let this recur — it was already recorded here in
 * July and cost the same afternoon again in September.
 *
 * Asserting bytes rather than parsing: `[Parser]::ParseFile` under pwsh 7 reports "syntax OK" on
 * exactly the file that cannot run under 5.1, so a parse check is not merely weaker here, it is
 * incapable of answering the question.
 */

const TOOLS = join(__dirname, '..', 'tools');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scripts(path);
    return entry.isFile() && entry.name.endsWith('.ps1') ? [path] : [];
  });
}

describe('PowerShell scripts survive Windows PowerShell 5.1', () => {
  const found = scripts(TOOLS);

  it('finds the scripts it is meant to guard', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it.each(found)('%s starts with a UTF-8 BOM if it holds non-ASCII', (path) => {
    const bytes = readFileSync(path);
    const hasNonAscii = bytes.some((byte) => byte > 0x7f);
    if (!hasNonAscii) return;
    expect(bytes.subarray(0, 3).equals(BOM)).toBe(true);
  });
});
