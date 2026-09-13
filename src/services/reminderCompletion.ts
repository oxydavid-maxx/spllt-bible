import type { ReminderScheduler } from './reminderScheduler';
import { buildReadingReminderSpecForDate } from './reminderScheduler';
import { getReminderRuntimeOwner } from './reminderRuntime';

interface CompletionReminderStore {
  getItemAsync: (key: string) => Promise<string | null>;
}

export async function syncReadingReminderForCompletion(options: { memberId: string; taskDate: string; status: 'COMPLETED' | 'NOT_COMPLETED' | 'UNREPORTED'; scheduler: ReminderScheduler; store: CompletionReminderStore }): Promise<void> {
  const runtime = getReminderRuntimeOwner();
  if (runtime) {
    await runtime.syncCompletion(options.memberId, options.taskDate);
    return;
  }
  const reminderId = `reading:${options.memberId}:${options.taskDate}`;
  if (options.status === 'COMPLETED') {
    await options.scheduler.cancel(reminderId);
    return;
  }
  const enabled = await options.store.getItemAsync('qingmu.reminder.readingEnabled');
  const readingTime = await options.store.getItemAsync('qingmu.reminder.readingTime');
  if (enabled !== 'true' || !readingTime) return;
  const spec = buildReadingReminderSpecForDate(options.memberId, options.taskDate, readingTime);
  if (spec) await options.scheduler.schedule(spec);
}
