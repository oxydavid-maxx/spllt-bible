import { describe, expect, it } from 'vitest';
import { buildMirrorFile, decideMirrorWrite, isOurFile, mirrorFileName } from '../../src/domain/journalMirror';

describe('a mirrored journal file never destroys something it did not write', () => {
  it('is named the way a daily note is named, so the vault recognises it', () => {
    expect(mirrorFileName('2026-09-19')).toBe('2026-09-19.md');
  });

  it('carries front matter identifying itself, then the writing untouched', () => {
    const file = buildMirrorFile('2026-09-19', '今天讀到安靜\n\n「神賜給我們的不是膽怯的心」提後 1:7');
    expect(file.contents).toBe('---\nsource: qingmu-journal\ndate: 2026-09-19\n---\n\n今天讀到安靜\n\n「神賜給我們的不是膽怯的心」提後 1:7\n');
  });

  it('writes a new file when nothing is there', () => {
    expect(decideMirrorWrite(null)).toEqual({ action: 'create' });
  });

  it('replaces a file it wrote on an earlier pass', () => {
    const earlier = buildMirrorFile('2026-09-19', '舊的內容').contents;
    expect(isOurFile(earlier)).toBe(true);
    expect(decideMirrorWrite(earlier)).toEqual({ action: 'replace' });
  });

  // The failure this exists to prevent: someone points the mirror at the folder their daily notes
  // already live in, which is the obvious folder to choose, and 2026-09-19.md is exactly the name
  // one of those notes already has.
  it('refuses to touch a daily note somebody else wrote', () => {
    const theirs = '# 2026-09-19\n\n今天開會、買菜、跑步。';
    expect(isOurFile(theirs)).toBe(false);
    expect(decideMirrorWrite(theirs)).toEqual({ action: 'skip', reason: 'FOREIGN_FILE' });
  });

  it('refuses a file whose front matter is somebody else’s', () => {
    const theirs = '---\ntags: [daily]\ndate: 2026-09-19\n---\n\n別的系統寫的。';
    expect(decideMirrorWrite(theirs)).toEqual({ action: 'skip', reason: 'FOREIGN_FILE' });
  });

  it('is not fooled by the marker appearing further down somebody else’s note', () => {
    const theirs = '# 我的筆記\n\n我在研究 source: qingmu-journal 這個格式。';
    expect(decideMirrorWrite(theirs)).toEqual({ action: 'skip', reason: 'FOREIGN_FILE' });
  });
});
