import { applyCompletion, type CompletionCommand, type CompletionRecord } from '../domain/completion';
import { Outbox } from './outbox';

function key(record: Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>): string {
  return `${record.memberId}:${record.planId}:${record.taskDate}`;
}

export class LocalRepository {
  private readonly records = new Map<string, CompletionRecord>();

  constructor(private readonly outbox: Outbox) {}

  saveCompletion(command: CompletionCommand): CompletionRecord {
    const current =
      this.records.get(key(command)) ?? {
        memberId: command.memberId,
        planId: command.planId,
        taskDate: command.taskDate,
        status: 'UNREPORTED' as const,
        revision: 0,
        syncStatus: 'CONFIRMED' as const,
      };
    const transition = applyCompletion(command, current);
    const record = {
      ...transition.record,
      syncStatus: 'PENDING_SAVE' as const,
    };
    this.records.set(key(record), record);
    this.outbox.enqueue({ ...command, syncStatus: 'PENDING_SAVE' });
    return record;
  }

  get(recordKey: Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>): CompletionRecord | undefined {
    return this.records.get(key(recordKey));
  }

  confirm(record: CompletionRecord): void {
    this.records.set(key(record), { ...record, syncStatus: 'CONFIRMED' });
  }
}
