import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// 夜間模式 (光佑 2026-11-04, docs/features/night-mode.md): every screen follows the scheme the app shows, and the app
// changes scheme while it is open (18:00, 06:00, the phone's own setting). Two kinds of mistake leave a white block on
// a dark screen, and each fails here for every screen file at once:
//   1. a colour written into the screen ('#FFFFFF', 'rgba(…)', 'white') instead of a token from src/ui/Theme.ts;
//   2. a colour fixed when the file loads (a palette imported into the screen, or the current colours read outside
//      any function): that style keeps the colours of the moment the app started.
// Colours come from src/ui/useAppTheme.ts while a component renders: makeStyles, useColors, or currentColors() inside a
// function for what is drawn outside React.

const HEX = /(^|[^&\w])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const FUNCTIONAL = /\b(?:rgba?|hsla?)\s*\(/i;
const NAMED = /^(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|brown|navy|teal|maroon|olive|lime|aqua|fuchsia|gold|beige|ivory|khaki|lavender|salmon|tan|wheat|snow|whitesmoke|gainsboro|lightgray|lightgrey|darkgray|darkgrey|dimgray|dimgrey)$/i;
const COLOUR_KEY = /(?:^|[a-z])(?:color|Color)$|^(?:fill|stroke|tint|background)$/;
// Only these may hold or pick a palette: they are where the scheme is decided.
const PALETTE_OWNERS = new Set(['src/ui/Theme.ts', 'src/ui/useAppTheme.ts', 'src/ui/NightModeProvider.tsx']);
const PALETTE_EXPORTS = new Set(['lightColors', 'darkColors', 'colorsFor']);
const CURRENT_COLOURS = new Set(['useColors', 'useAppTheme', 'currentColors']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path.replaceAll('\\', '/')] : [];
  });
}

export function themeViolations(path: string, text: string): string[] {
  if (path === 'src/ui/Theme.ts') return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (node: ts.Node) => `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const insideFunction = (node: ts.Node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return true;
    return false;
  };
  const keyOf = (node: ts.Node): string | null => {
    const parent = node.parent;
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) return parent.name.getText().replace(/['"]/g, '');
    if (parent && ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) return parent.parent.name.getText();
    if (parent && ts.isJsxAttribute(parent)) return parent.name.getText();
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const value = node.text;
      const parent = node.parent;
      const isModule = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent));
      if (!isModule && (HEX.test(value) || FUNCTIONAL.test(value))) found.push(`${at(node)} hard-coded colour ${JSON.stringify(value.slice(0, 40))}`);
      else if (!isModule && NAMED.test(value.trim())) {
        const key = keyOf(node);
        if (key && COLOUR_KEY.test(key)) found.push(`${at(node)} hard-coded colour ${key}: ${JSON.stringify(value)}`);
      }
    }
    if (ts.isImportDeclaration(node) && !PALETTE_OWNERS.has(path) && /\/Theme['"]$/.test(node.moduleSpecifier.getText())) {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (PALETTE_EXPORTS.has(name) && !element.isTypeOnly && !node.importClause?.isTypeOnly) found.push(`${at(node)} imports the palette ${name}: colours would be fixed instead of following 夜間模式`);
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CURRENT_COLOURS.has(node.expression.text) && !insideFunction(node)) {
      found.push(`${at(node)} reads colours when the file loads (${node.expression.text}() outside a function)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('screens follow 夜間模式', () => {
  const files = [...sources('src/ui'), ...sources('app')];

  it('no screen file writes a colour or fixes one when it loads', () => {
    const violations = files.flatMap((path) => themeViolations(path, readFileSync(path, 'utf8')));
    expect(violations, 'use a token from src/ui/Theme.ts through makeStyles/useColors (src/ui/useAppTheme.ts)').toEqual([]);
  });

  it('catches each kind of mistake', () => {
    const probe = (text: string) => themeViolations('src/ui/Probe.tsx', text);
    expect(probe("const styles = StyleSheet.create({ card: { backgroundColor: '#FFFFFF' } });")).toHaveLength(1);
    expect(probe("const scrim = { backgroundColor: 'rgba(0,0,0,0.4)' };")).toHaveLength(1);
    expect(probe("export const X = () => <Icon color=\"white\" />;")).toHaveLength(1);
    expect(probe("import { lightColors } from './Theme';\nconst styles = StyleSheet.create({ card: { backgroundColor: lightColors.surface } });")).toHaveLength(1);
    expect(probe("import { currentColors } from './useAppTheme';\nconst FIXED = currentColors().surface;")).toHaveLength(1);
    // Allowed: tokens read while rendering, a reload screen built when it is needed, words that only look like colours.
    expect(probe("const useStyles = makeStyles((colors) => ({ card: { backgroundColor: colors.surface } }));\nfunction Card() { const styles = useStyles(); const colors = useColors(); return <View style={styles.card}><Icon color={colors.primary} /></View>; }")).toEqual([]);
    expect(probe("function reloadScreen() { return { backgroundColor: currentColors().background }; }")).toEqual([]);
    expect(probe("const label = '第 #1 段'; const style = { backgroundColor: 'transparent' }; const name = 'white';")).toEqual([]);
  });
});
