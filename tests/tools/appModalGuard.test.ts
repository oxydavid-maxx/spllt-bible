import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 夜間模式 on Android (Pixel, 2026-11-05): a React Native Modal is its own window, and without statusBarTranslucent and
// navigationBarTranslucent its navigation bar stayed light grey at night, and its status bar icons kept the colour of the
// moment it opened. src/ui/AppModal.tsx sets them for every panel; a screen that takes Modal from react-native directly
// brings the bug back, so this fails for the whole class.
const OWNER = 'src/ui/AppModal.tsx';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path.replaceAll('\\', '/')] : [];
  });
}

export function directModalUses(path: string, text: string): string[] {
  if (path === OWNER) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (node: ts.Node) => `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    // import { Modal } from 'react-native' (also `Modal as Sheet`)
    if (ts.isImportDeclaration(node) && /^['"]react-native['"]$/.test(node.moduleSpecifier.getText())) {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) if ((element.propertyName ?? element.name).text === 'Modal' && !element.isTypeOnly) found.push(`${at(node)} imports Modal from react-native`);
      }
    }
    // require('react-native').Modal, or const { Modal } = require('react-native')
    if (ts.isCallExpression(node) && node.expression.getText() === 'require' && node.arguments[0]?.getText().replace(/["']/g, '') === 'react-native') {
      const parent = node.parent;
      const text = parent?.getText() ?? '';
      if ((ts.isPropertyAccessExpression(parent) && parent.name.text === 'Modal') || (ts.isVariableDeclaration(parent) && /\bModal\b/.test(parent.name.getText()))) found.push(`${at(node)} takes Modal from require('react-native'): ${text.slice(0, 40)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('every panel opens through AppModal', () => {
  it('no screen takes Modal from react-native directly', () => {
    const uses = [...sources('src'), ...sources('app')].flatMap((path) => directModalUses(path, readFileSync(path, 'utf8')));
    expect(uses, 'use AppModal (src/ui/AppModal.tsx): it keeps the Android system bars with the app scheme').toEqual([]);
  });

  it('AppModal makes the dialog edge-to-edge and rebuilds it when the scheme changes', () => {
    const owner = readFileSync(OWNER, 'utf8');
    expect(owner).toMatch(/<Modal \{\.\.\.props\} statusBarTranslucent navigationBarTranslucent hardwareAccelerated=\{barsScheme === 'dark'\} \/>/);
  });

  it('catches each way of reaching Modal', () => {
    expect(directModalUses('src/ui/Probe.tsx', "import { Modal, View } from 'react-native';")).toHaveLength(1);
    expect(directModalUses('src/ui/Probe.tsx', "import { Modal as Sheet } from 'react-native';")).toHaveLength(1);
    expect(directModalUses('src/ui/Probe.tsx', "const Sheet = require('react-native').Modal;")).toHaveLength(1);
    expect(directModalUses('src/ui/Probe.tsx', "const { Modal } = require('react-native');")).toHaveLength(1);
    expect(directModalUses('src/ui/Probe.tsx', "import type { ModalProps } from 'react-native';\nimport { AppModal } from './AppModal';")).toEqual([]);
  });
});
