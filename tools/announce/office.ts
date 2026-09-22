import { readZipFile, readZipMatching } from './zip';

/**
 * Text out of the two Office formats the 青崇 folder actually contains.
 *
 * A .pptx and an .xlsx are both zips of XML, so neither needs a model to read. That is the whole
 * reason the weekly job costs nothing at runtime: the expensive-looking step is a regex over
 * decompressed XML.
 */

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Slide text, one string per slide, in slide order. */
export function pptxSlideText(buffer: Buffer): string[] {
  const slides = readZipMatching(buffer, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  slides.sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
  return slides.map(({ data }) => {
    const xml = data.toString('utf8');
    return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decode(match[1]).trim())
      .filter(Boolean)
      .join(' ');
  });
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

/**
 * Rows of one worksheet, addressed by the tab name a person sees.
 *
 * By name rather than by index, and deliberately not through the Sheets gviz endpoint: that endpoint
 * accepts a `sheet=` parameter, silently ignores it on some workbooks, and hands back the first tab
 * instead — which looks like data and is the wrong table.
 */
export function xlsxSheetRows(buffer: Buffer, tabName: string): string[][] {
  const workbook = readZipFile(buffer, 'xl/workbook.xml')?.toString('utf8');
  const rels = readZipFile(buffer, 'xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !rels) return [];

  const target: Record<string, string> = {};
  for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    target[match[1]] = match[2].replace(/^\/?xl\//, '');
  }
  const sheet = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
    .map((match) => ({ name: decode(match[1]), file: target[match[2]] }))
    .find((candidate) => candidate.name === tabName);
  if (!sheet?.file) return [];

  const shared = sharedStrings(buffer);
  const xml = readZipFile(buffer, `xl/${sheet.file}`)?.toString('utf8');
  if (!xml) return [];

  const rows: string[][] = [];
  for (const rowXml of xml.split('<row').slice(1)) {
    const cells: string[] = [];
    for (const cellXml of rowXml.split('<c ').slice(1)) {
      cells.push(cellValue(cellXml, shared));
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function cellValue(cellXml: string, shared: string[]): string {
  const value = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
  if (/t="s"/.test(cellXml) && value) return shared[Number(value[1])] ?? '';
  if (/t="(inlineStr|str)"/.test(cellXml)) {
    const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellXml);
    return inline ? decode(inline[1]) : '';
  }
  return value ? value[1] : '';
}

/** One shared string can be several runs that concatenate into a single cell value. */
function sharedStrings(buffer: Buffer): string[] {
  const xml = readZipFile(buffer, 'xl/sharedStrings.xml')?.toString('utf8');
  if (!xml) return [];
  return xml.split('<si>').slice(1).map((chunk) => {
    const body = chunk.split('</si>')[0];
    return decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(''));
  });
}
