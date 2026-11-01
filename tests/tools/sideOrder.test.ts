import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDE_ORDER } from '../../src/ui/congregation/congregationCopy';

// 維護者 2026-10-31:「公告首頁大堂在左邊、青年在右邊，這樣才會跟積分那邊看分數一致，這個你要記得」.
// The 公告 tabs had their own 青少-first list while 積分 put 主堂 first. Every switch now takes SIDE_ORDER; this
// test fails as soon as a screen lists the two sides itself, whatever order it picks.
const ROOTS = ['app', 'src'];
const ALLOWED = new Set(['src/ui/congregation/congregationCopy.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

// ['main', 'youth'] / ["youth","main"] / { value: 'youth' ... }, { value: 'main' ... } in one list.
const PAIR = /\[\s*['"](?:main|youth)['"]\s*,\s*['"](?:main|youth)['"]\s*\]/;
const OBJECTS = /\{\s*value:\s*['"](?:main|youth)['"][^\]]*?\{\s*value:\s*['"](?:main|youth)['"]/;

describe('主堂 and 青少 side by side', () => {
  it('reads 主堂 on the left and 青少 on the right', () => {
    expect(SIDE_ORDER).toEqual(['main', 'youth']);
  });

  it('is ordered only by SIDE_ORDER', () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root))
      .map((path) => relative('.', path).replace(/\\/g, '/'))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => { const text = readFileSync(path, 'utf8'); return PAIR.test(text) || OBJECTS.test(text); });
    expect(offenders, 'list 主堂/青少 through SIDE_ORDER in src/ui/congregation/congregationCopy.ts').toEqual([]);
  });

  it('catches the list the 公告 tabs had before 2026-10-31', () => {
    expect(OBJECTS.test("const SIDES = [{ value: 'youth', name: '青少' }, { value: 'main', name: '主堂' }] as const;")).toBe(true);
    expect(PAIR.test("{(['main', 'youth'] as const).map((side) => {")).toBe(true);
  });
});
