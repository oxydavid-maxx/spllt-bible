import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { transformBibleHtml } from '@youversion/platform-core';

/**
 * Owner-reported bug (Psalm 98, 和合本, real Pixel, APK 0.5.9 @ 3307415 / ec3b875): while verse 1
 * played, verse 1's three lines highlighted correctly, but a thin grey sliver still painted the
 * left edge of the line that starts verse 2 - a highlighted empty/whitespace piece of the playing
 * verse at the start of the next verse's line.
 *
 * The first fix attempt used a hand-written synthetic fixture that did not reproduce the real
 * passage structure and missed this exact case. This suite instead uses the REAL Psalm 98 (和合本,
 * versionId 46, the app's default translation) and 2 Timothy 3 (prose control) HTML exactly as the
 * app's own backend (`server/officialBibleAdapter.ts`) serves it to the SDK's WebView reader over
 * the `apiHost` override - fetched once through that same adapter/upstream path and saved as
 * `tests/services/fixtures/real-psa98.json` / `real-2ti3.json` (plain public-domain scripture text,
 * no secrets). The real markup's actual shape: every poetry (q1) line that continues or starts a
 * verse re-declares its own bare `<span class="yv-v" v="N"></span>` marker, and a verse boundary
 * that falls mid-line looks like:
 *   <span class="yv-v" v="1"></span><span class="content">  </span><span class="yv-v" v="2">...
 * i.e. a whitespace-only `content` SPAN (not a bare text node) sitting between the two markers -
 * the "empty piece" that must never end up inside a painted `.yv-v[v]` wrapper.
 *
 * `transformBibleHtml` (`@youversion/platform-core`, same SDK function whose bundled copy in
 * `@youversion/platform-react-ui` the WebView actually runs) builds the `.yv-v[v]` wrappers that
 * the SDK's highlight effect (`BibleTextHtml`) paints with `background-color`. For every verse of
 * both real passages, no painted wrapper may hold only whitespace.
 */
const adapters = {
  parseHtml: (html: string) => parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document,
  serializeHtml: (doc: Document) => (doc as unknown as { body: { innerHTML: string } }).body.innerHTML,
};

function transformFixture(path: string) {
  const { content } = JSON.parse(readFileSync(path, 'utf8')) as { content: string };
  const { html } = transformBibleHtml(content, adapters);
  return parseHTML(`<html><body>${html}</body></html>`).document;
}

function isBlank(text: string | null) {
  return (text ?? '').replace(/[\s ]/g, '').length === 0;
}

describe('reader highlight does not paint blank verse whitespace (real Psalm 98 + 2 Timothy 3 HTML)', () => {
  it('produces no empty/whitespace-only painted piece for any verse of the real Psalm 98 poetry passage', () => {
    const doc = transformFixture('tests/services/fixtures/real-psa98.json');
    const wrappers = Array.from(doc.querySelectorAll('.yv-v[v]')) as unknown as Array<{ textContent: string | null; getAttribute(name: string): string | null }>;
    expect(wrappers.length).toBeGreaterThan(0);
    const blank = wrappers.filter((el) => isBlank(el.textContent));
    expect(blank.map((el) => ({ verse: el.getAttribute('v'), text: el.textContent }))).toEqual([]);
  });

  it('reproduces the exact reported boundary: verse 1 highlights exactly its three real lines, never the line-4 whitespace before verse 2', () => {
    const doc = transformFixture('tests/services/fixtures/real-psa98.json');
    const verse1 = Array.from(doc.querySelectorAll('.yv-v[v="1"]')) as unknown as Array<{ textContent: string | null }>;
    expect(verse1.map((el) => el.textContent)).toEqual([
      '1 你們要向耶和華唱新歌！',
      '因為他行過奇妙的事；',
      '他的右手和聖臂施行救恩。',
    ]);
    const verse2First = (Array.from(doc.querySelectorAll('.yv-v[v="2"]'))[0] as unknown as { textContent: string | null }).textContent ?? '';
    expect(verse2First).not.toMatch(/^[\s ]/);
    expect(verse2First).toContain('耶和華發明了他的救恩，');
  });

  it('produces no empty/whitespace-only painted piece for any verse of the real 2 Timothy 3 prose passage', () => {
    const doc = transformFixture('tests/services/fixtures/real-2ti3.json');
    const wrappers = Array.from(doc.querySelectorAll('.yv-v[v]')) as unknown as Array<{ textContent: string | null; getAttribute(name: string): string | null }>;
    expect(wrappers.length).toBeGreaterThan(0);
    const blank = wrappers.filter((el) => isBlank(el.textContent));
    expect(blank.map((el) => ({ verse: el.getAttribute('v'), text: el.textContent }))).toEqual([]);
  });

  it('overrides the WebView reader highlight padding without changing vendor CSS bundles', () => {
    // The real Psalm 98 browser/Pixel replay paints an empty bar at verse 2 from
    // the vendor stylesheet's cloned 2px padding even when every wrapper has text.
    const domReader = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/dom/bible-reader.js', 'utf8');
    expect(domReader.includes('href: "qingmu-verse-highlight-padding"')).toBe(true);
    const override = domReader.match(/\.yv-v\s*\{[^}]*padding-inline:[^}]*\}/)?.[0] ?? '';
    expect(override).toMatch(/padding-inline:\s*0\s*!important/);
  });

  it('is carried by tracked patches so a clean install reproduces it', () => {
    const uiPatch = readFileSync('patches/@youversion+platform-react-ui+2.12.0.patch', 'utf8');
    expect(uiPatch).toContain('+function trimVerseWrapEdges(nodes)');
    const corePatch = readFileSync('patches/@youversion+platform-core+2.9.0.patch', 'utf8');
    expect(corePatch).toContain('+function trimVerseWrapEdges(nodes)');
  });
});
