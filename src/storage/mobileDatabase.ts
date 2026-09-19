import { openDatabaseSync } from 'expo-sqlite';
import { createMobileRepository } from './mobileRepository';
import { createJournalStore } from './journalStore';
import { createReaderPositionStore } from './readerPosition';

let sharedRepository: ReturnType<typeof createMobileRepository> | null = null;
let sharedDatabase: ReturnType<typeof openDatabaseSync> | null = null;

export function openQingmuRepository() {
  if (sharedRepository === null) {
    sharedDatabase = openDatabaseSync('qingmu-youth.db', { useNewConnection: true });
    sharedRepository = createMobileRepository(sharedDatabase);
  }
  return sharedRepository;
}

export function openQingmuReaderPositionStore() {
  if (sharedDatabase === null) openQingmuRepository();
  return createReaderPositionStore(sharedDatabase!);
}

/**
 * Shares the one connection above rather than opening its own.
 *
 * `openDatabaseSync` must appear exactly once in this file. A second writer on qingmu-youth.db
 * would make `saveCompletion`'s BEGIN IMMEDIATE intermittently fail against SQLITE_BUSY, which
 * means the feature that earns points could start failing because of the feature that earns none —
 * and it would only reproduce on a device, while someone types a journal and taps complete.
 */
export function openQingmuJournalStore() {
  if (sharedDatabase === null) openQingmuRepository();
  return createJournalStore(sharedDatabase!);
}
