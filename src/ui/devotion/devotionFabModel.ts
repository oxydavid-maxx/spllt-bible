/**
 * The reader's corner buttons (維護者 2026-10-14): gold 靈修, green 完成今日讀經, then ▶. The one the
 * member should press next grows into a labelled pill; the other stays a circle.
 *
 * - Last chapter read to its end, not yet completed: green grows (完成今日讀經).
 * - Reading completed, 靈修 not yet: gold grows into 「跟傳道一起讀 ›」, which opens the 靈修.
 * - On the 靈修 tab: gold is 完成今日靈修; once done, a filled gold tick beside the green one.
 */

export type GoldAction = 'follow' | 'toggle';

export interface GoldFabState {
  expanded: boolean;
  /** Filled gold with a white tick. */
  done: boolean;
  label: string;
  action: GoldAction;
}

export interface DevotionFabInput {
  onDevotion: boolean;
  readingCompleted: boolean;
  devotionCompleted: boolean;
  /** The bottom-left 回到朗讀處 is showing: on a 360 dp phone a pill would run into it. */
  crowded: boolean;
}

export function goldFab(input: DevotionFabInput): GoldFabState {
  if (input.devotionCompleted) return { expanded: false, done: true, label: '今日靈修已完成', action: 'toggle' };
  if (input.onDevotion) return { expanded: false, done: false, label: '完成今日靈修', action: 'toggle' };
  if (input.readingCompleted && !input.crowded) return { expanded: true, done: false, label: '跟傳道一起讀', action: 'follow' };
  return { expanded: false, done: false, label: '跟傳道一起讀', action: 'follow' };
}

/** 「正在朗讀靈修 · 讀完接著播詩歌」 only while the 靈修 is read and its song will follow. */
export function devotionBanner(speaking: boolean, songFollows: boolean): string | null {
  if (!speaking) return null;
  return songFollows ? '正在朗讀靈修 · 讀完接著播詩歌' : '正在朗讀靈修';
}
