import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const reconcile = vi.fn(async () => undefined);
const scheduler = {
  requestPermission: vi.fn(async () => 'granted' as const),
  cancelForMember: vi.fn(async () => undefined),
};

vi.mock('../../src/services/reminderScheduler', () => ({
  buildUpcomingReadingReminderSpecs: vi.fn(() => [{ reminderId: 'reading:member:old:2026-09-12', memberId: 'member:old', kind: 'READING', targetId: 'church-2026-09', taskDate: '2026-09-12', scheduleRevision: 0, triggerAt: '2026-09-12T00:00:00.000Z', route: '/today', status: 'ACTIVE' }]),
  createReminderScheduler: vi.fn(() => scheduler),
}));
vi.mock('../../src/services/reminderReconciler', () => ({ createReminderReconciler: vi.fn(() => ({ reconcile })) }));
vi.mock('../../src/services/apiClient', () => ({
  createApiClient: vi.fn(() => ({
    getReminderSnapshot: vi.fn(async () => ({ memberId: 'member:old', readingEnabled: true, meetingEnabled: true, readingTime: '08:00', meetingAdvanceMinutes: 30, remoteDeliveryStatus: 'REMOTE_PENDING', meetings: [{ meetingId: 'meeting:old', title: '舊聚會', startsAt: '2026-09-12T00:00:00.000Z', timeZone: 'Asia/Taipei', scheduleRevision: 1, status: 'SCHEDULED' }] })),
    registerReminderDeviceToken: vi.fn(async () => true),
    revokeReminderDeviceToken: vi.fn(async () => true),
    saveReminderPreferences: vi.fn(async () => null),
  })),
}));
vi.mock('../../src/ui/GoogleLoginCard', () => ({ GoogleLoginCard: () => React.createElement('GoogleLoginCard') }));
vi.mock('react-native', () => ({
  Linking: { openSettings: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: vi.fn(), requestPermissionsAsync: vi.fn(), getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android', data: 'fixture-token' })), addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixture-installation') }));
vi.mock('expo-modules-core', () => ({ EventEmitter: class {}, NativeModulesProxy: {}, requireNativeModule: vi.fn(), requireOptionalNativeModule: vi.fn(), Platform: { OS: 'test' } }));

import { AccountSurface } from '../../src/ui/accountSurfaceComponent';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

describe('mounted reminder authority boundary', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = (...args: unknown[]) => { const message = String(args[0] ?? ''); if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return; originalError(...args); }; });
  afterAll(() => { console.error = originalError; });
  it('does not destroy valid reminders when the account route unmounts normally', async () => {
    scheduler.cancelForMember.mockClear();
    act(() => { setAuthSession({ memberId: 'member:valid', sessionToken: 'valid-token' }); });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(AccountSurface)); });
    renderer.unmount();
    await Promise.resolve();
    expect(scheduler.cancelForMember).not.toHaveBeenCalled();
  });
});
