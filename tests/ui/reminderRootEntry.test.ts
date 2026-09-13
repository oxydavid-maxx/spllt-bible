import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { status: 'hydrating', session: null, epoch: 0 } as any,
  navigationKey: undefined as string | undefined,
  handler: null as any,
  listener: null as null | ((response: unknown) => void),
  last: null as any,
  push: vi.fn(), remove: vi.fn(), clear: vi.fn(), validate: vi.fn(), revokeDevice: vi.fn(async () => true),
  runtimeOptions: null as any,
  storeValues: new Map<string, string>(),
  appStateListener: null as null | ((value: string) => void),
  removeAppState: vi.fn(),
  revokeResult: vi.fn(async () => 'REVOKED' as 'REVOKED' | 'RETRY'),
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', StyleSheet: { create: (x: unknown) => x }, AppState: { addEventListener: (_event: string, listener: (value: string) => void) => { state.appStateListener = listener; return { remove: state.removeAppState }; } } }));
vi.mock('expo-router', () => ({
  Stack: () => React.createElement('Stack', { readingDate: useReadingSession().selectedDate }),
  router: { push: state.push },
  useRootNavigationState: () => ({ key: state.navigationKey }),
}));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-id' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => state.storeValues.get(key) ?? null, setItemAsync: async (key: string, value: string) => { state.storeValues.set(key, value); }, deleteItemAsync: async (key: string) => { state.storeValues.delete(key); } }));
vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: (handler: unknown) => { state.handler = handler; },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { state.listener = listener; return { remove: state.remove }; },
  getLastNotificationResponse: () => state.last,
  clearLastNotificationResponse: () => { state.last = null; state.clear(); },
}));
vi.mock('../../src/services/authSession', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children, useAuthSnapshot: () => state.auth, getAuthSnapshot: () => state.auth }));
vi.mock('../../src/services/configuredReminderHeadless', () => ({ registerConfiguredReminderHeadlessTask: async () => {}, validateConfiguredMeetingReminder: state.validate, revokeConfiguredReminderDeviceBinding: state.revokeDevice, revokeConfiguredReminderDeviceBindingResult: state.revokeResult }));
vi.mock('../../src/services/reminderRuntime', () => ({ ReminderRuntimeOwner: class { constructor(options: unknown) { state.runtimeOptions = options; } }, configureReminderRuntime: () => {} }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getProfile: async () => null }) }));

import RootLayout from '../../app/_layout';
import { setSelectedReadingDate, useReadingSession } from '../../src/ui/readingSession';
import * as SecureStore from 'expo-secure-store';
import { createReminderDeviceRevokeQueue, REMINDER_DEVICE_REVOKE_QUEUE_KEY } from '../../src/services/reminderDeviceRevokeQueue';
let renderer: TestRenderer.ReactTestRenderer | null = null;
const reading = { actionIdentifier: 'default', notification: { date: 1, request: { identifier: 'root-reading', content: { data: { kind: 'READING', memberId: 'member:a', reminderId: 'reading:member:a:2026-09-14', targetId: 'church-2026-09', taskDate: '2026-09-14', route: 'https://untrusted.invalid/' } } } } };
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(RootLayout)); }); await act(async () => { await vi.dynamicImportSettled(); }); }
async function update() { await act(async () => { renderer!.update(React.createElement(RootLayout)); }); }
describe('formal Root notification wiring', () => {
  beforeEach(() => {
    state.auth = { status: 'hydrating', session: null, epoch: 0 }; state.navigationKey = undefined;
    state.handler = null; state.listener = null; state.last = null;
    state.storeValues.clear(); state.appStateListener = null; state.revokeResult.mockResolvedValue('REVOKED');
    state.validate.mockResolvedValue({ valid: true, memberId: 'member:a', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' });
    setSelectedReadingDate('2026-09-12');
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const text = String(args[0]);
      if (text.includes('react-test-renderer is deprecated') || text.includes('testing environment is not configured to support act')) return;
      throw new Error(text);
    });
  });
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = null; vi.restoreAllMocks(); });

  it('wires foreground/live listeners and waits for auth plus root readiness before applying a cold-start date', async () => {
    state.last = reading;
    await mount();
    expect(state.handler?.handleNotification).toBeTypeOf('function');
    expect(state.listener).toBeTypeOf('function');
    expect(state.runtimeOptions.revokeDeviceBinding).toBe(state.revokeDevice);
    expect(state.runtimeOptions.deviceRevokeQueue?.enqueue).toBeTypeOf('function');
    expect(state.push).not.toHaveBeenCalled();
    state.auth = { status: 'signed-in', session: { memberId: 'member:a', sessionToken: 'token-a' }, epoch: 1 };
    await update(); expect(state.push).not.toHaveBeenCalled();
    state.navigationKey = 'root-ready'; await update();
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/today');
    expect(renderer!.root.find(node => String(node.type) === 'Stack').props.readingDate).toBe('2026-09-14');
    expect(state.clear).toHaveBeenCalledOnce();
    expect(await state.handler.handleNotification(reading.notification)).toMatchObject({ shouldShowBanner: true });
  });

  it('uses the same fresh meeting validation for a live click and clears listeners on Root unmount', async () => {
    state.auth = { status: 'signed-in', session: { memberId: 'member:a', sessionToken: 'token-a' }, epoch: 1 }; state.navigationKey = 'ready';
    await mount();
    expect(state.listener).toBeTypeOf('function');
    const event = { actionIdentifier: 'default', notification: { date: 2, request: { identifier: 'root-meeting', content: { data: { event: 'MEETING_REMINDER', memberId: 'member:a', meetingId: 'm1', reminderId: 'meeting:m1:2', scheduleRevision: 2, route: '/account' } } } } };
    await act(async () => { state.listener!(event); });
    expect(state.validate).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/groups');
    await act(async () => { renderer!.unmount(); }); renderer = null;
    expect(state.remove).toHaveBeenCalledOnce(); expect(state.handler).toBeNull();
  });

  it('retries persisted device revocation on cold Root startup and on returning to foreground without sign-in', async () => {
    const binding = { memberId: 'member:old', installationId: 'old-install', token: 'old-device', bindingVersion: 9, ownerGeneration: 4 };
    const queue = createReminderDeviceRevokeQueue({ secureStore: SecureStore, revoke: state.revokeResult });
    await queue.enqueue(binding);
    state.revokeResult.mockResolvedValueOnce('RETRY').mockResolvedValueOnce('REVOKED');
    await mount(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(state.revokeResult).toHaveBeenCalledExactlyOnceWith(binding);
    expect(state.storeValues.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY)).toBeDefined();
    expect(state.push).not.toHaveBeenCalled();
    await act(async () => { state.appStateListener?.('background'); });
    expect(state.revokeResult).toHaveBeenCalledOnce();
    await act(async () => { state.appStateListener?.('active'); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(state.revokeResult).toHaveBeenCalledTimes(2);
    expect(String(state.storeValues.get(REMINDER_DEVICE_REVOKE_QUEUE_KEY) ?? '')).not.toContain(binding.token);
  });
});
