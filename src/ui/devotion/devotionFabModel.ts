/** Completion circles toggle; only a bounded untouched end-of-reading offer opts in. */
export interface DevotionFabInput {
  onDevotion: boolean;
  readingCompleted: boolean;
  devotionCompleted: boolean;
  crowded: boolean;
  atReadingEnd?: boolean;
  atDevotionEnd?: boolean;
  followOfferEligible?: boolean;
}
export function devotionFab(input: DevotionFabInput) {
  if (input.devotionCompleted) return { expanded: false, done: true, label: '今日靈修已完成', action: 'toggle' as const };
  if (input.onDevotion) return { expanded: Boolean(input.atDevotionEnd) && !input.crowded, done: false, label: '完成今日靈修', action: 'toggle' as const };
  if (input.readingCompleted && input.atReadingEnd && input.followOfferEligible && !input.crowded) return { expanded: true, done: false, label: '接續靈修', action: 'follow' as const };
  return { expanded: false, done: false, label: '完成今日靈修', action: 'toggle' as const };
}
export function devotionBanner(speaking: boolean, songFollows: boolean): string | null {
  if (!speaking) return null;
  return songFollows ? '正在朗讀靈修 · 讀完接著播詩歌' : '正在朗讀靈修';
}
