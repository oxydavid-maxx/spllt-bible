import { beforeEach, describe, expect, it, vi } from 'vitest';

const openDatabaseSync = vi.hoisted(() => vi.fn());
const createMobileRepository = vi.hoisted(() => vi.fn((database: unknown) => ({ database })));

vi.mock('expo-sqlite', () => ({ openDatabaseSync }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'operation-id') }));
vi.mock('../../src/storage/mobileRepository', () => ({ createMobileRepository }));

import { openQingmuRepository } from '../../src/storage/mobileDatabase';

describe('mobile database ownership', () => {
  beforeEach(() => {
    openDatabaseSync.mockReset();
    createMobileRepository.mockClear();
    openDatabaseSync.mockReturnValue({ handle: 'stable-db' });
  });

  it('reuses one owned database handle and repository across screen re-entry', () => {
    const first = openQingmuRepository();
    const second = openQingmuRepository();

    expect(first).toBe(second);
    expect(openDatabaseSync).toHaveBeenCalledTimes(1);
    expect(createMobileRepository).toHaveBeenCalledTimes(1);
    expect(openDatabaseSync).toHaveBeenCalledWith('qingmu-youth.db', { useNewConnection: true });
  });
});
