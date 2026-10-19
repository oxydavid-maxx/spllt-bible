import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

const flow = (name: string) => readFileSync(new URL(`../../.maestro/ios/${name}.yaml`, import.meta.url), 'utf8');

describe('iOS flow readiness and semantic interaction targets', () => {
  it('reaches the observed points header before opening the account on every OTA cold start', () => {
    // Run 39182315294 captured reader tabs but no account control; flow 45's public path works.
    const commands = parseAllDocuments(flow('43-ota-channel'))[1].toJSON();
    const launches = commands.map((value: unknown, index: number) => value === 'launchApp' || (typeof value === 'object' && value !== null && Object.hasOwn(value, 'launchApp')) ? index : -1).filter((index: number) => index >= 0);
    expect(launches).toHaveLength(3);
    for (const start of launches) {
      const account = commands.findIndex((value: { tapOn?: unknown }, index: number) => index > start && value.tapOn === '開啟帳戶');
      expect(account).toBeGreaterThan(start);
      const segment = commands.slice(start, account);
      expect(segment.some((value: { extendedWaitUntil?: { visible?: string } }) => value.extendedWaitUntil?.visible === '開啟積分操作')).toBe(true);
    }
  });
  it('bounds background-reader expansion by the visible points tab without weakening the narration journey', () => {
    const commands = parseAllDocuments(flow('21-audio-after-background'))[1].toJSON();
    const reveal = commands.find((command: unknown) =>
      typeof command === 'object' && command !== null && Object.hasOwn(command, 'repeat'))?.repeat;
    expect(reveal).toEqual({
      times: 3,
      while: { notVisible: '積分' },
      commands: [
        { extendedWaitUntil: { visible: '展開閱讀工具', timeout: 15000 } },
        { tapOn: { text: '展開閱讀工具', retryTapIfNoChange: false } },
      ],
    });
    expect(commands[0]).toEqual({ extendedWaitUntil: { visible: '暫停.*語音', timeout: 15000 } });
    // The bounded reveal is not a retry of the test; every original navigation/audio assertion remains.
    expect(commands.slice(-7)).toEqual([
      { extendedWaitUntil: { visible: '積分', timeout: 10000 } },
      { tapOn: { text: '積分', retryTapIfNoChange: true } },
      { extendedWaitUntil: { visible: '開啟積分操作', timeout: 15000 } },
      { tapOn: '讀經入口' },
      { assertVisible: '暫停.*語音' },
      { tapOn: '暫停.*語音' },
      { extendedWaitUntil: { visible: '播放.*語音', timeout: 10000 } },
    ]);
  });

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
    // 0.5.27 moved the member's own name into the goal card under the calendar, below an iPhone's fold.
    const ownName = commands.find((command: unknown) =>
      typeof command === 'object' && command !== null && Object.hasOwn(command, 'scrollUntilVisible'))?.scrollUntilVisible;
    expect(ownName).toMatchObject({ element: '測試成員甲', direction: 'DOWN' });
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

  it('never taps or asserts a tab the tab bar hides', () => {
    // 0.5.27 hid 日記 (href: null) and 00-smoke and 41-journal still looked for its 靈修日記 button; only
    // the 40-minute iOS run found out, after the merge.
    const layout = readFileSync(new URL('../../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
    const hidden = [...layout.matchAll(/<Tabs\.Screen name="[^"]+" options=\{\{ href: null,[^\n]*?tabBarAccessibilityLabel: '([^']+)'/g)].map(match => match[1]);
    expect(hidden).toContain('靈修日記');
    const flows = readdirSync(new URL('../../.maestro/ios/', import.meta.url)).filter(name => name.endsWith('.yaml'));
    for (const name of flows) {
      const source = flow(name.replace(/\.yaml$/, ''));
      for (const label of hidden) expect(source, `${name} uses the hidden ${label} tab`).not.toMatch(new RegExp(`["']${label}["']`));
    }
  });
});
