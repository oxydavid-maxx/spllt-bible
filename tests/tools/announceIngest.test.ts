import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAnnouncement, PARENT_FOLDER, PROGRAM_WORKBOOK, SUNDAY_WORKBOOK, type Announcement } from '../../tools/announce/build';

const sources = vi.hoisted(() => ({ fetchFolderHtml: vi.fn(), fetchWorkbook: vi.fn(), fetchSlidesText: vi.fn(), fetchDriveFile: vi.fn(), fetchDocText: vi.fn(), publish: vi.fn() }));
vi.mock('../../tools/announce/fetch', () => sources);
vi.mock('../../tools/announce/publisher', () => ({ publishAnnouncement: sources.publish }));
vi.mock('../../tools/announce/review', () => ({ reviewAnnouncement: async () => ({ sensible: true }) }));

// Small, real stored ZIP members: exercise the actual XLSX reader, not a parser double.
function workbook(tabs: Record<string, string[][]>): Buffer {
  const members: Array<[string, string]> = [
    ['xl/workbook.xml', `<workbook><sheets>${Object.keys(tabs).map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships>${Object.keys(tabs).map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...Object.values(tabs).map((rows, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`]),
  ];
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [path, value] of members) {
    const name = Buffer.from(path), body = Buffer.from(value), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, body); central.push(entry, name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const listing = (...entries: Array<[string, string]>) => entries.map(([id, name]) => `<div id="entry-${id}"><div class="flip-entry-title">${name}</div></div>`).join('');
const parent = listing(['week20', '20260920'], ['week13', '20260913']);
const current = listing(['audio20', '20260920.mp3'], ['doc20', '20260920 青崇講道｜先']);
const normalProgram = workbook({ '中亮第一三周信息排班': [['Date', 'Topic', 'Owner', 'Note'], ['46285', '先', '講員', '約3'], ['46292', '下一次', '輔導', '']] });
const normalSunday = workbook({ '常設': [['key', 'value'], ['地址', '測試地址']] });
const oldWeek: Announcement['past'][number] = { week: '2026-09-13', title: 'Last good', audio: 'https://example.invalid/last-good.mp3', slides: null, transcript: null };
const previous: Announcement = { week: '2026-09-13', generatedAt: '2026-09-15T00:00:00Z', sermon: { ...oldWeek, speaker: null, passage: null, youtube: null }, next: null, standing: { 地址: 'Previous address' }, past: [] };

beforeEach(() => {
  sources.fetchFolderHtml.mockImplementation(async (id: string) => ({ [PARENT_FOLDER]: parent, week20: current, week13: listing(['fresh13', '20260913.mp3']) })[id] ?? null);
  sources.fetchWorkbook.mockImplementation(async (id: string) => id === PROGRAM_WORKBOOK ? normalProgram : normalSunday);
  sources.fetchSlidesText.mockResolvedValue(''); sources.fetchDriveFile.mockResolvedValue(null);
  sources.publish.mockReturnValue('published');
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('qingmu-ingest-')) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
function failFolder(id: string, value: string | null = null) {
  const normal = sources.fetchFolderHtml.getMockImplementation()!;
  sources.fetchFolderHtml.mockImplementation(async (key: string) => key === id ? value : normal(key));
}
async function runIndex(previousValue: Announcement | null, archive?: Announcement) {
  const repo = mkdtempSync(join(tmpdir(), 'qingmu-ingest-')); roots.push(repo); mkdirSync(join(repo, 'announcements'));
  const before = previousValue ? JSON.stringify(previousValue) + '\n' : null;
  if (before) writeFileSync(join(repo, 'announcements/latest.json'), before);
  if (archive) writeFileSync(join(repo, `announcements/${archive.week.replace(/-/g, '')}.json`), JSON.stringify(archive));
  const oldArgv = process.argv, oldRepo = process.env.QINGMU_ANNOUNCE_REPO, oldExit = process.exitCode;
  const output: string[] = [], writer = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write);
  try {
    vi.resetModules(); process.argv = [process.execPath, 'index.ts', '--skip-review', '--date', '2026-09-22'];
    process.env.QINGMU_ANNOUNCE_REPO = repo; process.exitCode = undefined;
    await import('../../tools/announce/index'); await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined());
    return { code: process.exitCode, output: output.join(''), before, after: before ? readFileSync(join(repo, 'announcements/latest.json'), 'utf8') : null };
  } finally {
    writer.mockRestore(); process.argv = oldArgv; process.exitCode = oldExit;
    if (oldRepo === undefined) delete process.env.QINGMU_ANNOUNCE_REPO; else process.env.QINGMU_ANNOUNCE_REPO = oldRepo;
  }
}

describe('announcement source failure preservation', () => {
  it('keeps the existing successful folder/workbook assembly', async () => {
    const result = await buildAnnouncement({ today: '2026-09-22' });
    expect(result.announcement).toMatchObject({ week: '2026-09-20', sermon: { title: '先', speaker: '講員', passage: '約3' }, next: { date: '9/27', topic: '下一次' }, standing: { 地址: '測試地址' } });
  });
  it.each([PROGRAM_WORKBOOK, SUNDAY_WORKBOOK])('withholds when required workbook %s is unavailable and leaves last-good bytes alone', async (id) => {
    sources.fetchWorkbook.mockImplementation(async (key: string) => key === id ? null : key === PROGRAM_WORKBOOK ? normalProgram : normalSunday);
    const result = await runIndex(previous);
    expect(result.code).toBe(1); expect(result.output).toContain('WORKBOOK'); expect(sources.publish).not.toHaveBeenCalled(); expect(result.after).toBe(result.before);
  });
  it.each([PROGRAM_WORKBOOK, SUNDAY_WORKBOOK])('withholds malformed required workbook %s instead of treating it as an empty source', async (id) => {
    sources.fetchWorkbook.mockImplementation(async (key: string) => key === id ? Buffer.from('<html>temporary Drive failure</html>') : key === PROGRAM_WORKBOOK ? normalProgram : normalSunday);
    const result = await buildAnnouncement({ today: '2026-09-22' });
    expect(result.announcement).toBeNull(); expect(result.reason).toContain('WORKBOOK');
  });
  it('accepts successfully fetched empty sources without resurrecting old content', async () => {
    sources.fetchWorkbook.mockResolvedValue(workbook({ '常設': [], '中亮第一三周信息排班': [] }));
    failFolder('week13', '');
    const result = await runIndex(previous);
    expect(result.code).toBe(0);
    expect(sources.publish.mock.calls[0][1]).toMatchObject({ next: null, standing: null, past: [] });
  });
  it('preserves a failed historical week from its last-good archive', async () => {
    failFolder('week13');
    const result = await runIndex({ ...previous, week: '2026-09-20', sermon: null }, previous);
    expect(result.code).toBe(0); expect(sources.publish.mock.calls[0][1].past).toEqual([oldWeek]);
  });
  it('can use the previous latest sermon or past entry as the historical last-good fallback', async () => {
    failFolder('week13');
    expect((await runIndex(previous)).code).toBe(0);
    expect(sources.publish.mock.calls[0][1].past).toEqual([oldWeek]);
    sources.publish.mockClear();
    expect((await runIndex({ ...previous, week: '2026-09-20', sermon: null, past: [oldWeek] })).code).toBe(0);
    expect(sources.publish.mock.calls[0][1].past).toEqual([oldWeek]);
  });
  it('withholds the whole replacement when a failed historical source has no usable fallback', async () => {
    failFolder('week13');
    const result = await runIndex({ ...previous, sermon: null });
    expect(result.code).toBe(1); expect(result.output).toContain('HISTORY'); expect(sources.publish).not.toHaveBeenCalled(); expect(result.after).toBe(result.before);
  });
  it.each([PARENT_FOLDER, 'week20'])('withholds the whole replacement when required folder %s fails', async (id) => {
    failFolder(id); const result = await runIndex(previous);
    expect(result.code).toBe(1); expect(sources.publish).not.toHaveBeenCalled(); expect(result.after).toBe(result.before);
  });
  it('withholds when a listed presentation cannot be downloaded instead of dropping its signup link', async () => {
    failFolder('week20', current + listing(['deck20', '20260920.pptx']));
    const result = await runIndex(previous);
    expect(result.code).toBe(1); expect(result.output).toContain('DECK'); expect(sources.publish).not.toHaveBeenCalled(); expect(result.after).toBe(result.before);
  });
});
