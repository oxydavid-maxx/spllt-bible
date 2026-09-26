import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const domReader = readFileSync(join(process.cwd(), 'node_modules/@youversion/platform-react-native-expo-ui/build/dom/bible-reader.js'), 'utf8');
const sdkReader = readFileSync(join(process.cwd(), 'node_modules/@youversion/platform-react-ui/dist/index.js'), 'utf8');

function compactHeaderStyle() {
  const at = domReader.indexOf('href: "qingmu-reader-compact-header"');
  if (at < 0) return '';
  const startMarker = 'children: `';
  const start = domReader.indexOf(startMarker, at);
  if (start < 0) return '';
  const contentStart = start + startMarker.length;
  const end = domReader.indexOf('` }),', contentStart);
  return end < 0 ? '' : domReader.slice(contentStart, end);
}

describe('compact Reader SDK header contract', () => {
  // The chips above the reader already name the chapter, so the SDK heading is always hidden. It used
  // to stay visible while it held the book-title spinner, which on a failed book list meant a spinner
  // that never went away (seen on a Pixel, 2026-09-26). Loading and errors show in the passage area.
  it('hides the duplicate book/chapter heading in every state, including a book title that never loads', () => {
    const style = compactHeaderStyle();
    expect(style).toContain('[data-yv-sdk] > main > h1 { display: none !important; }');
    expect(style).not.toContain(':has(svg)');
    expect(style).toContain('padding-top: 16px');
    expect(style).not.toContain('.yv-v');
    expect(sdkReader).toMatch(/bookData\?\.title\s*\|\|[\s\S]{0,160}LoaderIcon/);
  });

  it('keeps the real passage loading status and body renderer wired', () => {
    expect(sdkReader).toContain('loadingPassageAriaLabel');
    expect(sdkReader).toContain('showLoadingOverlay');
    expect(sdkReader).toContain('BibleTextView');
  });
});
