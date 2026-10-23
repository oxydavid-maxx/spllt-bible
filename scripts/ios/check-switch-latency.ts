// scripts/ios/check-switch-latency.ts <records-dir> <flows.json> <out.json>
// 光佑 2026-10-23: every switch shows its content within 100 ms — the first tap after a page opens, a switch back and a
// change of month alike. The app's probe (src/services/switchLatencyProbe.ts, CI fixture build only) writes one
// record per tap: the milliseconds from the tap to the frame that shows the content. run-flows.sh copies each
// latency flow's records to <records-dir>/<flow>/. Every tap the flow makes must have a record at or under the limit;
// a tap without one was not measured and FAILs. A flow that was skipped (no YouVersion key) leaves its taps 略過.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SWITCH_LIMIT_MS = 100;

interface Probe { label: string; surface: string; key: string; ms: number; commitMs?: number; renderMs?: number; layoutMs?: number; marks?: Record<string, number>; renders?: Record<string, number>; gc?: { count: number; ms: number }; at: string }
export interface SwitchExpectation { flow: string; label: string; name: string; taps: string[] }

// In the order the flows tap. Keep in step with .maestro/ios/14-reader-instant.yaml and 44-points-instant.yaml.
export const EXPECTED: SwitchExpectation[] = [
  { flow: '14-reader-instant', label: 'devotional-tab', name: '讀經 靈修分頁', taps: ['讀經頁打開後第一次點'] },
  { flow: '14-reader-instant', label: 'reader-date', name: '讀經 換日 (靈修打勾狀態)', taps: ['下一個排定讀經日', '上一個排定讀經日 (換回)'] },
  { flow: '44-points-instant', label: 'announcement-side', name: '公告 青少｜主堂', taps: ['主堂 (打開後第一次)', '青少 (切回)', '主堂 (再切)'] },
  { flow: '44-points-instant', label: 'group-side', name: '積分 團體 全教會｜青少', taps: ['全教會 (打開後第一次)', '青少 (切回)', '全教會 (再切)', '青少 (切回)'] },
  { flow: '44-points-instant', label: 'group-month', name: '積分 團體月曆換月', taps: ['上個月', '下個月 (換回)'] },
  { flow: '44-points-instant', label: 'calendar-month', name: '積分 個人月曆換月', taps: ['上個月', '下個月 (換回)'] },
  { flow: '44-points-instant', label: 'reward-side', name: '積分 主堂獎品｜青少獎品', taps: ['主堂獎品 (打開後第一次)', '青少獎品 (切回)', '主堂獎品 (再切)'] },
  { flow: '44-points-instant', label: 'scope', name: '積分 自己｜好友', taps: ['好友 (打開後第一次)', '自己 (切回)', '好友 (再切)', '自己 (切回)'] },
  { flow: '44-points-instant', label: 'redemptions', name: '積分 我的領取紀錄', taps: ['打開後第一次'] },
];

// Measured and reported, never judged: the official YouVersion reader showing the next day's text after ‹ ›. It is
// the SDK's own page and its own fetch (the app cannot keep it); the app's part of the same tap is reader-date above.
export const REPORTED: SwitchExpectation[] = [
  { flow: '14-reader-instant', label: 'reader-date-text', name: '讀經 換日 YouVersion 經文出現 (外部元件，只記錄)', taps: ['下一個排定讀經日', '上一個排定讀經日 (換回)'] },
];

export interface SwitchRow { flow: string; name: string; tap: string; ms: number | null; result: 'PASS' | 'FAIL' | 'SKIP' | 'INFO' }

export function checkSwitchLatency(recordsByFlow: Record<string, Probe[]>, flows: Record<string, string>): SwitchRow[] {
  const rows: SwitchRow[] = [];
  for (const expectation of EXPECTED) {
    const ran = flows[expectation.flow];
    const records = (recordsByFlow[expectation.flow] ?? []).filter((record) => record.label === expectation.label);
    expectation.taps.forEach((tap, index) => {
      if (ran === 'SKIP') { rows.push({ flow: expectation.flow, name: expectation.name, tap, ms: null, result: 'SKIP' }); return; }
      const ms = records[index]?.ms;
      const measured = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0;
      rows.push({ flow: expectation.flow, name: expectation.name, tap, ms: measured ? ms : null, result: measured && ms <= SWITCH_LIMIT_MS ? 'PASS' : 'FAIL' });
    });
  }
  for (const expectation of REPORTED) {
    const records = (recordsByFlow[expectation.flow] ?? []).filter((record) => record.label === expectation.label);
    expectation.taps.forEach((tap, index) => {
      const ms = records[index]?.ms;
      rows.push({ flow: expectation.flow, name: expectation.name, tap, ms: typeof ms === 'number' && Number.isFinite(ms) ? ms : null, result: flows[expectation.flow] === 'SKIP' ? 'SKIP' : 'INFO' });
    });
  }
  return rows;
}

function readRecords(dir: string): Probe[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^switch-latency-\d+\.json$/.test(name)).sort()
    .flatMap((name) => { try { return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Probe[]; } catch { return []; } })
    .sort((a, b) => a.at.localeCompare(b.at));
}

if (process.argv[1]?.endsWith('check-switch-latency.ts')) {
  const [recordsDir, flowsPath, outPath] = process.argv.slice(2);
  const flows = existsSync(flowsPath) ? JSON.parse(readFileSync(flowsPath, 'utf8')) as Record<string, string> : {};
  const recordsByFlow = Object.fromEntries([...new Set(EXPECTED.map((item) => item.flow))].map((flow) => [flow, readRecords(join(recordsDir, flow))]));
  const rows = checkSwitchLatency(recordsByFlow, flows);
  writeFileSync(outPath, JSON.stringify({ limitMs: SWITCH_LIMIT_MS, rows, records: recordsByFlow }, null, 2));
  for (const row of rows) console.log(`${row.result} ${row.name} ${row.tap}: ${row.ms === null ? '沒量到' : `${row.ms} ms`}`);
  // Where each switch's time went (render, layout, effects, frame), for the report.
  for (const [flow, records] of Object.entries(recordsByFlow)) for (const record of records) console.log(`  ${flow} ${record.label} ${record.key}: render ${record.renderMs ?? '-'} / layout ${record.layoutMs ?? '-'} / commit ${record.commitMs ?? '-'} / frame ${record.ms} ms${record.marks ? ` / ${Object.entries(record.marks).map(([name, ms]) => `${name} ${ms}`).join(', ')}` : ''}${record.renders ? ` / renders ${Object.entries(record.renders).map(([name, count]) => `${name}×${count}`).join(', ')}` : ''}${record.gc ? ` / gc ${record.gc.count}× ${record.gc.ms} ms` : ''}`);
  process.exit(rows.some((row) => row.result === 'FAIL') ? 1 : 0);
}
