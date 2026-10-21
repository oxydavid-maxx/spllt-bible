import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const docPath = 'docs/backend-structure.md';
// Read source only: importing http.ts could start a server or load external credentials.
const modules = readdirSync('server').filter((name) => name.endsWith('.ts')).sort();
const schemaSources = [
  ...modules.map((name) => `server/${name}`),
  // db.ts executes LOCAL_SCHEMA as well as the schemas declared under server/.
  'src/storage/schema.ts',
];
const tables = [...new Set(schemaSources.flatMap((path) =>
  [...readFileSync(path, 'utf8').matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([a-zA-Z_][\w]*)["`\]]?/gi)]
    .map((match) => match[1]),
))].sort();
const doc = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';

// A passing mention in a paragraph is not an inventory row. Require the name in
// the first cell and non-empty responsibility/caller or data/writer/reader/deletion cells.
function hasRow(name: string, details: number): boolean {
  return doc.split(/\r?\n/).some((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return cells[0] === `\`${name}\`` && cells.length === details + 1
      && cells.slice(1).every((cell) => cell.length > 0);
  });
}

describe('backend structure documentation', () => {
  it('gives every server module a responsibility and callers row', () => {
    const missing = modules.filter((name) => !hasRow(`server/${name}`, 2));
    expect(missing, `後端總說明缺少模組：${missing.join('、')}`).toEqual([]);
  });

  it('gives every declared table a data, writer, reader and account-deletion row', () => {
    const missing = tables.filter((name) => !hasRow(name, 4));
    expect(missing, `後端總說明缺少資料表：${missing.join('、')}`).toEqual([]);
  });
});
