import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read-along (2026-09-29): the narrated verse no longer rides the SDK's highlights channel, which
// paints by parseInt of the verse attribute and so never lit 6 inside the unit "5-6". The native
// reader hands the narration state to the DOM reader, which writes it onto the document for the
// app's injected script (src/ui/readAlongBridge.ts). docs/superpowers/plans/2026-09-29-read-along-follow.md.
const pkg = 'node_modules/@youversion/platform-react-native-expo-ui/build';
const native = readFileSync(`${pkg}/native/bible-reader.js`, 'utf8');
const dom = readFileSync(`${pkg}/dom/bible-reader.js`, 'utf8');
const types = readFileSync(`${pkg}/native/bible-reader.d.ts`, 'utf8');
const index = readFileSync(`${pkg}/index.js`, 'utf8');

// The DOM reader's effect body, run against a stand-in document to see what it writes.
function domEffect(props: Record<string, unknown>): Record<string, string> {
  const start = dom.indexOf('useEffect(() => {\n        const root = document.documentElement;');
  const end = dom.indexOf('}, [qingmuPlayingVerse, qingmuFollow, qingmuFollowRequest, qingmuReduceMotion]);');
  expect(start, 'the DOM reader writes the narration state in one effect').toBeGreaterThan(0);
  const body = dom.slice(dom.indexOf('{', start) + 1, end);
  const written: Record<string, string> = {};
  const document = { documentElement: {
    setAttribute: (name: string, value: string) => { written[name] = value; },
    removeAttribute: (name: string) => { delete written[name]; },
  } };
  new Function('document', 'qingmuPlayingVerse', 'qingmuFollow', 'qingmuFollowRequest', 'qingmuReduceMotion', body)(
    document, props.qingmuPlayingVerse ?? null, props.qingmuFollow ?? false, props.qingmuFollowRequest ?? 0, props.qingmuReduceMotion ?? false);
  return written;
}

describe('Qingmu SDK read-along extension', () => {
  it('passes the member\'s highlights through untouched and the narration state as its own DOM props', () => {
    expect(native).toContain('highlights: highlights, qingmuPlayingVerse: Number.isInteger(playingVerse) && playingVerse > 0 ? playingVerse : null, ');
    expect(native).toContain('qingmuFollow: followNarration === true, qingmuFollowRequest: Number.isFinite(followRequest) ? followRequest : 0, qingmuReduceMotion: reduceMotion === true');
    expect(native).toContain('playingVerse = null, followNarration = false, followRequest = 0, reduceMotion = false, ');
    expect(native).not.toContain('mergePlayingVerseHighlight');
    expect(index).not.toContain('mergePlayingVerseHighlight');
    expect(types).toContain('followNarration?: boolean;');
    expect(types).toContain('followRequest?: number;');
    expect(types).toContain('reduceMotion?: boolean;');
  });

  it('writes the narration state onto the reader document', () => {
    expect(domEffect({ qingmuPlayingVerse: 6, qingmuFollow: true, qingmuFollowRequest: 3, qingmuReduceMotion: true })).toEqual({
      'data-qingmu-playing-verse': '6', 'data-qingmu-follow': '1', 'data-qingmu-follow-request': '3', 'data-qingmu-reduce-motion': '1',
    });
    expect(domEffect({ qingmuPlayingVerse: null })).toEqual({ 'data-qingmu-follow': '0', 'data-qingmu-follow-request': '0', 'data-qingmu-reduce-motion': '0' });
    expect(domEffect({ qingmuPlayingVerse: 0 })['data-qingmu-playing-verse']).toBeUndefined();
  });

  it('is carried by the tracked patch so a clean install reproduces it', () => {
    const patch = readFileSync('patches/@youversion+platform-react-native-expo-ui+1.5.0.patch', 'utf8');
    expect(patch).toContain('+    followNarration?: boolean;');
    expect(patch).toContain("+        set('follow-request', Number.isFinite(qingmuFollowRequest) ? qingmuFollowRequest : 0);");
    expect(patch).not.toContain('+export function mergePlayingVerseHighlight');
    // M0 (iOS): the provider keeps its named react-native import; a wildcard crashes the iOS release app.
    expect(patch).toContain("+import { useColorScheme } from 'react-native';");
  });
});
