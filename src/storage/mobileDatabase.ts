import { openDatabaseSync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { createMobileRepository } from './mobileRepository';
import { createReaderPositionStore } from './readerPosition';

let sharedRepository: ReturnType<typeof createMobileRepository> | null = null;
let sharedDatabase: ReturnType<typeof openDatabaseSync> | null = null;

export function openQingmuRepository() {
  if (sharedRepository === null) {
    sharedDatabase = openDatabaseSync('qingmu-youth.db', { useNewConnection: true });
    sharedRepository = createMobileRepository(sharedDatabase, { generateOperationId: randomUUID });
  }
  return sharedRepository;
}

export function openQingmuReaderPositionStore() {
  if (sharedDatabase === null) openQingmuRepository();
  return createReaderPositionStore(sharedDatabase!);
}
