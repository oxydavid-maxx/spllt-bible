import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSwitchLatency, EXPECTED, PENDING_FIX, REPORTED, SWITCH_LIMIT_MS } from '../../scripts/ios/check-switch-latency';

// 光佑 2026-10-23: every switch shows its content within 100 ms on the iOS simulator; one that is not measured fails.
const record = (label: string, ms: number) => ({ label, surface: label, key: 'k', ms, at: new Date().toISOString() });
const allPass = () => Object.fromEntries([...new Set(EXPECTED.map((item) => item.flow))].map((flow) => [flow, EXPECTED.filter((item) => item.flow === flow).flatMap((item) => item.taps.map(() => record(item.label, 12)))]));
const ran = { '14-reader-instant': 'PASS', '44-points-instant': 'PASS' };

describe('iOS switch latency check', () => {
  it('passes only when every tap the flows make has a record at or under the limit', () => {
    expect(SWITCH_LIMIT_MS).toBe(100);
    expect(checkSwitchLatency(allPass(), ran).filter((row) => row.result !== 'INFO').every((row) => row.result === 'PASS')).toBe(true);
  });

  it('fails a slow switch and a switch it cannot find (never passes what it could not measure)', () => {
    const records = allPass();
    records['44-points-instant'][0] = record(records['44-points-instant'][0].label, 101);
    records['44-points-instant'].pop();
    const rows = checkSwitchLatency(records, ran);
    expect(rows.filter((row) => row.result === 'FAIL')).toHaveLength(2);
    expect(rows.find((row) => row.result === 'FAIL' && row.ms === null)).toBeDefined();
    expect(checkSwitchLatency({}, ran).filter((row) => row.result !== 'INFO').every((row) => row.result === 'FAIL')).toBe(true);
  });

  // 光佑 2026-10-28: ship this version while three taps get their own fix. Only those three may be over, and only
  // when measured; every other tap still fails over the limit.
  it('lists the three 待修 taps as PENDING when over, still fails them unmeasured, and fails any other slow tap', () => {
    expect(PENDING_FIX).toHaveLength(3);
    const records = allPass();
    records['14-reader-instant'] = records['14-reader-instant'].map((item) => item.label === 'reader-date' ? record('reader-date', 121) : item);
    const rows = checkSwitchLatency(records, ran);
    expect(rows.filter((row) => row.result === 'PENDING').map((row) => row.tap)).toEqual(['下一個排定讀經日', '上一個排定讀經日 (換回)']);
    expect(rows.some((row) => row.result === 'FAIL')).toBe(false);

    records['44-points-instant'] = records['44-points-instant'].map((item) => item.label === 'group-month' ? record('group-month', 106) : item);
    const both = checkSwitchLatency(records, ran).filter((row) => row.name === '積分 團體月曆換月');
    expect(both.map((row) => row.result)).toEqual(['FAIL', 'PENDING']);

    const unmeasured = allPass();
    unmeasured['14-reader-instant'] = unmeasured['14-reader-instant'].filter((item) => item.label !== 'reader-date');
    expect(checkSwitchLatency(unmeasured, ran).filter((row) => row.name.startsWith('讀經 換日 (')).every((row) => row.result === 'FAIL')).toBe(true);
  });

  it("reports the official reader's own text time without judging it", () => {
    const records = allPass();
    records['14-reader-instant'].push(record('reader-date-text', 1500), record('reader-date-text', 900));
    const reported = checkSwitchLatency(records, ran).filter((row) => row.result === 'INFO');
    expect(reported.map((row) => row.ms)).toEqual([1500, 900]);
    expect(REPORTED.every((item) => item.flow === '14-reader-instant')).toBe(true);
  });

  it('leaves a skipped flow (no YouVersion key) as 略過, and fails the reader taps when it ran without records', () => {
    expect(checkSwitchLatency(allPass(), { ...ran, '14-reader-instant': 'SKIP' }).filter((row) => row.flow === '14-reader-instant').every((row) => row.result === 'SKIP')).toBe(true);
    expect(checkSwitchLatency({ '44-points-instant': allPass()['44-points-instant'] }, ran).filter((row) => row.flow === '14-reader-instant' && row.result !== 'INFO').every((row) => row.result === 'FAIL')).toBe(true);
  });

  it('expects a label the App actually records, from flows that exist', () => {
    const sources = ['app/(tabs)/progress.tsx', 'app/(tabs)/announcements.tsx', 'app/(tabs)/reader.tsx', 'src/ui/devotion/useReaderDevotion.tsx', 'src/ui/gamification/GroupSection.tsx'].map((path) => readFileSync(path, 'utf8')).join('\n');
    for (const item of [...EXPECTED, ...REPORTED]) {
      expect(sources).toContain(`'${item.label}')`);
      expect(existsSync(`.maestro/ios/${item.flow}.yaml`)).toBe(true);
    }
  });
});
