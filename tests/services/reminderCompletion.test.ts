import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({}));
vi.mock('expo-modules-core', () => ({ EventEmitter: class {}, NativeModulesProxy: {}, requireNativeModule: vi.fn(), requireOptionalNativeModule: vi.fn(), Platform: { OS: 'test' } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));

import { syncReadingReminderForCompletion } from '../../src/services/reminderCompletion';

describe('completion/reminder producer binding', () => {
  it('cancels on completion and recreates the stable member/date reminder on undo', async () => {
    const calls: string[] = [];
    const scheduler = { cancel: async (id: string) => { calls.push(`cancel:${id}`); }, schedule: async (spec: { reminderId: string }) => { calls.push(`schedule:${spec.reminderId}`); }, list: async () => [], requestPermission: async () => 'granted' as const, cancelForMember: async () => undefined };
    const store = { getItemAsync: async (key: string) => key.endsWith('readingEnabled') ? 'true' : '08:00' };
    await syncReadingReminderForCompletion({ memberId: 'member:one', planId: 'church-2026-09', taskDate: '2026-09-12', status: 'COMPLETED', scheduler, store });
    await syncReadingReminderForCompletion({ memberId: 'member:one', planId: 'church-2026-09', taskDate: '2026-09-12', status: 'NOT_COMPLETED', scheduler, store });
    expect(calls).toEqual(['cancel:reading:member:one:2026-09-12', 'schedule:reading:member:one:2026-09-12']);
  });
});
