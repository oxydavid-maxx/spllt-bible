import type { AuthLifecycleChange, AuthSession } from './authSession';
import { registerAuthLifecycleListener } from './authSession';
import { REMINDER_DEVICE_OWNER_GENERATION_KEY, revokeReminderDevice, type ReminderDeviceApi, type ReminderDeviceSecureStore } from './reminderDevice';
import type { ReminderScheduler } from './reminderScheduler';

export interface ReminderLifecycleOptions {
  scheduler: ReminderScheduler;
  secureStore: ReminderDeviceSecureStore;
  createApiClient: (session: AuthSession) => ReminderDeviceApi;
}

export function configureReminderLifecycle(options: ReminderLifecycleOptions): () => void {
  let disposed = false;
  let generation = 0;
  let currentSession: AuthSession | null = null;
  const cleanupInvalidated = async (session: AuthSession, _operation: number): Promise<void> => {
    const operation = _operation;
    const expectedToken = await options.secureStore.getItemAsync('qingmu.reminder.deviceToken');
    const expectedOwnerGenerationValue = await options.secureStore.getItemAsync(REMINDER_DEVICE_OWNER_GENERATION_KEY);
    const expectedOwnerGeneration = expectedOwnerGenerationValue && Number.isInteger(Number(expectedOwnerGenerationValue)) ? Number(expectedOwnerGenerationValue) : undefined;
    await options.scheduler.cancelForMember(session.memberId).catch(() => undefined);
    if (disposed || (operation !== generation && currentSession?.memberId === session.memberId)) return;
    await revokeReminderDevice({ secureStore: options.secureStore, api: options.createApiClient(session), expectedToken, expectedOwnerGeneration }).catch(() => false);
  };
  const onAuthLifecycle = (change: AuthLifecycleChange): void => {
    if (change.current) generation += 1;
    currentSession = change.current;
    if (!change.invalidated) return;
    const operation = ++generation;
    void cleanupInvalidated(change.invalidated, operation);
  };
  const unregister = registerAuthLifecycleListener(onAuthLifecycle);
  return () => { disposed = true; unregister(); generation += 1; };
}
