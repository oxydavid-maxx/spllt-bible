import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export function readerChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  for (const name of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const platform of ['win64', 'linux64', 'mac-arm64']) {
      const path = join(root, name, `chrome-headless-shell-${platform}`, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
      if (existsSync(path)) return path;
    }
  }
  throw new Error('chrome-headless-shell is required (set CHROME_PATH)');
}

/** Exact transform bundled in the installed WebView renderer, run by Chromium's DOMParser.
 * The separately published platform-core transform is not the WebView executable. */
export function sdkTransformScript(): string {
  const source = readFileSync('node_modules/@youversion/platform-react-ui/dist/index.js', 'utf8');
  const ast = ts.createSourceFile('sdk.js', source, ts.ScriptTarget.Latest, true);
  const first = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'NON_BREAKING_SPACE'));
  const last = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'transformBibleHtmlForBrowser');
  if (!first || !last) throw new Error('Installed WebView SDK transform not found');
  return source.slice(first.getStart(ast), last.end) + '\nwindow.transformRecordedPassage = html => transformBibleHtmlForBrowser(html).html;';
}

export function readerSdkStyles() {
  const source = ts.createSourceFile('sdk.js', readFileSync('node_modules/@youversion/platform-react-ui/dist/index.js', 'utf8'), ts.ScriptTarget.Latest, true);
  let css = '', mainClass = '';
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node)) {
      if (node.text.startsWith('/*! tailwindcss')) css = node.text;
      if (node.text.startsWith('yv:*:max-w-lg yv:flex') && node.text.includes('yv:py-12')) mainClass = node.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!css || !mainClass) throw new Error('Installed reader CSS/container not found');
  return { css: css.replace(/@import\s+(?:"[^"]*"|'[^']*')[^;]*;/g, ''), mainClass };
}
