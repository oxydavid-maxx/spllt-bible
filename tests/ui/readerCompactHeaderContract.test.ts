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
  it('removes only the duplicate loaded book/chapter heading and keeps metadata fallback visible', () => {
    const style = compactHeaderStyle();
    expect(style).toContain('[data-yv-sdk] > main > h1:not(:has(svg))');
    expect(style).toContain('display: none');
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
