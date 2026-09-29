import { describe, expect, it } from 'vitest';
import { initialReadAlong, readAlong, showReturnToNarration, type ReadAlongEvent, type ReadAlongState } from '../../src/ui/readAlongFollow';

// 光佑 2026-09-29: follow the narration; a finger drag lets go; only 回到朗讀處 follows again, not a
// pause and play, not idle seconds. docs/superpowers/plans/2026-09-29-read-along-follow.md §3.2.
const run = (...events: ReadAlongEvent[]): ReadAlongState => events.reduce(readAlong, initialReadAlong);
const playing = (verse: number): ReadAlongEvent => ({ type: 'narration', verse });
const stopped: ReadAlongEvent = { type: 'narration', verse: null };

describe('following the narration', () => {
  it('follows from the start and keeps following as the verses go by', () => {
    const state = run(playing(1), playing(2), playing(3));
    expect(state).toMatchObject({ following: true, narrating: true });
    expect(showReturnToNarration(state, false)).toBe(false);
  });

  it('lets go on a finger drag and shows 回到朗讀處 with the arrow the page reports', () => {
    const state = run(playing(4), { type: 'release' }, { type: 'position', position: 'below' });
    expect(state).toMatchObject({ following: false, position: 'below' });
    expect(showReturnToNarration(state, false)).toBe(true);
  });

  it('lets go when a verse is selected', () => {
    expect(run(playing(4), { type: 'select' }).following).toBe(false);
  });

  it('does not follow again on pause and play, or as the narration goes on', () => {
    // A pause keeps the narrated verse; play continues from it. Neither is an event that follows.
    const state = run(playing(4), { type: 'release' }, playing(5), playing(5), playing(6));
    expect(state.following).toBe(false);
    expect(showReturnToNarration(state, false)).toBe(true);
  });

  it('follows again on 回到朗讀處, which also asks the page to scroll now', () => {
    const released = run(playing(4), { type: 'release' }, { type: 'position', position: 'above' });
    const back = readAlong(released, { type: 'request' });
    expect(back).toMatchObject({ following: true, position: null, request: released.request + 1 });
    expect(showReturnToNarration(back, false)).toBe(false);
  });

  it('ignores a drag or a selection while nothing is narrated, so the next narration still follows', () => {
    const state = run({ type: 'release' }, { type: 'select' }, playing(1));
    expect(state.following).toBe(true);
  });

  it('hides the button and follows the next narration once the narration ends', () => {
    const state = run(playing(4), { type: 'release' }, stopped);
    expect(state).toMatchObject({ following: true, narrating: false, position: null });
    expect(showReturnToNarration(state, false)).toBe(false);
  });

  it('starts a new chapter following', () => {
    expect(run(playing(4), { type: 'release' }, { type: 'chapter' }).following).toBe(true);
  });

  it('keeps the button hidden while a verse sheet or panel covers its corner', () => {
    expect(showReturnToNarration(run(playing(4), { type: 'release' }), true)).toBe(false);
  });

  it('ignores the page\'s position reports while following, and repeats change nothing', () => {
    const following = run(playing(4));
    expect(readAlong(following, { type: 'position', position: 'below' })).toBe(following);
    const free = run(playing(4), { type: 'release' }, { type: 'position', position: 'below' });
    expect(readAlong(free, { type: 'position', position: 'below' })).toBe(free);
    expect(readAlong(free, playing(5))).toBe(free);
  });
});
