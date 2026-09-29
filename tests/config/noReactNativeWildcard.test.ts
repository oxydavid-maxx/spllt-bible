import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Expo's Metro turns `import * as X from 'react-native'` into metroImportAll, which copies every react-native
// export and so runs every lazy getter. One of them loads PushNotificationIOS, whose module-scope
// NativeEventEmitter gets no native module on iOS; React Native throws for that on iOS only, and the release
// app died at launch (2026-09-29 CI crash: "`new NativeEventEmitter()` requires a non-null argument").
const WILDCARD = /import\s+\*\s+as\s+\w+\s+from\s+['"]react-native['"]/;
// A dynamic import() compiles to asyncRequire + metroImportAll too: the actual crash came from
// authSession's `import('react-native')` in an effect (stack: get PushNotificationIOS <- metroImportAll <- asyncRequire).
const DYNAMIC = /import\(\s*['"]react-native['"]\s*\)/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

describe('no wildcard import of react-native in the app bundle', () => {
  it('app code imports react-native by name', () => {
    const offenders = [...sources('src'), ...sources('app')].filter((path) => { const text = readFileSync(path, 'utf8'); return WILDCARD.test(text) || DYNAMIC.test(text); });
    expect(offenders).toEqual([]);
  });
  it('the installed YouVersion reader provider does too (patches/@youversion+platform-react-native-expo-ui)', () => {
    const provider = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/native/youversion-provider.js', 'utf8');
    expect(WILDCARD.test(provider)).toBe(false);
  });
});
