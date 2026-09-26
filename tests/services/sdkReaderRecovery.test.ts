import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reproduced on a Pixel (2026-09-26): signing in from the journal tab while the reader tab sat in the
// background left 多2 on 「無法連線至聖經伺服器」 with a spinner where the book title goes. The pinned SDK
// never retries a failed read (`retry: false`, no refetch on focus), so only switching chapters
// recovered the text, and the book list behind the title never came back. These tests pin the
// Qingmu extension that recovers instead, and check the tracked patches carry it to a clean install.

const read = (path: string) => readFileSync(path, 'utf8');
const hooksEsm = read('node_modules/@youversion/platform-react-hooks/dist/chunk-UZ2LOWFK.js');
const hooksCjs = read('node_modules/@youversion/platform-react-hooks/dist/index.cjs');
const uiEsm = read('node_modules/@youversion/platform-react-ui/dist/index.js');
const uiCjs = read('node_modules/@youversion/platform-react-ui/dist/index.cjs');
const nativeReader = read('node_modules/@youversion/platform-react-native-expo-ui/build/native/bible-reader.js');
const nativeTypes = read('node_modules/@youversion/platform-react-native-expo-ui/build/native/bible-reader.d.ts');
const domReader = read('node_modules/@youversion/platform-react-native-expo-ui/build/dom/bible-reader.js');
const hooksPatch = read('patches/@youversion+platform-react-hooks+2.12.0.patch');
const uiPatch = read('patches/@youversion+platform-react-ui+2.12.0.patch');
const expoUiPatch = read('patches/@youversion+platform-react-native-expo-ui+1.5.0.patch');

describe('SDK reads retry before they give up', () => {
  it.each([['ESM', hooksEsm], ['CJS', hooksCjs]])('retries a failed read twice with a short backoff (%s)', (_name, source) => {
    expect(source).toMatch(/\n\s*retry: 2,\r?\n\s*retryDelay: \(attempt\) => Math\.min\(1e3 \* 2 \*\* attempt, 4e3\),/);
    expect(source).not.toMatch(/\n\s*retry: false,/);
  });
});

describe('a chapter that failed to load recovers', () => {
  it.each([['ESM', uiEsm], ['CJS', uiCjs]])('offers a Chinese card with a reload button instead of the bare SDK message (%s)', (_name, source) => {
    expect(source).toContain('function QingmuPassageErrorCard({ onRetry })');
    expect(source).toContain('這一章暫時載不下來');
    expect(source).toContain('可能是網路不穩，按一下再試');
    expect(source).toMatch(/type: "button", onClick: onRetry,[^\n]*children: "重新載入"/);
    expect(source).toMatch(/children: passageState\?\.onRetry \? [^\n]*QingmuPassageErrorCard, \{ onRetry: passageState\.onRetry \}\) : [^\n]*VerseUnavailableMessage,/);
  });

  it.each([['ESM', uiEsm], ['CJS', uiCjs]])('retries both the chapter and the book list when the host bumps retrySignal (%s)', (_name, source) => {
    expect(source).toMatch(/clearSelectionSignal,\r?\n\s*retrySignal = 0,\r?\n\s*children\r?\n\}\) \{/);
    expect(source).toMatch(/error: booksError, refetch: refetchBooks \} = /);
    expect(source).toMatch(/error: passageError,\r?\n\s*refetch: refetchPassage\r?\n\s*\} = /);
    expect(source).toMatch(/refetchPassage\?\.\(\);\r?\n\s*if \(booksError\) refetchBooks\?\.\(\);/);
    expect(source).toMatch(/if \(lastRetrySignalRef\.current === retrySignal\) return;\r?\n\s*lastRetrySignalRef\.current = retrySignal;\r?\n\s*if \(passageError \|\| booksError\) qingmuRetryRef\.current\(\);\r?\n\s*\}, \[retrySignal\]\);/);
    expect(source).toContain('onRetry: () => qingmuRetryRef.current()');
  });

  it('carries retrySignal from the native reader through the DOM reader to the SDK root', () => {
    expect(nativeReader).toMatch(/retrySignal = 0, /);
    expect(nativeReader).toContain('clearSelectionSignal: clearSelectionSignal + internalClearCount, retrySignal: retrySignal, ');
    expect(nativeTypes).toContain('retrySignal?: number;');
    expect(domReader).toContain('onVerseSelect, clearSelectionSignal, retrySignal, theme = \'light\',');
    expect(domReader).toContain('clearSelectionSignal: clearSelectionSignal, retrySignal: retrySignal, book: book,');
  });

  it('never shows the SDK heading, so a missing book list cannot leave a spinner in view', () => {
    expect(domReader).toContain('[data-yv-sdk] > main > h1 { display: none !important; }');
    expect(domReader).not.toContain(':has(svg)');
  });
});

describe('the tracked patches reproduce the recovery on a clean install', () => {
  it('records every piece in patches/', () => {
    expect(hooksPatch).toContain('+    retry: 2,');
    expect(hooksPatch).toContain('+    retryDelay: (attempt) => Math.min(1e3 * 2 ** attempt, 4e3),');
    expect(hooksPatch).toContain('-    retry: false,');
    expect(uiPatch).toContain('+function QingmuPassageErrorCard({ onRetry }) {');
    expect(uiPatch).toContain('+  retrySignal = 0,');
    expect(uiPatch).toContain('+    if (passageError || booksError) qingmuRetryRef.current();');
    expect(expoUiPatch).toContain('retrySignal: retrySignal, ');
    expect(expoUiPatch).toContain('+    retrySignal?: number;');
    expect(expoUiPatch).toContain('[data-yv-sdk] > main > h1 { display: none !important; }');
  });
});
