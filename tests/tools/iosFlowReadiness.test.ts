import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

const flow = (name: string) => readFileSync(new URL(`../../.maestro/ios/${name}.yaml`, import.meta.url), 'utf8');

describe('iOS flow readiness and semantic interaction targets', () => {
  it('waits for the initial reader redirect, then bounds navigation by the destination hierarchy', () => {
    const source = flow('00-smoke');
    const readerReady = source.indexOf('visible: "更多閱讀工具"');
    const navigation = source.indexOf('- repeat:');
    const pointsTap = source.indexOf('text: "積分"');
    expect(readerReady, 'Tabs exist before Today finishes replacing itself with Reader.').toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(readerReady);
    expect(pointsTap).toBeGreaterThan(navigation);
    const commands = parseAllDocuments(source)[1].toJSON();
    const repeat = commands.find((command: unknown) =>
      typeof command === 'object' && command !== null && Object.hasOwn(command, 'repeat'))?.repeat;
    expect(repeat, 'A failed destination check must not cause an unbounded loop or retry a whole test.').toEqual({
      times: 3,
      while: { notVisible: '開啟積分操作' },
      commands: [{ tapOn: { text: '積分', retryTapIfNoChange: false } }],
    });
    expect(source.indexOf('visible: "開啟積分操作"')).toBeGreaterThan(pointsTap);
    expect(source).toContain('visible: "測試成員甲"');
  });

  it('does not use screenshot animation polling as cold-start navigation readiness', () => {
    const source = flow('00-smoke');
    // ee0fd5e: the first waitForAnimationToEnd lost XCUITest during screenshot;
    // the App stayed alive and the next nine flows passed. Keep the final evidence,
    // but use the destination hierarchy, not transient reader pixels, for readiness.
    expect(source).not.toContain('- waitForAnimationToEnd:');
    expect(source).not.toContain('retryTapIfNoChange: true');
    expect(source).toContain('- takeScreenshot: 00-smoke');
    expect(source).not.toContain('optional: true');
  });

  it('selects and deselects a loaded verse by its observed accessibility text, not a screen coordinate', () => {
    const source = flow('12-reader-verse');
    const targets = [...source.matchAll(/- tapOn:\r?\n\s+text: '([^']+)'/g)].map(match => match[1]);
    expect(targets, 'Daily chapters wrap differently; the old 50%,40% point landed between lines in Psalm 107.').toHaveLength(2);
    expect(targets[0]).toBe(targets[1]);
    expect(source).not.toMatch(/^\s+point:/m);
    const scriptureReady = source.indexOf(`visible: '${targets[0]}'`);
    expect(scriptureReady).toBeGreaterThan(-1);
    expect(scriptureReady).toBeLessThan(source.indexOf(`text: '${targets[0]}'`));
    expect(source).toContain('visible: "Copy"');
    expect(source).toContain('notVisible: "Copy"');
  });

  it('matches the observed verse-one labels, including NBSP, without selecting verse 10 or a chapter chip', () => {
    const source = flow('12-reader-verse');
    const target = source.match(/- tapOn:\r?\n\s+text: '([^']+)'/)?.[1];
    expect(target, 'Use a semantic first-verse selector from the captured iOS hierarchy.').toBeDefined();
    const selector = new RegExp(target!);
    for (const label of ['1', '1 ', '1\u00a0']) expect(selector.test(label)).toBe(true);
    for (const label of ['10', '11', '詩篇 107，今日第1段，共2段']) expect(selector.test(label)).toBe(false);
  });
});
