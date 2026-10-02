import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAnnouncement, PARENT_FOLDER, PROGRAM_WORKBOOK, SUNDAY_WORKBOOK, type Announcement } from '../../tools/announce/build';

const sources = vi.hoisted(() => ({ fetchFolderHtml: vi.fn(), fetchWorkbook: vi.fn(), fetchSlidesText: vi.fn(), fetchDriveFile: vi.fn(), fetchDocText: vi.fn(), fetchFormText: vi.fn(), linkAccess: vi.fn(async () => 'open'), publish: vi.fn(), review: vi.fn(async () => ({ sensible: true })) }));
vi.mock('../../tools/announce/fetch', () => sources);
vi.mock('../../tools/announce/publisher', () => ({ publishAnnouncement: sources.publish }));
vi.mock('../../tools/announce/review', () => ({ reviewAnnouncement: sources.review }));

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
const oldWeek: Announcement['past'][number] = { week: '2026-09-13', title: 'Last good', speaker: null, audio: 'https://example.invalid/last-good.mp3', slides: null, transcript: null };
const previous: Announcement = { week: '2026-09-13', generatedAt: '2026-09-15T00:00:00Z', sermon: { ...oldWeek, speaker: null, passage: null, youtube: null }, next: null, standing: { 地址: 'Previous address' }, past: [] };

beforeEach(() => {
  sources.fetchFolderHtml.mockImplementation(async (id: string) => ({ [PARENT_FOLDER]: parent, week20: current, week13: listing(['fresh13', '20260913.mp3']) })[id] ?? null);
  sources.fetchWorkbook.mockImplementation(async (id: string) => id === PROGRAM_WORKBOOK ? normalProgram : normalSunday);
  sources.fetchSlidesText.mockResolvedValue(''); sources.fetchDriveFile.mockResolvedValue(null);
  sources.fetchFormText.mockResolvedValue(null);
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
async function runIndex(previousValue: Announcement | null, archive?: Announcement, options: { review?: boolean } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'qingmu-ingest-')); roots.push(repo); mkdirSync(join(repo, 'announcements'));
  const before = previousValue ? JSON.stringify(previousValue) + '\n' : null;
  if (before) writeFileSync(join(repo, 'announcements/latest.json'), before);
  if (archive) writeFileSync(join(repo, `announcements/${archive.week.replace(/-/g, '')}.json`), JSON.stringify(archive));
  const oldArgv = process.argv, oldRepo = process.env.QINGMU_ANNOUNCE_REPO, oldExit = process.exitCode;
  const output: string[] = [], writer = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write);
  try {
    vi.resetModules(); process.argv = [process.execPath, 'index.ts', ...(options.review ? [] : ['--skip-review']), '--date', '2026-09-22'];
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

describe('the next gathering, in full (光佑 2026-09-27: both sessions and who serves)', () => {
  it('lists the first and second session and the roster row for the next date', async () => {
    sources.fetchWorkbook.mockImplementation(async (id: string) => id === PROGRAM_WORKBOOK
      ? workbook({
          '中亮第二四周青年啟發內容': [['Date', 'Topic', 'Owner', 'Note'], ['46292', ['耶穌：耶穌是誰？', '你是否親眼見過名人？'].join(String.fromCharCode(10)), '中亮/大專', '']],
          '小丁第二四周第二堂': [['Date', 'Topic', 'Owner', 'Note'], ['46292', '爸媽不在家，我要活下去系列: 豚汁定食/如何殺柚子', '淑君校長/大廚', '']],
        })
      : workbook({
          '常設': [['key', 'value'], ['地址', '測試地址']],
          '2026服事表': [
            ['2026竹科靈糧堂 青年崇拜/服事表'],
            ['日期', '講員', '敬拜團+詩歌', '主領(報告)', '招待', '影音(投影/音控)', '聖餐', '愛筵', '清潔', '小組長'],
            ['46292', '中亮', '大專青少混合', '光佑', '小丁/文樂', '柏睿/獻巍＆采人', '-', '淑君及大廚們', '全體', ''],
          ],
        }));
    const { announcement } = await buildAnnouncement({ today: '2026-09-22' });
    expect(announcement?.next).toMatchObject({
      date: '9/27',
      sessions: [
        { label: '第一堂', kind: '青年啟發', title: '耶穌：耶穌是誰？', owner: '中亮/大專' },
        { label: '第二堂', kind: null, title: '青少團契', owner: null },
      ],
      roles: [
        { label: '講員', value: '中亮' }, { label: '敬拜團+詩歌', value: '大專青少混合' }, { label: '主領(報告)', value: '光佑' },
        { label: '招待', value: '小丁/文樂' }, { label: '影音(投影/音控)', value: '柏睿/獻巍＆采人' }, { label: '愛筵', value: '淑君及大廚們' },
        { label: '清潔', value: '全體' },
      ],
    });
  });
});

describe('the second session is 青少團契, nothing more (維護者 2026-10-01)', () => {
  const sunday = workbook({ '常設': [['key', 'value'], ['地址', '測試地址']] });
  const program = (tabs: Record<string, string[][]>) => { sources.fetchWorkbook.mockImplementation(async (id: string) => id === PROGRAM_WORKBOOK ? workbook(tabs) : sunday); };
  const header = ['Date', 'Topic', 'Owner', 'Note'];

  it.each(['正慧姐青崇一三周第二堂規劃', '小丁第二四周第二堂'])('shows only 青少團契 from %s, and keeps its plan out of topic and owner', async (tab) => {
    program({
      '中亮第一三周信息排班': [header, ['46285', '先', '講員', '約3'], ['46292', ['創世記：神的應許', '小組問題'].join(String.fromCharCode(10)), '中亮', '']],
      [tab]: [header, ['46292', '創世記3~5章', '分組進行', '']],
    });
    const { announcement } = await buildAnnouncement({ today: '2026-09-22' });
    expect(announcement?.next).toMatchObject({
      date: '9/27', topic: '創世記：神的應許', owner: '中亮',
      sessions: [
        { label: '第一堂', kind: '信息', title: '創世記：神的應許', owner: '中亮' },
        { label: '第二堂', kind: null, title: '青少團契', owner: null },
      ],
    });
    expect(JSON.stringify(announcement)).not.toMatch(/創世記3~5章|分組進行/);
  });

  it('names a Sunday that only has a second-session row 青少團契, without its plan', async () => {
    program({
      '中亮第一三周信息排班': [header, ['46285', '先', '講員', '約3']],
      '正慧姐青崇一三周第二堂規劃': [header, ['46299', '創世記3~5章', '分組進行', '']],
    });
    const { announcement } = await buildAnnouncement({ today: '2026-09-22' });
    expect(announcement?.next).toMatchObject({ date: '10/4', topic: '青少團契', owner: null, sessions: [{ label: '第二堂', kind: null, title: '青少團契', owner: null }] });
    expect(JSON.stringify(announcement)).not.toMatch(/創世記3~5章|分組進行/);
  });

  it('leaves the second session out when its tab has no row for that Sunday', async () => {
    program({
      '中亮第一三周信息排班': [header, ['46285', '先', '講員', '約3'], ['46292', '下一次', '輔導', '']],
      '小丁第二四周第二堂': [header, ['46306', '別週', '別人', '']],
    });
    const { announcement } = await buildAnnouncement({ today: '2026-09-22' });
    expect(announcement?.next?.sessions).toEqual([{ label: '第一堂', kind: '信息', title: '下一次', owner: '輔導' }]);
  });
});

describe('the daily run (光佑 2026-09-27: once a day, and no tokens when nothing changed)', () => {
  it('asks for the review only when the announcement changed', async () => {
    const built = (await buildAnnouncement({ today: '2026-09-22' })).announcement!;
    sources.review.mockClear();
    expect((await runIndex({ ...built, generatedAt: '2000-01-01T00:00:00.000Z' }, undefined, { review: true })).code).toBe(0);
    expect(sources.review).not.toHaveBeenCalled();
    expect((await runIndex({ ...built, standing: { 地址: '搬家了' } }, undefined, { review: true })).code).toBe(0);
    expect(sources.review).toHaveBeenCalledTimes(1);
  });
});

// 2026-09-29 (光佑): the 10/4 notice linked the 9/27 sign-up form. The link came from THIS week's
// deck but was shown under the NEXT gathering. A form is only offered when it states that date.
describe('the sign-up link belongs to the next gathering', () => {
  const THIS_DECK = 'T'.repeat(44), NEXT_DECK = 'N'.repeat(44);
  const thisWeekForm = 'https://forms.gle/ThisWeek20', nextWeekForm = 'https://forms.gle/NextWeek27';
  const formPage = (date: string) => `<html><title>青年崇拜報名表</title><div>聚會時間: ${date}（日）</div></html>`;
  function withDecks(options: { nextFolder?: boolean; thisDeckLink?: string; nextDeckLink?: string; forms: Record<string, string | null> }) {
    const parentListing = options.nextFolder ? listing(['week27', '20260927'], ['week20', '20260920'], ['week13', '20260913']) : parent;
    const currentListing = current + (options.thisDeckLink ? listing([THIS_DECK, '20260920青崇(全)PPT']) : '');
    const folders: Record<string, string> = { [PARENT_FOLDER]: parentListing, week20: currentListing, week13: listing(['fresh13', '20260913.mp3']) };
    if (options.nextFolder) folders.week27 = options.nextDeckLink ? listing([NEXT_DECK, '20260927青崇(全)PPT']) : '';
    sources.fetchFolderHtml.mockImplementation(async (id: string) => folders[id] ?? null);
    sources.fetchSlidesText.mockImplementation(async (id: string) => id === THIS_DECK ? `報名 QR code：${options.thisDeckLink}` : id === NEXT_DECK ? `報名：${options.nextDeckLink}` : '');
    sources.fetchFormText.mockImplementation(async (url: string) => options.forms[url] ?? null);
  }

  it("does not offer this week's form under the next gathering", async () => {
    withDecks({ thisDeckLink: thisWeekForm, forms: { [thisWeekForm]: formPage('9/20') } });
    const result = await buildAnnouncement({ today: '2026-09-22' });
    expect(result.announcement?.next).toMatchObject({ date: '9/27', signup: null });
    expect(result.signupCheck).toContain('9/20');
  });

  it("uses the next gathering's own deck when its folder is already there", async () => {
    withDecks({ nextFolder: true, thisDeckLink: thisWeekForm, nextDeckLink: nextWeekForm, forms: { [thisWeekForm]: formPage('9/20'), [nextWeekForm]: formPage('9/27') } });
    const result = await buildAnnouncement({ today: '2026-09-22' });
    expect(result.announcement?.next?.signup).toBe(nextWeekForm);
    expect(result.signupCheck).toMatch(/^ok 9\/27 /);
  });

  it("keeps a link from this week's deck when that form is for the next gathering", async () => {
    withDecks({ thisDeckLink: nextWeekForm, forms: { [nextWeekForm]: formPage('9/27') } });
    expect((await buildAnnouncement({ today: '2026-09-22' })).announcement?.next?.signup).toBe(nextWeekForm);
  });

  it('offers no link when the form cannot be read, rather than an unchecked one', async () => {
    withDecks({ thisDeckLink: nextWeekForm, forms: {} });
    const result = await buildAnnouncement({ today: '2026-09-22' });
    expect(result.announcement?.next?.signup).toBeNull();
    expect(result.signupCheck).toContain('unreadable');
  });

  it('says in the daily log what it decided about the link', async () => {
    withDecks({ thisDeckLink: thisWeekForm, forms: { [thisWeekForm]: formPage('9/20') } });
    const result = await runIndex(previous);
    expect(result.output).toMatch(/SIGNUP: omitted: .*9\/20/);
    expect(sources.publish.mock.calls.at(-1)?.[1].next.signup).toBeNull();
  });
});
