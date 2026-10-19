import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { androidForwardedHeaders } from '../helpers/androidImageHeaders';

// 週刊 pages were blank on a Pixel (0.5.34, 2026-10-19): React Native 0.85's Android Image passes request headers to
// the native view only when `source` is an array, so `{ uri, headers }` lost the member's bearer token and the backend
// answered 401. iOS reads headers from every source (ReactCommon/react/renderer/components/image/conversions.h), so
// only Android showed it, and the Android workflow runs no flows. This holds the whole class in unit: an image source
// that carries headers is always written as an array.

const root = fileURLToPath(new URL('../../', import.meta.url));
const reactNative = (path: string) => readFileSync(join(root, 'node_modules', 'react-native', path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const propertyName = (property: ts.ObjectLiteralElementLike) =>
  property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;

/** `file:line` of every `{ uri, headers }` object that is not an entry of an array literal. */
function looseHeaderSources(files: Array<{ name: string; text: string }>): string[] {
  const found: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file.name, file.text, ts.ScriptTarget.Latest, true, file.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const names = new Set(node.properties.map(propertyName));
        if (names.has('uri') && names.has('headers')) {
          let parent = node.parent;
          while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) parent = parent.parent;
          if (!ts.isArrayLiteralExpression(parent)) found.push(`${file.name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe('an image source with request headers', () => {
  it('is an array everywhere in the app, so Android sends the headers too', () => {
    const files = ['src', 'app'].flatMap((dir) => sourceFiles(join(root, dir))).map((path) => ({ name: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }));
    expect(files.length).toBeGreaterThan(50);
    expect(looseHeaderSources(files), 'Write it as [{ uri, headers }]: Image.android.js drops headers from a single source object').toEqual([]);
  });

  it('is caught in the written form that lost the token, and allowed as an array', () => {
    const check = (text: string) => looseHeaderSources([{ name: 'probe.tsx', text }]);
    expect(check('export const page = (uri: string, t: string) => ({ uri, headers: { authorization: `Bearer ${t}` } });')).toEqual(['probe.tsx:1']);
    expect(check('const a = <Image source={{ uri: u, headers: h }} />;')).toEqual(['probe.tsx:1']);
    expect(check('export const page = (uri: string, h: Record<string, string>) => [{ uri, headers: h }];')).toEqual([]);
    expect(check('const s = [({ uri: u, headers: h } as const)];')).toEqual([]);
    expect(check('void fetch(u, { headers: { authorization: t } });')).toEqual([]);
  });

  it('matches what React Native 0.85 actually does with headers on Android', () => {
    // Image.android.js: headers_ is set only in the Array.isArray(source_) branch, from source_[0].
    const image = reactNative('Libraries/Image/Image.android.js');
    const arrayBranch = image.indexOf('if (Array.isArray(source_)) {');
    const elseBranch = image.indexOf('} else {', arrayBranch);
    const branchEnd = image.indexOf('sources_ = [source_];', elseBranch);
    expect(arrayBranch).toBeGreaterThan(-1);
    expect(elseBranch).toBeGreaterThan(arrayBranch);
    expect(branchEnd).toBeGreaterThan(elseBranch);
    expect(image.slice(arrayBranch, elseBranch)).toMatch(/headers: sourceHeaders[\s\S]*= source_\[0\];[\s\S]*headers_ = sourceHeaders;/);
    expect(image.slice(elseBranch, branchEnd)).not.toContain('headers');
    expect(image.match(/headers_ = /g)).toHaveLength(1);
    expect(image).toContain('nativeProps.headers = headers_;');
    // And the native view reads only uri, size and cache from each source; headers come only from that prop.
    const view = reactNative('ReactAndroid/src/main/java/com/facebook/react/views/image/ReactImageView.kt');
    const start = view.indexOf('public fun setSource(');
    const setSource = view.slice(start, view.indexOf('public fun ', start + 1));
    expect(setSource).toContain('source.getString("uri")');
    expect(setSource).not.toContain('headers');
    expect(androidForwardedHeaders({ uri: 'u', headers: { a: '1' } })).toBeUndefined();
    expect(androidForwardedHeaders([{ uri: 'u', headers: { a: '1' } }])).toEqual({ a: '1' });
  });
});
