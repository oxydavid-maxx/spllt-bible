import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import * as webSdk from '@youversion/platform-react-ui';
import * as zod from 'zod';
import * as zustand from 'zustand';
import * as middleware from 'zustand/middleware';
const packageRoot = process.env.QINGMU_SDK_EXTENSION_ROOT || resolve('node_modules/@youversion/platform-react-native-expo-ui');

// All preference logic, clamps, normalization, Zustand and persistence are real.
// Only native MMKV is replaced with memory. Native UI registration is inert here
// because these tests execute the exported state API, not React Native rendering.
export function loadReaderSettingsSdk() {
  const memory = new Map<string, string>();
  let writes = 0;
  const mmkvStorage = {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string) => { writes++; memory.set(key, value); },
    remove: (key: string) => memory.delete(key),
  };
  const cache = new Map<string, any>();
  const build = resolve(packageRoot, 'build');
  function evaluate(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireSdk = (name: string): unknown => {
      if (name === '@youversion/platform-react-ui') return webSdk;
      if (name === '@youversion/platform-react-native-expo-core') return { mmkvStorage };
      if (name === 'zustand') return zustand;
      if (name === 'zustand/middleware') return middleware;
      if (name === 'zod') return zod;
      if (file === resolve(build, 'index.js') && name === './native/register-dom-impls') return { ensureDomImpls() {} };
      if (file === resolve(build, 'index.js') && ['./native', './hooks', './theme', './native/bible-reader'].includes(name)) return {};
      if (name.startsWith('.')) return evaluate(resolve(dirname(file), name.endsWith('.js') ? name : `${name}.js`));
      throw new Error(`Unexpected SDK dependency: ${name}`);
    };
    new Function('require', 'exports', compiled)(requireSdk, exports);
    return exports;
  }
  const actualStore = evaluate(resolve(build, 'stores/reader-settings-store.js')).useReaderSettingsStore;
  return { api: evaluate(resolve(build, 'index.js')), actualStore, fonts: evaluate(resolve(build, 'lib/reader-fonts.js')), spacing: evaluate(resolve(build, 'stores/types/reader-line-spacing.js')).READER_LINE_SPACING, writes: () => writes };
}
