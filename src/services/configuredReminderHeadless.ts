import { runtimeConfig } from '../config/runtime';
import type { AuthSnapshot } from './authSession';
import { REMINDER_DEVICE_OWNER_RECEIPT_KEY, isReminderDeviceBinding, readReminderDeviceBinding, type ReminderDeviceBinding, type ReminderDeviceSecureStore } from './reminderDevice';
import { presentValidatedMeetingReminder, registerDefaultReminderHeadlessTask, type HeadlessMeetingPayload, type HeadlessValidationResult } from './reminderDelivery';
import type { ReminderDeviceRevokeResult } from './reminderDeviceRevokeQueue';

type ValidationAuthSnapshot = Pick<AuthSnapshot, 'status' | 'session' | 'epoch' | 'expiresAt'>;

export interface ConfiguredMeetingReminderValidationDependencies {
  apiBaseUrl: string;
  secureStore: Pick<ReminderDeviceSecureStore, 'getItemAsync'>;
  getAuthSnapshot: () => ValidationAuthSnapshot;
  hasPersistedAuthTermination: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

function invalidResult(payload: HeadlessMeetingPayload): HeadlessValidationResult {
  return { valid: false, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'CANCELLED' };
}

function authAllowsValidation(auth: ValidationAuthSnapshot): boolean {
  // Background delivery is authorized by the persistent device binding, not by
  // the Google session deadline. Explicit logout still closes this entrypoint.
  return auth.status === 'hydrating' || (auth.status === 'expired' && auth.session !== null)
    || (auth.status === 'signed-in' && Boolean(auth.session?.memberId.trim()));
}

function sameAuth(before: ValidationAuthSnapshot, after: ValidationAuthSnapshot): boolean {
  const sameState = before.epoch === after.epoch && before.status === after.status;
  const expiryOnly = before.status === 'signed-in' && after.status === 'expired' && after.epoch === before.epoch + 1;
  return (sameState || expiryOnly) && before.expiresAt === after.expiresAt
    && before.session?.memberId === after.session?.memberId && before.session?.sessionToken === after.session?.sessionToken;
}

export function createConfiguredMeetingReminderValidator(dependencies: ConfiguredMeetingReminderValidationDependencies) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const readBinding = async () => {
    const raw = await dependencies.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
    const receipt: unknown = raw ? JSON.parse(raw) : null;
    return isReminderDeviceBinding(receipt) ? readReminderDeviceBinding(dependencies.secureStore, receipt.memberId) : null;
  };

  return async (payload: HeadlessMeetingPayload): Promise<HeadlessValidationResult> => {
    const invalid = invalidResult(payload);
    if (payload.event !== 'MEETING_REMINDER' || typeof payload.meetingId !== 'string' || !payload.meetingId.trim()
      || typeof payload.reminderId !== 'string' || !payload.reminderId.trim()
      || !Number.isSafeInteger(payload.scheduleRevision) || payload.scheduleRevision < 0) return invalid;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const validate = async (): Promise<HeadlessValidationResult> => {
      const authBefore = dependencies.getAuthSnapshot();
      if (!authAllowsValidation(authBefore) || await dependencies.hasPersistedAuthTermination()) return invalid;
      const bindingBefore = await readBinding();
      if (await dependencies.hasPersistedAuthTermination()) return invalid;
      if (controller.signal.aborted || !bindingBefore
        || !sameAuth(authBefore, dependencies.getAuthSnapshot())) return invalid;
      const { installationId, token } = bindingBefore;
      const response = await fetchImpl(`${dependencies.apiBaseUrl}/api/device/reminders/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-qingmu-installation-id': installationId, 'x-qingmu-device-token': token },
        body: JSON.stringify({ meeting_id: payload.meetingId, schedule_revision: payload.scheduleRevision }),
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) return invalid;
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid;
      const latest = body as Record<string, unknown>;
      if (latest.valid !== true || latest.status !== 'SCHEDULED' || latest.meetingId !== payload.meetingId
        || !Number.isSafeInteger(latest.scheduleRevision) || latest.scheduleRevision !== payload.scheduleRevision
        || typeof latest.memberId !== 'string' || !latest.memberId.trim()) return invalid;
      const bindingAfter = await readReminderDeviceBinding(dependencies.secureStore, latest.memberId);
      if (await dependencies.hasPersistedAuthTermination()) return invalid;
      const authAfter = dependencies.getAuthSnapshot();
      if (controller.signal.aborted || !bindingAfter || bindingBefore.memberId !== bindingAfter.memberId
        || bindingBefore.installationId !== bindingAfter.installationId || bindingBefore.token !== bindingAfter.token
        || bindingBefore.bindingVersion !== bindingAfter.bindingVersion || bindingBefore.ownerGeneration !== bindingAfter.ownerGeneration
        || !sameAuth(authBefore, authAfter) || !authAllowsValidation(authAfter)
        || (authAfter.session?.memberId && authAfter.session.memberId !== latest.memberId)) return invalid;
      return { valid: true, memberId: latest.memberId, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'SCHEDULED' };
    };
    try {
      return await Promise.race([
        validate().catch(() => invalid),
        new Promise<HeadlessValidationResult>((resolve) => {
          timeout = setTimeout(() => { controller.abort(); resolve(invalid); }, 2000);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

export async function validateConfiguredMeetingReminder(payload: HeadlessMeetingPayload): Promise<HeadlessValidationResult> {
  try {
    const [secureStore, { getAuthSnapshot, hasPersistedAuthTermination }] = await Promise.all([import('expo-secure-store'), import('./authSession')]);
    const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
    return await createConfiguredMeetingReminderValidator({ apiBaseUrl: config.apiBaseUrl, secureStore, getAuthSnapshot, hasPersistedAuthTermination: () => hasPersistedAuthTermination(secureStore) })(payload);
  } catch { return invalidResult(payload); }
}

export async function registerConfiguredReminderHeadlessTask(): Promise<void> {
  await registerDefaultReminderHeadlessTask({ validateLatest: validateConfiguredMeetingReminder, present: presentValidatedMeetingReminder });
}

export function createConfiguredReminderDeviceRevokeTransport(dependencies: { apiBaseUrl: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return async (binding: ReminderDeviceBinding): Promise<ReminderDeviceRevokeResult> => {
    if (!isReminderDeviceBinding(binding)) return 'RETRY';
    const captured = { ...binding };
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const revoke = async (): Promise<ReminderDeviceRevokeResult> => {
      const response = await fetchImpl(`${dependencies.apiBaseUrl}/api/device/reminders/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-qingmu-installation-id': captured.installationId, 'x-qingmu-device-token': captured.token },
        body: JSON.stringify({ member_id: captured.memberId, binding_version: captured.bindingVersion, owner_generation: captured.ownerGeneration }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || (response.status !== 200 && response.status !== 403)) return 'RETRY';
      const body: unknown = await response.json();
      if (controller.signal.aborted || !body || typeof body !== 'object') return 'RETRY';
      if (response.status === 200 && 'revoked' in body && body.revoked === true) return 'REVOKED';
      if (response.status === 403 && 'error' in body && body.error === 'DEVICE_DELIVERY_REVOKED') return 'ALREADY_INVALID';
      return 'RETRY';
    };
    try {
      return await Promise.race([
        revoke().catch(() => 'RETRY' as const),
        new Promise<ReminderDeviceRevokeResult>((resolve) => { timeout = setTimeout(() => { controller.abort(); resolve('RETRY'); }, 2000); }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

export function createConfiguredReminderDeviceRevoker(dependencies: { apiBaseUrl: string; fetchImpl?: typeof fetch }) {
  const revoke = createConfiguredReminderDeviceRevokeTransport(dependencies);
  return async (binding: ReminderDeviceBinding): Promise<boolean> => (await revoke(binding)) === 'REVOKED';
}

export async function revokeConfiguredReminderDeviceBindingResult(binding: ReminderDeviceBinding): Promise<ReminderDeviceRevokeResult> {
  const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
  return createConfiguredReminderDeviceRevokeTransport({ apiBaseUrl: config.apiBaseUrl })(binding);
}

export async function revokeConfiguredReminderDeviceBinding(binding: ReminderDeviceBinding): Promise<boolean> {
  return (await revokeConfiguredReminderDeviceBindingResult(binding)) === 'REVOKED';
}
