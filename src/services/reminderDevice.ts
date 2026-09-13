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
export interface ReminderDeviceAuthority { isCurrent: () => boolean; }

export async function ensureReminderInstallationId(secureStore: ReminderDeviceSecureStore, generate: () => string, isAuthorized: () => boolean = () => true): Promise<string | null> {
  if (!isAuthorized()) return null;
  const existing = await secureStore.getItemAsync(REMINDER_INSTALLATION_KEY);
  if (!isAuthorized()) return null;
  if (existing?.trim()) return existing.trim();
  const created = generate();
  if (!isAuthorized()) return null;
  await secureStore.setItemAsync(REMINDER_INSTALLATION_KEY, created);
  return isAuthorized() ? created : null;
}

export const REMINDER_DEVICE_BINDING_VERSION_KEY = 'qingmu.reminder.bindingVersion';
export const REMINDER_DEVICE_OWNER_GENERATION_KEY = 'qingmu.reminder.ownerGeneration';

export async function registerReminderDevice(options: { secureStore: ReminderDeviceSecureStore; tokenSource: ReminderDeviceTokenSource; api: ReminderDeviceApi; generateInstallationId: () => string; ownerGeneration?: number; authority?: ReminderDeviceAuthority }): Promise<{ registered: boolean; installationId: string | null; bindingVersion?: number; ownerGeneration?: number }> {
  const isAuthorized = () => options.authority?.isCurrent() ?? true;
  if (!isAuthorized()) return { registered: false, installationId: null };
  const permissionToken = await options.tokenSource.getDevicePushTokenAsync();
  if (!isAuthorized()) return { registered: false, installationId: null };
  const tokenType = permissionToken.type.toLowerCase();
  if ((tokenType !== 'android' && tokenType !== 'fcm') || !permissionToken.data.trim()) return { registered: false, installationId: null };
  const token = permissionToken.data.trim();
  const installationId = await ensureReminderInstallationId(options.secureStore, options.generateInstallationId, isAuthorized);
  if (!installationId || !isAuthorized()) return { registered: false, installationId };
  const response = await options.api.registerReminderDeviceToken({ installationId, token, platform: 'ANDROID', ownerGeneration: options.ownerGeneration });
  const registered = response === true || (typeof response === 'object' && response.registered === true);
  const bindingVersion = typeof response === 'object' ? response.bindingVersion : undefined;
  const ownerGeneration = typeof response === 'object' ? response.ownerGeneration : options.ownerGeneration;
  if (!isAuthorized()) {
    if (registered) await options.api.revokeReminderDeviceToken(installationId, bindingVersion, ownerGeneration).catch(() => false);
    const persisted = await options.secureStore.getItemAsync(REMINDER_DEVICE_TOKEN_KEY);
    const persistedBinding = await options.secureStore.getItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
    if (persisted === token && (bindingVersion === undefined || persistedBinding === String(bindingVersion))) {
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_TOKEN_KEY);
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
    }
    return { registered: false, installationId, bindingVersion, ownerGeneration };
  }
  if (registered) {
    await options.secureStore.setItemAsync(REMINDER_DEVICE_TOKEN_KEY, token);
    if (bindingVersion !== undefined) await options.secureStore.setItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY, String(bindingVersion));
    if (ownerGeneration !== undefined) await options.secureStore.setItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY, String(ownerGeneration));
    if (!isAuthorized()) {
      await options.api.revokeReminderDeviceToken(installationId, bindingVersion, ownerGeneration).catch(() => false);
      const persisted = await options.secureStore.getItemAsync(REMINDER_DEVICE_TOKEN_KEY);
      const persistedBinding = await options.secureStore.getItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
      if (persisted === token && (bindingVersion === undefined || persistedBinding === String(bindingVersion))) {
        await options.secureStore.deleteItemAsync(REMINDER_DEVICE_TOKEN_KEY);
        await options.secureStore.deleteItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
        await options.secureStore.deleteItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
      }
      return { registered: false, installationId, bindingVersion, ownerGeneration };
    }
  }
  return { registered, installationId, bindingVersion, ownerGeneration };
}

export async function revokeReminderDevice(options: { secureStore: ReminderDeviceSecureStore; api: ReminderDeviceApi; expectedToken?: string | null; expectedBindingVersion?: number; expectedOwnerGeneration?: number }): Promise<boolean> {
  const installationId = await options.secureStore.getItemAsync(REMINDER_INSTALLATION_KEY);
  if (!installationId?.trim()) return false;
  const revoked = await options.api.revokeReminderDeviceToken(installationId.trim(), options.expectedBindingVersion, options.expectedOwnerGeneration);
  if (revoked) {
    const currentToken = await options.secureStore.getItemAsync(REMINDER_DEVICE_TOKEN_KEY);
    const currentBinding = await options.secureStore.getItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
    const currentOwnerGeneration = await options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
    const bindingMatches = options.expectedBindingVersion === undefined || currentBinding === String(options.expectedBindingVersion);
    const ownerMatches = options.expectedOwnerGeneration === undefined || currentOwnerGeneration === String(options.expectedOwnerGeneration);
    if (bindingMatches && ownerMatches && (options.expectedToken === undefined || currentToken === options.expectedToken)) {
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_TOKEN_KEY);
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_BINDING_VERSION_KEY);
      await options.secureStore.deleteItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
    }
  }
  return revoked;
}
