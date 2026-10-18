/** The leaf circle toggles the day's 靈修 mark; at the 靈修's own bottom it grows into the completion call. */
export interface DevotionFabInput {
  onDevotion: boolean;
  devotionCompleted: boolean;
  crowded: boolean;
  atDevotionEnd?: boolean;
}
// 2026-10-17 (維護者): the chapter end no longer grows the leaf into a 接續靈修 offer; 接著讀靈修 › points there.
export function devotionFab(input: DevotionFabInput) {
  if (input.devotionCompleted) return { expanded: false, done: true, label: '今日靈修已完成', action: 'toggle' as const };
  if (input.onDevotion) return { expanded: Boolean(input.atDevotionEnd) && !input.crowded, done: false, label: '完成今日靈修', action: 'toggle' as const };
  return { expanded: false, done: false, label: '完成今日靈修', action: 'toggle' as const };
}
export function devotionBanner(speaking: boolean, songFollows: boolean): string | null {
  if (!speaking) return null;
  return songFollows ? '正在朗讀靈修 · 讀完接著播詩歌' : '正在朗讀靈修';
}
