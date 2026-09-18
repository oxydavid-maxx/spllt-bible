import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('node_modules/@youversion/platform-react-native-expo-ui/build/native/bible-reader.js', 'utf8');
const start = source.indexOf('export const PLAYING_VERSE_HIGHLIGHT_COLOR');
const end = source.indexOf('export function BibleReader(');
const helpers = new Function(`${source.slice(start, end).replace(/export /g, '')}\nreturn { mergePlayingVerseHighlight, PLAYING_VERSE_HIGHLIGHT_COLOR };`)() as {
  mergePlayingVerseHighlight: (highlights: Array<{ version_id: number; passage_id: string; color: string }>, scope: { versionId?: number; book?: string; chapter?: string; playingVerse?: number | null }) => Array<{ version_id: number; passage_id: string; color: string }>;
  PLAYING_VERSE_HIGHLIGHT_COLOR: string;
};
const { mergePlayingVerseHighlight, PLAYING_VERSE_HIGHLIGHT_COLOR } = helpers;
const scope = { versionId: 46, book: '1TI', chapter: '5', playingVerse: 2 };

describe('Qingmu SDK playing-verse extension', () => {
  it('appends one transient highlight for the narrated verse in the displayed scope and shadows a user highlight on that verse only', () => {
    const own = [{ version_id: 46, passage_id: '1TI.5.1', color: 'fff3b0' }, { version_id: 46, passage_id: '1TI.5.2', color: 'ffd6a5' }];
    const merged = mergePlayingVerseHighlight(own, scope);
    expect(merged).toEqual([own[0], { version_id: 46, passage_id: '1TI.5.2', color: PLAYING_VERSE_HIGHLIGHT_COLOR }]);
    expect(own).toHaveLength(2);
  });
  it('returns the highlights unchanged when there is no verse or no scope to bind it to', () => {
    const own = [{ version_id: 46, passage_id: '1TI.5.1', color: 'fff3b0' }];
    expect(mergePlayingVerseHighlight(own, { ...scope, playingVerse: null })).toBe(own);
    expect(mergePlayingVerseHighlight(own, { ...scope, playingVerse: 0 })).toBe(own);
    expect(mergePlayingVerseHighlight(own, { ...scope, book: undefined })).toBe(own);
    expect(mergePlayingVerseHighlight([], { ...scope, versionId: undefined })).toEqual([]);
  });
  it('uses a six-hex colour the SDK painter accepts and is wired into the DOM highlights prop', () => {
    expect(PLAYING_VERSE_HIGHLIGHT_COLOR).toMatch(/^[0-9a-f]{6}$/);
    expect(source).toContain('highlights: mergePlayingVerseHighlight(highlights, { versionId, book, chapter, playingVerse })');
    expect(source).toContain('playingVerse = null');
  });
  it('is carried by the tracked patch so a clean install reproduces it', () => {
    const patch = readFileSync('patches/@youversion+platform-react-native-expo-ui+1.5.0.patch', 'utf8');
    expect(patch).toContain('+export function mergePlayingVerseHighlight');
    expect(patch).toContain('+    playingVerse?: number | null;');
  });
});
