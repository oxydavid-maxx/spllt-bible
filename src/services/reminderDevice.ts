export const REMINDER_INSTALLATION_KEY = 'qingmu.reminder.installationId';
export const REMINDER_DEVICE_TOKEN_KEY = 'qingmu.reminder.deviceToken';

export interface ReminderDeviceSecureStore {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

export interface ReminderDeviceTokenSource {
  getDevicePushTokenAsync: () => Promise<{ type: string; data: string }>;
}

export interface ReminderDeviceApi {
  registerReminderDeviceToken: (input: { installationId: string; token: string; platform?: 'ANDROID'; ownerGeneration?: number }) => Promise<boolean | { registered: boolean; bindingVersion?: number; ownerGeneration?: number }>;
  revokeReminderDeviceToken: (installationId: string, bindingVersion?: number, ownerGeneration?: number) => Promise<boolean>;
}
export interface ReminderDeviceAuthority { isCurrent: () => boolean; canCommit?: () => boolean; }

export const REMINDER_DEVICE_BINDING_VERSION_KEY = 'qingmu.reminder.bindingVersion';
export const REMINDER_DEVICE_OWNER_GENERATION_KEY = 'qingmu.reminder.ownerGeneration';
export const REMINDER_DEVICE_OWNER_RECEIPT_KEY = 'qingmu.reminder.ownerReceipt.v1';
export const REMINDER_DEVICE_OWNER_SEQUENCE_KEY = 'qingmu.reminder.ownerSequence.v1';

export interface ReminderDeviceBinding {
  readonly memberId: string;
  readonly installationId: string;
  readonly token: string;
  readonly bindingVersion: number;
  readonly ownerGeneration: number;
}
export interface PendingReminderDeviceRevocations {
  enqueue: (binding: ReminderDeviceBinding) => Promise<void>;
  flush: () => Promise<void>;
}
type RegistrationResult = { registered: boolean; installationId: string | null; bindingVersion?: number; ownerGeneration?: number };
const registrationsInFlight = new Map<string, Promise<RegistrationResult>>();

// All local producers share one queue, including callers with distinct wrappers
// around the same native store. The owner receipt is the final single-key commit.
let bindingMutationTail: Promise<void> = Promise.resolve();
function withBindingLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = bindingMutationTail.then(operation, operation);
  bindingMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export function isReminderDeviceBinding(value: unknown): value is ReminderDeviceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return ['memberId', 'installationId', 'token'].every((key) => typeof binding[key] === 'string' && binding[key].trim().length > 0 && binding[key].trim() === binding[key])
    && typeof binding.bindingVersion === 'number' && Number.isSafeInteger(binding.bindingVersion) && binding.bindingVersion > 0
    && typeof binding.ownerGeneration === 'number' && Number.isSafeInteger(binding.ownerGeneration) && binding.ownerGeneration >= 0;
}

function sameBinding(left: ReminderDeviceBinding, right: ReminderDeviceBinding): boolean {
  return left.memberId === right.memberId && left.installationId === right.installationId && left.token === right.token
    && left.bindingVersion === right.bindingVersion && left.ownerGeneration === right.ownerGeneration;
}

function readActiveKeys(store: Pick<ReminderDeviceSecureStore, 'getItemAsync'>) {
  return Promise.all([REMINDER_INSTALLATION_KEY, REMINDER_DEVICE_TOKEN_KEY, REMINDER_DEVICE_BINDING_VERSION_KEY, REMINDER_DEVICE_OWNER_GENERATION_KEY].map((key) => store.getItemAsync(key)));
}

async function readBindingLocked(store: Pick<ReminderDeviceSecureStore, 'getItemAsync'>, expectedMemberId: string): Promise<ReminderDeviceBinding | null> {
  if (typeof expectedMemberId !== 'string' || !expectedMemberId.trim()) return null;
  const raw = await store.getItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!isReminderDeviceBinding(parsed) || parsed.memberId !== expectedMemberId) return null;
  const [installationId, token, bindingVersion, ownerGeneration] = await readActiveKeys(store);
  if (parsed.installationId !== installationId || parsed.token !== token || String(parsed.bindingVersion) !== bindingVersion || String(parsed.ownerGeneration) !== ownerGeneration) return null;
  return Object.freeze({ memberId: parsed.memberId, installationId: parsed.installationId, token: parsed.token, bindingVersion: parsed.bindingVersion, ownerGeneration: parsed.ownerGeneration });
}

export async function readReminderDeviceBinding(store: Pick<ReminderDeviceSecureStore, 'getItemAsync'>, expectedMemberId: string): Promise<ReminderDeviceBinding | null> {
  return withBindingLock(() => readBindingLocked(store, expectedMemberId)).catch(() => null);
}

async function deleteActiveKeysLocked(store: ReminderDeviceSecureStore): Promise<void> {
  await store.deleteItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
  await Promise.all([REMINDER_DEVICE_TOKEN_KEY, REMINDER_DEVICE_BINDING_VERSION_KEY, REMINDER_DEVICE_OWNER_GENERATION_KEY].map((key) => store.deleteItemAsync(key)));
}

export async function clearReminderDeviceBinding(store: ReminderDeviceSecureStore, expected: ReminderDeviceBinding): Promise<boolean> {
  if (!isReminderDeviceBinding(expected)) return false;
  const captured = { ...expected };
  return withBindingLock(async () => {
    const current = await readBindingLocked(store, captured.memberId);
    if (!current || !sameBinding(current, captured)) return false;
    await deleteActiveKeysLocked(store);
    return true;
  }).catch(() => false);
}

async function clearLegacyBinding(store: ReminderDeviceSecureStore, installationId: string, token: string, bindingVersion?: number, ownerGeneration?: number): Promise<boolean> {
  return withBindingLock(async () => {
    if (await store.getItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY)) return false;
    const actual = await readActiveKeys(store);
    const expected = [installationId, token, bindingVersion === undefined ? null : String(bindingVersion), ownerGeneration === undefined ? null : String(ownerGeneration)];
    if (actual.some((value, index) => value !== expected[index])) return false;
    await deleteActiveKeysLocked(store);
    return true;
  });
}

export async function ensureReminderInstallationId(secureStore: ReminderDeviceSecureStore, generate: () => string, isAuthorized: () => boolean = () => true): Promise<string | null> {
  return withBindingLock(async () => {
    if (!isAuthorized()) return null;
    const existing = await secureStore.getItemAsync(REMINDER_INSTALLATION_KEY);
    if (!isAuthorized()) return null;
    if (existing?.trim()) return existing.trim();
    const created = generate();
    if (!isAuthorized()) return null;
    await secureStore.setItemAsync(REMINDER_INSTALLATION_KEY, created);
    return isAuthorized() ? created : null;
  });
}

export async function registerReminderDevice(options: { secureStore: ReminderDeviceSecureStore; tokenSource: ReminderDeviceTokenSource; api: ReminderDeviceApi; generateInstallationId: () => string; memberId?: string; ownerGeneration?: number; authority?: ReminderDeviceAuthority; revokeDeviceBinding?: (binding: ReminderDeviceBinding) => Promise<boolean>; deviceRevokeQueue?: PendingReminderDeviceRevocations }): Promise<{ registered: boolean; installationId: string | null; bindingVersion?: number; ownerGeneration?: number }> {
  const isAuthorized = () => options.authority?.isCurrent() ?? true;
  const canCommit = () => options.authority?.canCommit?.() ?? isAuthorized();
  if (!isAuthorized()) return { registered: false, installationId: null };
  if (options.memberId !== undefined && (typeof options.memberId !== 'string' || !options.memberId.trim() || options.memberId !== options.memberId.trim())) return { registered: false, installationId: null };
  if (options.ownerGeneration !== undefined && (!Number.isSafeInteger(options.ownerGeneration) || options.ownerGeneration < 0)) return { registered: false, installationId: null };
  const permissionToken = await options.tokenSource.getDevicePushTokenAsync();
  if (!isAuthorized()) return { registered: false, installationId: null };
  const tokenType = permissionToken.type.toLowerCase();
  if ((tokenType !== 'android' && tokenType !== 'fcm') || !permissionToken.data.trim()) return { registered: false, installationId: null };
  const token = permissionToken.data.trim();
  const installationId = await ensureReminderInstallationId(options.secureStore, options.generateInstallationId, isAuthorized);
  if (!installationId || !isAuthorized()) return { registered: false, installationId };
  const perform = async (): Promise<RegistrationResult> => {
  const existing = options.memberId ? await readReminderDeviceBinding(options.secureStore, options.memberId) : null;
  if (!isAuthorized()) return { registered: false, installationId };
  if (existing && existing.installationId === installationId && existing.token === token && existing.ownerGeneration === options.ownerGeneration) {
    return { registered: true, installationId, bindingVersion: existing.bindingVersion, ownerGeneration: existing.ownerGeneration };
  }
  const response = await options.api.registerReminderDeviceToken({ installationId, token, platform: 'ANDROID', ownerGeneration: options.ownerGeneration });
  const registered = response === true || (response !== null && typeof response === 'object' && response.registered === true);
  const bindingVersion = response !== null && typeof response === 'object' ? response.bindingVersion : undefined;
  const ownerGeneration = response !== null && typeof response === 'object' ? response.ownerGeneration : options.ownerGeneration;
  const candidate = { memberId: options.memberId, installationId, token, bindingVersion, ownerGeneration };
  const binding = isReminderDeviceBinding(candidate) ? Object.freeze(candidate) : null;
  if (!registered || (options.memberId !== undefined && (!binding || (options.ownerGeneration !== undefined && binding.ownerGeneration !== options.ownerGeneration)))) {
    return { registered: false, installationId, bindingVersion, ownerGeneration };
  }
  const persisted = await withBindingLock(async () => {
    if (!canCommit()) return false;
    try {
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY);
      await options.secureStore.setItemAsync(REMINDER_DEVICE_TOKEN_KEY, token);
      if (bindingVersion !== undefined) await options.secureStore.setItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY, String(bindingVersion));
      else await options.secureStore.deleteItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
      if (ownerGeneration !== undefined) await options.secureStore.setItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY, String(ownerGeneration));
      else await options.secureStore.deleteItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
      if (canCommit() && binding) await options.secureStore.setItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY, JSON.stringify(binding));
      if (canCommit()) return true;
      if (binding && options.deviceRevokeQueue) await options.deviceRevokeQueue.enqueue(binding);
      await deleteActiveKeysLocked(options.secureStore);
      return false;
    } catch (error) {
      await deleteActiveKeysLocked(options.secureStore).catch(() => undefined);
      throw error;
    }
  });
  if (!persisted) {
    if (binding && options.deviceRevokeQueue) await options.deviceRevokeQueue.enqueue(binding);
    if (binding) await clearReminderDeviceBinding(options.secureStore, binding);
    else await clearLegacyBinding(options.secureStore, installationId, token, bindingVersion, ownerGeneration).catch(() => false);
    if (binding && options.deviceRevokeQueue) void options.deviceRevokeQueue.flush().catch(() => undefined);
    else if (binding && options.revokeDeviceBinding) await options.revokeDeviceBinding(binding).catch(() => false);
    else await options.api.revokeReminderDeviceToken(installationId, bindingVersion, ownerGeneration).catch(() => false);
  }
  return { registered: persisted, installationId, bindingVersion, ownerGeneration };
  };
  // Getter completion can emit the same token again. Coalesce at the shared
  // producer, using the complete logical owner tuple rather than a time window.
  if (!options.memberId || options.ownerGeneration === undefined) return perform();
  const key = JSON.stringify([options.memberId, installationId, token, options.ownerGeneration]);
  const pending = registrationsInFlight.get(key);
  if (pending) {
    const result = await pending;
    return canCommit() ? result : { ...result, registered: false };
  }
  const pendingRegistration = perform();
  registrationsInFlight.set(key, pendingRegistration);
  try { return await pendingRegistration; }
  finally { if (registrationsInFlight.get(key) === pendingRegistration) registrationsInFlight.delete(key); }
}

export async function revokeReminderDevice(options: { secureStore: ReminderDeviceSecureStore; api: ReminderDeviceApi; expectedToken?: string | null; expectedBindingVersion?: number; expectedOwnerGeneration?: number }): Promise<boolean> {
  const captured = await withBindingLock(async () => {
    const [installationId, token, bindingVersion, ownerGeneration] = await readActiveKeys(options.secureStore);
    if (!installationId?.trim() || !token?.trim()
      || (options.expectedToken !== undefined && token !== options.expectedToken)
      || (options.expectedBindingVersion !== undefined && bindingVersion !== String(options.expectedBindingVersion))
      || (options.expectedOwnerGeneration !== undefined && ownerGeneration !== String(options.expectedOwnerGeneration))) return null;
    // Legacy callers may revoke unreceipted bool registrations. A modern owner
    // receipt requires exact generation/version authority before any local clear.
    if (await options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_RECEIPT_KEY)) {
      if (options.expectedBindingVersion === undefined || options.expectedOwnerGeneration === undefined) return null;
    }
    await deleteActiveKeysLocked(options.secureStore);
    return { installationId, bindingVersion: options.expectedBindingVersion, ownerGeneration: options.expectedOwnerGeneration };
  });
  return captured ? options.api.revokeReminderDeviceToken(captured.installationId, captured.bindingVersion, captured.ownerGeneration) : false;
}
