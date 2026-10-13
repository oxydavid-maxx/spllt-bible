import { describe, expect, it } from 'vitest';
import { narrationWindow } from '../../src/services/audioChapterResolver';

// Half-chapter days (maintainer 2026-10-02): narration starts at the range's first verse and stops after
// its last one. Without per-verse timing there is no window, and the whole chapter is read.
const timing = [
  { verse: 1, start: 2.9, end: 9.5 },
  { verse: 2, start: 9.5, end: 14 },
  { verse: 3, start: 14, end: 20 },
  { verse: 4, start: 20.4, end: 26 },
];

describe('narrationWindow', () => {
  it('starts at the first verse and stops at the end of the last one', () => {
    expect(narrationWindow(timing, { first: 2, last: 3 })).toEqual({ start: 9.5, stop: 20 });
  });

  it('starts at the recording\'s start for a range from verse 1, and runs to the end for one that ends the chapter', () => {
    expect(narrationWindow(timing, { first: 1, last: 2 })).toEqual({ start: 0, stop: 14 });
    expect(narrationWindow(timing, { first: 3, last: 4 })).toEqual({ start: 14, stop: null });
    expect(narrationWindow(timing, { first: 3, last: 9 })).toEqual({ start: 14, stop: null });
  });

  it('stops where the next verse starts when the last verse has no row of its own', () => {
    const merged = [{ verse: 1, start: 0, end: 5 }, { verse: 3, start: 5, end: 9 }, { verse: 4, start: 9, end: 12 }];
    expect(narrationWindow(merged, { first: 1, last: 2 })).toEqual({ start: 0, stop: 5 });
  });

  it('has no window without timing, or when the timing does not reach the range', () => {
    expect(narrationWindow(undefined, { first: 2, last: 3 })).toBeNull();
    expect(narrationWindow([], { first: 2, last: 3 })).toBeNull();
    expect(narrationWindow(timing, { first: 7, last: 9 })).toBeNull();
  });
});
