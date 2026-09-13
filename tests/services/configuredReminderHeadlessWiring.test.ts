import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConfiguredReminderHeadlessTask, validateConfiguredMeetingReminder } from '../../src/services/configuredReminderHeadless';
import { MEETING_REMINDER_TASK } from '../../src/services/reminderDelivery';

const native = vi.hoisted(() => ({
  auth: { status: 'hydrating', session: null as { memberId: string; sessionToken: string } | null, epoch: 0, expiresAt: null as number | null },
  getItemAsync: vi.fn(async (key: string) => ({
    'qingmu.reminder.installationId': 'test-installation', 'qingmu.reminder.deviceToken': 'test-device-token',
    'qingmu.reminder.bindingVersion': '1', 'qingmu.reminder.ownerGeneration': '1',
    'qingmu.reminder.ownerReceipt.v1': JSON.stringify({ memberId: 'member:one', installationId: 'test-installation', token: 'test-device-token', bindingVersion: 1, ownerGeneration: 1 }),
  }[key] ?? null)),
  defineTask: vi.fn(),
  registerTaskAsync: vi.fn(async () => undefined),
  setNotificationChannelAsync: vi.fn(async () => null),
  scheduleNotificationAsync: vi.fn(async () => 'native-notification'),
  hasPersistedAuthTermination: vi.fn(async () => false),
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: native.getItemAsync }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => native.auth, hasPersistedAuthTermination: native.hasPersistedAuthTermination }));
vi.mock('expo-task-manager', () => ({ defineTask: native.defineTask }));
vi.mock('expo-notifications', () => native);

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { native.auth = { status: 'hydrating', session: null, epoch: 0, expiresAt: null }; });
const payload = { event: 'MEETING_REMINDER' as const, reminderId: 'meeting:m1:2', meetingId: 'm1', scheduleRevision: 2 };
const accepted = { valid: true, memberId: 'member:one', meetingId: 'm1', scheduleRevision: 2, status: 'SCHEDULED' };

describe('configured default reminder entrypoints', () => {
  it('uses the configured URL and real validator through the exported foreground/tap function', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(accepted)));
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubEnv('EXPO_PUBLIC_QINGMU_API_BASE_URL', 'https://configured-reminder.test');
    expect(await validateConfiguredMeetingReminder(payload)).toEqual(accepted);
    expect(fetchImpl).toHaveBeenCalledWith('https://configured-reminder.test/api/device/reminders/validate', expect.objectContaining({ method: 'POST' }));
  });

  it('registers the actual headless runtime, validates the Android wire map and presents the authoritative owner', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(accepted)));
    vi.stubGlobal('fetch', fetchImpl);
    await registerConfiguredReminderHeadlessTask();
    expect(native.defineTask).toHaveBeenCalledWith(MEETING_REMINDER_TASK, expect.any(Function));
    expect(native.registerTaskAsync).toHaveBeenCalledWith(MEETING_REMINDER_TASK);
    const handler = native.defineTask.mock.calls[0][1] as (event: { data: unknown }) => Promise<void>;
    await handler({ data: { notification: null, data: { ...payload, scheduleRevision: '2' } } });
    expect(native.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ data: { ...payload, memberId: 'member:one' } }), trigger: { channelId: 'qingmu-reading-reminders' } }));
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ ...accepted, valid: false, status: 'CANCELLED' })));
    await handler({ data: { notification: null, data: { ...payload, scheduleRevision: '2' } } });
    expect(native.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['expired', 'signed-out'])('uses persisted device authority with no mounted UI and an %s interactive session', async (status) => {
    native.auth = { status, session: { memberId: 'member:one', sessionToken: 'expired-test-session' }, epoch: 1, expiresAt: 1 };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(accepted)));
    vi.stubGlobal('fetch', fetchImpl);
    await registerConfiguredReminderHeadlessTask();
    const handler = native.defineTask.mock.calls[0][1] as (event: { data: unknown }) => Promise<void>;
    await handler({ data: { notification: null, data: { ...payload, scheduleRevision: '2' } } });
    expect(native.scheduleNotificationAsync).toHaveBeenCalledTimes(status === 'expired' ? 1 : 0);
    expect(fetchImpl).toHaveBeenCalledTimes(status === 'expired' ? 1 : 0);
  });
});
