import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReadingCardHtml, cardPeriod, type ReadingCardDay, type ReadingCardScope } from '../../src/domain/readingCard';
import { readerChrome } from '../helpers/readerBrowser';

function render(today: string, scope: ReadingCardScope) {
  const months = cardPeriod(today, scope).months;
  const days: ReadingCardDay[] = [];
  for (const month of months) for (let n = 1; n <= 31; n++) {
    const date = `${month}-${String(n).padStart(2, '0')}`;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (parsed.toISOString().slice(0, 10) !== date || parsed.getUTCDay() === 0) continue;
    days.push({ date, rows: ['雅01章', '徒02章1-24節', '詩119篇89-176節'], completed: date <= today, devoted: date === today });
  }
  const html = buildReadingCardHtml({ today, scope, days, memberName: '測試成員甲' });
  const probe = `<script>document.fonts.ready.then(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { bottom: r.bottom, right: r.right }; };
    const paper = rect(document.querySelector('.paper'));
    const elements = [...document.querySelectorAll('.notes p, .sum, table')];
    const result = { paper, metrics: [...document.querySelectorAll('table, .notes, .sum')].map(el => ({ name: el.className, h: el.getBoundingClientRect().height, bottom: el.getBoundingClientRect().bottom })), dayHeight: document.querySelector('td.day').getBoundingClientRect().height, cssHeight: getComputedStyle(document.querySelector('td.day')).height, rowVariable: getComputedStyle(document.querySelector('.paper')).getPropertyValue('--quarter-day-height'), overflowing: elements.filter(el => rect(el).bottom > paper.bottom + 1 || rect(el).right > paper.right + 1).map(el => el.textContent), rows: [...document.querySelectorAll('.r b')].filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.textContent) };
    const output = document.createElement('pre'); output.id = 'layout-result'; output.textContent = JSON.stringify(result); document.body.appendChild(output);
  });</script>`;
  const directory = mkdtempSync(join(tmpdir(), 'qm-card-layout-'));
  try {
    const file = join(directory, 'card.html');
    writeFileSync(file, html.replace('</body>', `${probe}</body>`));
    const dom = execFileSync(readerChrome(), ['--no-sandbox', '--disable-gpu', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=2000', '--window-size=794,1123', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = /<pre id="layout-result">(.*?)<\/pre>/.exec(dom)?.[1];
    if (!result) throw new Error('Rendered layout measurement is missing');
    return JSON.parse(result);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('reading card rendered at A4 in Chrome', () => {
  it.each([
    ['2026-10-18', 'month'], ['2026-10-18', 'quarter'],
    ['2027-05-31', 'month'], ['2027-05-31', 'quarter'], // Six calendar rows; quarter has 16 rows.
  ] as const)('keeps every table, passage and footer on one page for %s %s', (today, scope) => {
    const measured = render(today, scope);
    if (measured.overflowing.length) console.log(JSON.stringify(measured));
    expect(measured.overflowing).toEqual([]);
    expect(measured.rows).toEqual([]);
  });
});
