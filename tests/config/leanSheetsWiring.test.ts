import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/design/lean-reader-sheets.md: the YouVersion SDK's sheets get the app's own bottom sheet, and
// react-native-reanimated / react-native-worklets are neither bundled nor linked (on RN 0.85 they cost
// ~155 MB of native memory and an idle UI-thread frame loop).
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../..');
const { withLeanReaderSheets } = require('../../metro.leanSheets.js') as { withLeanReaderSheets(config: any, projectRoot: string): any };

function resolverWith(fallback = (_context: unknown, moduleName: string) => ({ type: 'sourceFile', filePath: `/default/${moduleName}` })) {
  const config = withLeanReaderSheets({ resolver: { resolveRequest: fallback } }, root);
  return (moduleName: string) => config.resolver.resolveRequest({}, moduleName, 'android');
}

describe('lean reader sheets wiring', () => {
  it("serves the app's own sheet for @gorhom/bottom-sheet", () => {
    expect(resolverWith()('@gorhom/bottom-sheet')).toEqual({ type: 'sourceFile', filePath: path.join(root, 'src/ui/sheet/bottomSheet.tsx') });
  });

  it.each(['react-native-reanimated', 'react-native-reanimated/src/index', 'react-native-worklets', 'react-native-worklets/src/threads'])(
    'resolves %s to a module that behaves as not installed', (moduleName) => {
      const resolved = resolverWith()(moduleName);
      expect(resolved.type).toBe('sourceFile');
      expect(() => require(resolved.filePath)).toThrow(/not bundled/);
    },
  );

  it('leaves every other module to the default resolver, including look-alike names', () => {
    const resolve = resolverWith();
    for (const moduleName of ['react-native', 'react-native-gesture-handler', 'react-native-reanimated-carousel', '@gorhom/portal']) {
      expect(resolve(moduleName)).toEqual({ type: 'sourceFile', filePath: `/default/${moduleName}` });
    }
  });

  it('falls back to the context resolver when Expo set none', () => {
    const config = withLeanReaderSheets({ resolver: {} }, root);
    const context = { resolveRequest: (_: unknown, moduleName: string) => ({ type: 'sourceFile', filePath: `/context/${moduleName}` }) };
    expect(config.resolver.resolveRequest(context, 'react-native', 'android')).toEqual({ type: 'sourceFile', filePath: '/context/react-native' });
  });

  it('metro.config.js applies it', () => {
    expect(readFileSync(path.join(root, 'metro.config.js'), 'utf8')).toMatch(/withLeanReaderSheets\(getDefaultConfig\(__dirname\), __dirname\)/);
  });

  it('never links reanimated or worklets natively', () => {
    const rnConfig = require('../../react-native.config.js') as { dependencies: Record<string, { platforms: Record<string, unknown> }> };
    for (const name of ['react-native-reanimated', 'react-native-worklets']) {
      expect(rnConfig.dependencies[name].platforms).toEqual({ android: null, ios: null });
    }
  });

});
