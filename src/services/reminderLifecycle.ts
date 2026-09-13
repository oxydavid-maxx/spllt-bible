import type { AuthLifecycleChange, AuthSession } from './authSession';
import { getAuthSnapshot, registerAuthLifecycleListener } from './authSession';
import { readReminderDeviceBinding, clearReminderDeviceBinding, type PendingReminderDeviceRevocations, type ReminderDeviceBinding, type ReminderDeviceApi, type ReminderDeviceSecureStore } from './reminderDevice';
import type { ReminderScheduler } from './reminderScheduler';

export interface ReminderLifecycleOptions {
  scheduler: ReminderScheduler;
  secureStore: ReminderDeviceSecureStore;
  createApiClient: (session: AuthSession) => ReminderDeviceApi;
  revokeDeviceBinding?: (binding: ReminderDeviceBinding) => Promise<boolean>;
  deviceRevokeQueue?: PendingReminderDeviceRevocations;
}

/** Interactive authentication expiry does not withdraw the user's reminder opt-in. */
export function isReminderTokenExpiry(change: AuthLifecycleChange): boolean {
  if (change.reason === 'expired') return true;
  const snapshot = getAuthSnapshot();
  return change.reason === 'hydrate' && snapshot.status === 'expired' && Boolean(change.invalidated && snapshot.session?.memberId === change.invalidated.memberId && snapshot.session.sessionToken === change.invalidated.sessionToken);
}

export function configureReminderLifecycle(options: ReminderLifecycleOptions): () => void {
  let disposed = false;
  let generation = 0;
  let currentSession: AuthSession | null = null;
  let expiredOwner: string | null = null;
  const cleanupInvalidated = async (session: AuthSession, _operation: number, interactiveRevokeAllowed: boolean): Promise<void> => {
    const operation = _operation;
    const binding = await readReminderDeviceBinding(options.secureStore, session.memberId);
    await options.scheduler.cancelForMember(session.memberId).catch(() => undefined);
    if (disposed || (operation !== generation && currentSession?.memberId === session.memberId)) return;
    if (!binding) return;
    if (options.deviceRevokeQueue) await options.deviceRevokeQueue.enqueue(binding);
    const cleared = await clearReminderDeviceBinding(options.secureStore, binding);
    if (options.deviceRevokeQueue) { void options.deviceRevokeQueue.flush().catch(() => undefined); return; }
    if (!cleared) return;
    if (options.revokeDeviceBinding) await options.revokeDeviceBinding(binding).catch(() => false);
    else if (interactiveRevokeAllowed) await options.createApiClient(session).revokeReminderDeviceToken(binding.installationId, binding.bindingVersion, binding.ownerGeneration).catch(() => false);
  };
  const onAuthLifecycle = (change: AuthLifecycleChange): void => {
    if (isReminderTokenExpiry(change)) { generation += 1; currentSession = null; expiredOwner = change.invalidated?.memberId ?? null; return; }
    if (change.current) generation += 1;
    currentSession = change.current;
    if (!change.invalidated) return;
    const operation = ++generation;
    const interactiveRevokeAllowed = expiredOwner !== change.invalidated.memberId;
    expiredOwner = null;
    void cleanupInvalidated(change.invalidated, operation, interactiveRevokeAllowed);
  };
  const unregister = registerAuthLifecycleListener(onAuthLifecycle);
  return () => { disposed = true; unregister(); generation += 1; };
}
