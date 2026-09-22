import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { listZipEntries, readZipFile } from '../../tools/announce/zip';
import { pptxSlideText, xlsxSheetRows } from '../../tools/announce/office';

/**
 * A .pptx and an .xlsx are zips of XML, so the weekly job reads both with a regex and costs nothing.
 * The zips below are built byte by byte rather than checked in as fixtures, so the test says what
 * the format is rather than trusting a blob somebody downloaded once.
 */

interface Member { name: string; data: Buffer; store?: boolean }

function buildZip(members: Member[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const method = member.store ? 0 : 8;
    const body = member.store ? member.data : deflateRawSync(member.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(member.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(member.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const text = (value: string) => Buffer.from(value, 'utf8');

describe('reading a zip without a zip library', () => {
  it('lists what is inside and reads a deflated entry', () => {
    const zip = buildZip([{ name: 'a.txt', data: text('hello') }, { name: 'b/c.xml', data: text('<x>字</x>') }]);
    expect(listZipEntries(zip).map((entry) => entry.name)).toEqual(['a.txt', 'b/c.xml']);
    expect(readZipFile(zip, 'b/c.xml')?.toString('utf8')).toBe('<x>字</x>');
  });

  it('reads a stored entry too, which small files often are', () => {
    const zip = buildZip([{ name: 'a.txt', data: text('stored'), store: true }]);
    expect(readZipFile(zip, 'a.txt')?.toString('utf8')).toBe('stored');
  });

  it('says nothing for a file that is not there', () => {
    expect(readZipFile(buildZip([{ name: 'a.txt', data: text('x') }]), 'missing.xml')).toBeNull();
  });

  it('says nothing for something that is not a zip at all', () => {
    expect(listZipEntries(Buffer.from('this is a pdf, honestly'))).toEqual([]);
  });
});

describe('slide text out of a .pptx', () => {
  const slide = (runs: string[]) =>
    text(`<p:sld><p:cSld><p:spTree>${runs.map((run) => `<a:p><a:r><a:t>${run}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`);

  it('returns one string per slide, in slide order', () => {
    // Slide 10 before slide 2 in the directory: ordering must be numeric, not lexicographic.
    const pptx = buildZip([
      { name: 'ppt/slides/slide10.xml', data: slide(['第十張']) },
      { name: 'ppt/slides/slide2.xml', data: slide(['第二張']) },
      { name: 'ppt/slides/slide1.xml', data: slide(['張珉銓', '好好肌力體能創辦人']) },
    ]);
    expect(pptxSlideText(pptx)).toEqual(['張珉銓 好好肌力體能創辦人', '第二張', '第十張']);
  });

  it('decodes the entities PowerPoint writes', () => {
    const pptx = buildZip([{ name: 'ppt/slides/slide1.xml', data: slide(['GOODCALL S&amp;C STUDIO']) }]);
    expect(pptxSlideText(pptx)).toEqual(['GOODCALL S&C STUDIO']);
  });

  it('gives an empty list for a deck with no slides rather than throwing', () => {
    expect(pptxSlideText(buildZip([{ name: 'docProps/app.xml', data: text('<x/>') }]))).toEqual([]);
  });
});

describe('a worksheet addressed by the tab name a person sees', () => {
  const workbook = text(
    '<workbook><sheets>'
    + '<sheet name="可能服事人選" sheetId="1" r:id="rId1"/>'
    + '<sheet name="中亮第一三周信息排班" sheetId="2" r:id="rId2"/>'
    + '</sheets></workbook>');
  const rels = text(
    '<Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>'
    + '</Relationships>');
  const sharedStrings = text('<sst><si><t>人違背神</t></si><si><t>光佑</t></si><si><t>創3</t></si><si><t>小組長</t></si></sst>');
  const sheet1 = text('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row></sheetData></worksheet>');
  const sheet2 = text(
    '<worksheet><sheetData>'
    + '<row r="1"><c r="A1"><v>46285</v></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>'
    + '</sheetData></worksheet>');

  const book = buildZip([
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: sharedStrings },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ]);

  it('returns the tab that was asked for, not the first one', () => {
    // The gviz endpoint silently falls back to sheet 1 on some workbooks. That is the whole reason
    // this reads the file directly: a wrong table that looks like data is worse than an error.
    expect(xlsxSheetRows(book, '中亮第一三周信息排班')).toEqual([['46285', '人違背神', '光佑', '創3']]);
    expect(xlsxSheetRows(book, '可能服事人選')).toEqual([['小組長']]);
  });

  it('returns nothing for a tab that does not exist', () => {
    expect(xlsxSheetRows(book, '不存在的分頁')).toEqual([]);
  });

  function withCells(cells: string): Buffer {
    return buildZip([
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: rels },
      { name: 'xl/sharedStrings.xml', data: sharedStrings },
      { name: 'xl/worksheets/sheet2.xml', data: text(`<worksheet><sheetData><row r="2">${cells}</row></sheetData></worksheet>`) },
    ]);
  }

  it('keeps omitted owner cells empty instead of moving scripture into the owner column', () => {
    const sparse = withCells('<c r="A2"><v>46285</v></c><c r="B2" t="s"><v>0</v></c><c r="D2" t="s"><v>2</v></c>');
    expect(xlsxSheetRows(sparse, '中亮第一三周信息排班')).toEqual([['46285', '人違背神', '', '創3']]);
  });

  it('preserves a leading omitted cell, self-closing blanks and columns past Z', () => {
    const sparse = withCells('<c r="B2" t="s"><v>0</v></c><c r="C2"/><c r="D2" t="s"><v>2</v></c><c r="AA2" t="inlineStr"><is><t>最後一欄</t></is></c>');
    const [row] = xlsxSheetRows(sparse, '中亮第一三周信息排班');
    expect(row.slice(0, 4)).toEqual(['', '人違背神', '', '創3']);
    expect(row.slice(4, 26)).toEqual(Array(22).fill(''));
    expect(row[26]).toBe('最後一欄');
    expect(row).toHaveLength(27);
  });

  it('does not consume a later cell value for a self-closing empty cell', () => {
    const sparse = withCells('<c r="A2"/><c r="C2"><v>42</v></c>');
    expect(xlsxSheetRows(sparse, '中亮第一三周信息排班')).toEqual([['', '', '42']]);
  });

  it('distinguishes an unreadable workbook from a valid empty worksheet', () => {
    expect(() => xlsxSheetRows(Buffer.from('<html>temporary error</html>'), '常設')).toThrow('XLSX');
    expect(xlsxSheetRows(withCells(''), '中亮第一三周信息排班')).toEqual([]);
  });

  it('rejects a declared worksheet whose contents cannot be read', () => {
    const broken = buildZip([{ name: 'xl/workbook.xml', data: workbook }, { name: 'xl/_rels/workbook.xml.rels', data: rels }]);
    expect(() => xlsxSheetRows(broken, '中亮第一三周信息排班')).toThrow('XLSX');
  });

  it('rejects a truncated worksheet instead of publishing it as empty', () => {
    const broken = buildZip([
      { name: 'xl/workbook.xml', data: workbook }, { name: 'xl/_rels/workbook.xml.rels', data: rels },
      { name: 'xl/worksheets/sheet2.xml', data: text('<worksheet><sheetData><row r="2">') },
    ]);
    expect(() => xlsxSheetRows(broken, '中亮第一三周信息排班')).toThrow('XLSX');
  });
});
