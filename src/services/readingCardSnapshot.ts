import type { ReadingPlan } from '../domain/types';
import type { CompletionRecord } from '../domain/completion';
import type { ReadingCardDay } from '../domain/readingCard';
import { formatReferenceZhTw } from '../domain/scriptureReference';
import type { CachedReadingProgress } from './readingProgressCache';

function correctedRows(references: readonly string[]): string[] {
  const groups: Array<{ book: string; first: number; last: number } | string> = [];
  for (const reference of references) {
    const chapter = /^([A-Z0-9]+)\.(\d+)$/.exec(reference);
    if (!chapter) { groups.push(formatReferenceZhTw(reference)); continue; }
    const previous = groups.at(-1);
    const value = Number(chapter[2]);
    if (previous && typeof previous !== 'string' && previous.book === chapter[1] && previous.last + 1 === value) previous.last = value;
    else groups.push({ book: chapter[1], first: value, last: value });
  }
  return groups.map(group => typeof group === 'string' ? group : `${formatReferenceZhTw(`${group.book}.${group.first}`)}${group.last > group.first ? `-${group.last}` : ''}`);
}

/** Same precedence as ReadingPlanSheet: unsynced edits and newer local revisions win. */
export function readingCardDays(plan: ReadingPlan, cached: CachedReadingProgress, getLocal: (planId: string, date: string) => CompletionRecord | undefined): ReadingCardDay[] {
  return plan.days.flatMap(day => {
    const planId = day.planId ?? plan.planId;
    const candidate = cached.days[day.date];
    if (!candidate && cached.ranges?.some(range => day.date >= range.from && day.date <= range.to)) return [];
    const remote = candidate?.planId === planId ? candidate : undefined;
    const local = getLocal(planId, day.date);
    const useLocal = local && (!remote || local.syncStatus !== 'CONFIRMED' || local.revision > remote.revision);
    // Normally the source rows are exact. A downloaded correction uses its actual references;
    // grouping adjacent chapters preserves a single row for ranges such as 詩107–108.
    const rows = !remote || JSON.stringify(remote.references) === JSON.stringify(day.references)
      ? day.sourceRows
      : correctedRows(remote.references);
    return { date: day.date, rows, completed: (useLocal ? local.status : remote?.status ?? local?.status) === 'COMPLETED', devoted: cached.devotionDates.includes(day.date) };
  });
}

/** Reads only this phone's account data. Export never calls a network client. */
export async function loadReadingCardSnapshot(memberId: string, plan: ReadingPlan): Promise<ReadingCardDay[]> {
  const [{ readingProgressCache }, { openQingmuRepository }] = await Promise.all([import('./readingProgressCache'), import('../storage/mobileDatabase')]);
  const cached = await readingProgressCache.read(memberId);
  const repository = openQingmuRepository();
  return readingCardDays(plan, cached, (planId, taskDate) => repository.get({ memberId, planId, taskDate }));
}
