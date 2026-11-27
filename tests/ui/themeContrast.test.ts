import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPalette, contrast } from '../../scripts/check-contrast';
import { darkColors, lightColors } from '../../src/ui/Theme';

// 夜間模式 (光佑 2026-11-04): words at 4.5:1 or more and control edges at 3:1 or more, in both palettes.
describe('both palettes are readable', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it.each([['light', lightColors], ['dark', darkColors]] as const)('%s: every word and control edge passes', (_name, palette) => {
    const failures = checkPalette(palette).filter((row) => !row.ok).map((row) => `${row.fg}/${row.bg} ${row.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('fails a palette that is too dark, and a colour it cannot read', () => {
    const tooDark = checkPalette({ ...darkColors, muted: '#3A3A3A', borderStrong: '#2A2A2A' }).filter((row) => !row.ok);
    expect(tooDark.map((row) => `${row.kind}:${row.fg}/${row.bg}`)).toEqual(expect.arrayContaining(['text:muted/background', 'text:muted/surface', 'control:borderStrong/surface']));
    expect(checkPalette({ ...lightColors, ink: 'not-a-colour' }).some((row) => row.fg === 'ink' && !row.ok)).toBe(true);
  });

  it('the script exits non-zero on a palette that is too dark', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qingmu-contrast-'));
    try {
      const palette = join(dir, 'too-dark.json');
      writeFileSync(palette, JSON.stringify({ muted: '#3A3A3A', borderStrong: '#2A2A2A' }));
      let status = 0;
      let out = '';
      try { out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-contrast.ts', '--palette', palette], { encoding: 'utf8', windowsHide: true }); }
      catch (error) { status = (error as { status: number }).status; out = String((error as { stdout: string }).stdout); }
      expect(status).toBe(1);
      expect(out).toContain('CONTRAST FAIL');
      expect(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-contrast.ts'], { encoding: 'utf8', windowsHide: true })).toContain('CONTRAST PASS');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
