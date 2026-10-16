import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('the installed SDK DOM effect publishes and clears the range and recording notice together', () => {
  const source = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/dom/bible-reader.js', 'utf8');
  const ast = ts.createSourceFile('sdk.js', source, ts.ScriptTarget.Latest, true);
  let effect: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.getText(ast).includes("'passage-range'")) effect = node.arguments[0] as ts.ArrowFunction;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(effect, 'range must cross the installed SDK DOM bridge').toBeDefined();
  const attrs = new Map<string, string>();
  const range = { chapterUsfm: 'PSA.119', firstVerse: 89, lastVerse: 176, key: 'day15', label: '詩篇 119:89–176' };
  const scope = { document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } }, qingmuPassageRange: range as any, qingmuPassageAudioNotice: '這段錄音沒有分節，會從頭播整章' as string | null };
  runInNewContext(`(${effect!.getText(ast)})()`, scope);
  expect(JSON.parse(attrs.get('data-qingmu-passage-range')!)).toEqual(range);
  expect(attrs.get('data-qingmu-passage-audio-notice')).toBe(scope.qingmuPassageAudioNotice);
  scope.qingmuPassageRange = null; scope.qingmuPassageAudioNotice = null;
  runInNewContext(`(${effect!.getText(ast)})()`, scope);
  expect(attrs.has('data-qingmu-passage-range')).toBe(false);
  expect(attrs.has('data-qingmu-passage-audio-notice')).toBe(false);
});
