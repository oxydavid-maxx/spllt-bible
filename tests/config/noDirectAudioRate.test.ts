import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('forbids direct playbackRate assignments anywhere in src; expo-audio native property has no setter (#13)', () => {
  const failures: string[] = [];
  function scan(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) { scan(path); continue; }
      if (!/\.tsx?$/.test(path)) continue;
      const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          const left = node.left;
          if ((ts.isPropertyAccessExpression(left) && left.name.text === 'playbackRate') ||
              (ts.isElementAccessExpression(left) && ts.isStringLiteral(left.argumentExpression) && left.argumentExpression.text === 'playbackRate')) failures.push(`${path}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
    }
  }
  scan('src'); expect(failures).toEqual([]);
});
