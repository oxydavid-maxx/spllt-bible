import type { ReadAlongPosition } from './readAlongBridge';

/**
 * Whether the reader follows the narration (光佑 2026-09-29; docs/superpowers/plans/2026-09-29-read-along-follow.md §3.2).
 *
 * - It follows from the start of a narration.
 * - A finger drag on the text, or selecting a verse, lets go while something is being narrated.
 * - Only 回到朗讀處 follows again: not a pause and play (光佑: 不要換地方), not a few idle seconds.
 * - When the narration ends or the chapter changes there is nothing to return to, so the next
 *   narration starts following again.
 */
export interface ReadAlongState {
  following: boolean;
  /** Bumped by 回到朗讀處; the page scrolls to the narrated verse on every change. */
  request: number;
  /** Where the narrated verse is while not following, for the button's arrow. */
  position: ReadAlongPosition | null;
  /** A verse of the displayed chapter is being narrated (playing or paused). */
  narrating: boolean;
}

export type ReadAlongEvent =
  | { type: 'narration'; verse: number | null }
  | { type: 'release' }
  | { type: 'select' }
  | { type: 'position'; position: ReadAlongPosition }
  | { type: 'request' }
  | { type: 'chapter' };

export const initialReadAlong: ReadAlongState = { following: true, request: 0, position: null, narrating: false };

export function readAlong(state: ReadAlongState, event: ReadAlongEvent): ReadAlongState {
  switch (event.type) {
    case 'narration': {
      const narrating = event.verse !== null;
      if (narrating) return state.narrating ? state : { ...state, narrating };
      return state.narrating || !state.following || state.position !== null ? { ...state, narrating, following: true, position: null } : state;
    }
    case 'release':
    case 'select':
      return state.narrating && state.following ? { ...state, following: false } : state;
    case 'position':
      return !state.following && state.position !== event.position ? { ...state, position: event.position } : state;
    case 'request':
      return { ...state, following: true, request: state.request + 1, position: null };
    case 'chapter':
      return state.following && state.position === null ? state : { ...state, following: true, position: null };
  }
}

/** 回到朗讀處 is shown while a narration goes on unfollowed, unless a verse sheet or panel covers the corner. */
export function showReturnToNarration(state: ReadAlongState, covered: boolean): boolean {
  return state.narrating && !state.following && !covered;
}
