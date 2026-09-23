import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { transformBibleHtml } from '@youversion/platform-core';

/**
 * Owner-reported bug (Psalm 98, 和合本, real Pixel): the playing-verse / user-highlight grey
 * background painted the blank indent before a poetry line's text, and left a small empty grey
 * sliver with no text on another poetry line. The SDK paints one CSS background-color directly on
 * each `.yv-v[v]` wrapper element (see BibleTextHtml's highlight effect); this suite proves the DOM
 * that `transformBibleHtml` builds for a Psalm 98:4-5-shaped poetry passage no longer produces a
 * `.yv-v[v]` wrapper that is empty/whitespace-only, and no wrapper that begins or ends with
 * whitespace instead of the verse's actual glyphs - on both a prose line and indented q1/q2 lines.
 */
const adapters = {
  parseHtml: (html: string) => parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document,
  serializeHtml: (doc: Document) => (doc as unknown as { body: { innerHTML: string } }).body.innerHTML,
};

// Shaped like the app's own official-bible-adapter output (server/officialBibleAdapter.ts):
// bare `<span class="yv-v" v="N"></span>` markers, `.p`/`.q1`/`.q2` USFM paragraph classes.
// Verse 5's marker sits alone at the end of a q1 line (an "empty piece" between markers - no
// sibling content at all), and its real text continues on a separate q2 line whose HTML begins
// with literal indent whitespace (`&#160;&#160;`) before the first visible word.
const psalm98Poetry = ''
  + '<p class="p"><span class="yv-v" v="4"></span>Make a joyful noise to the LORD, all the earth;</p>'
  + '<p class="q1">break forth into joyous song and sing praises!<span class="yv-v" v="5"></span></p>'
  + '<p class="q2">&#160;&#160;with the lyre and the sound of melody!</p>';

function renderedVerseWrappers(html: string, verse: string) {
  const { html: transformed } = transformBibleHtml(html, adapters);
  const doc = parseHTML(`<html><body>${transformed}</body></html>`).document;
  return Array.from(doc.querySelectorAll(`.yv-v[v="${verse}"]`)) as unknown as Array<{ textContent: string | null }>;
}

describe('reader highlight does not paint blank verse whitespace (Psalm 98 poetry shape)', () => {
  it('never produces an empty or whitespace-only highlighted piece for the poetry verse', () => {
    const wrappers = renderedVerseWrappers(psalm98Poetry, '5');
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) {
      expect((wrapper.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('never paints leading indent whitespace before the poetry verse\'s first glyph', () => {
    const wrappers = renderedVerseWrappers(psalm98Poetry, '5');
    for (const wrapper of wrappers) {
      const text = wrapper.textContent ?? '';
      expect(text).not.toMatch(/^[\s ]/);
    }
    expect(wrappers.map((w) => w.textContent).join('')).toContain('with the lyre and the sound of melody!');
  });

  it('still highlights the ordinary prose verse exactly as before (no regression on plain text)', () => {
    const wrappers = renderedVerseWrappers(psalm98Poetry, '4');
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].textContent).toBe('Make a joyful noise to the LORD, all the earth;');
  });

  it('is carried by tracked patches so a clean install reproduces it', () => {
    const uiPatch = readFileSync('patches/@youversion+platform-react-ui+2.12.0.patch', 'utf8');
    expect(uiPatch).toContain('+function trimVerseWrapEdges(nodes)');
    const corePatch = readFileSync('patches/@youversion+platform-core+2.9.0.patch', 'utf8');
    expect(corePatch).toContain('+function trimVerseWrapEdges(nodes)');
  });
});
