import { describe, expect, it } from 'vitest';
import { compareFootprints } from '../../scripts/ios/compare-footprints';

// R3 vs main (2026-10-23): 首頁, 讀經頁 and 積分頁 each stay within 1.10 × main; what was not measured never passes.
const flows = { '00-smoke': 'PASS', '10-reader-open': 'PASS', '20-audio-start': 'PASS' };
const main = { footprintMB: 145.2, flows, runtime: { home: { footprintMB: 145.2 }, reader: { footprintMB: 125.9 } } };

describe('iOS memory against main', () => {
  it('compares 首頁 and 讀經頁 with main (main keeps the reader figure under runtime), and skips 積分頁 until main has one', () => {
    const rows = compareFootprints({ footprintMB: 150, footprintReaderMB: 130, footprintProgressMB: 170, flows: { ...flows, '14-reader-instant': 'PASS', '44-points-instant': 'PASS' } }, main);
    expect(rows.map((row) => row.result)).toEqual(['PASS', 'PASS', 'SKIP']);
  });

  it('fails a page over 1.10 × main and a page this run did not measure', () => {
    const rows = compareFootprints({ footprintMB: 160, footprintReaderMB: 0, footprintProgressMB: 170, flows }, { ...main, footprintProgressMB: 150 });
    expect(rows.map((row) => row.result)).toEqual(['FAIL', 'FAIL', 'FAIL']);
    expect(compareFootprints({ footprintMB: 150, footprintReaderMB: 130, footprintProgressMB: 170, flows: { ...flows, '44-points-instant': 'PASS' } }, { ...main, footprintProgressMB: 150, flows: { ...flows, '44-points-instant': 'PASS' } })[2].result).toBe('FAIL');
  });

  it('skips a page whose earlier flows differ from main, and everything when main has no baseline yet', () => {
    expect(compareFootprints({ footprintMB: 150, footprintReaderMB: 130, footprintProgressMB: 170, flows: { '00-smoke': 'PASS', '05-new': 'PASS', '10-reader-open': 'PASS' } }, main).map((row) => row.result)).toEqual(['PASS', 'SKIP', 'SKIP']);
    expect(compareFootprints({ footprintMB: 150, footprintReaderMB: 130, footprintProgressMB: 170, flows }, null).every((row) => row.result === 'SKIP')).toBe(true);
  });
});
