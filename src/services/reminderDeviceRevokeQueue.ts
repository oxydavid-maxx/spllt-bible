import { isReminderDeviceBinding, type ReminderDeviceBinding, type ReminderDeviceSecureStore } from './reminderDevice';

export type ReminderDeviceRevokeResult = 'REVOKED' | 'ALREADY_INVALID' | 'RETRY';
export const REMINDER_DEVICE_REVOKE_QUEUE_KEY = 'qingmu.reminder.pendingDeviceRevocations.v1';
type QueueStore = Pick<ReminderDeviceSecureStore, 'getItemAsync' | 'setItemAsync'>;
interface Coordinator { mutationTail: Promise<void>; flush: Promise<void> | null; }
const coordinators = new WeakMap<QueueStore, Coordinator>();

function sameBinding(left: ReminderDeviceBinding, right: ReminderDeviceBinding): boolean {
  return left.memberId === right.memberId && left.installationId === right.installationId && left.token === right.token
    && left.bindingVersion === right.bindingVersion && left.ownerGeneration === right.ownerGeneration;
}

function capturedBinding(binding: ReminderDeviceBinding): ReminderDeviceBinding {
  return Object.freeze({ memberId: binding.memberId, installationId: binding.installationId, token: binding.token, bindingVersion: binding.bindingVersion, ownerGeneration: binding.ownerGeneration });
}

export function createReminderDeviceRevokeQueue(options: { secureStore: QueueStore; revoke: (binding: ReminderDeviceBinding) => Promise<ReminderDeviceRevokeResult> }) {
  const store = options.secureStore;
  let coordinator = coordinators.get(store);
  if (!coordinator) {
    coordinator = { mutationTail: Promise.resolve(), flush: null };
    coordinators.set(store, coordinator);
  }
  const state = coordinator;
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = state.mutationTail.then(operation, operation);
    state.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function read(): Promise<ReminderDeviceBinding[]> {
    const raw = await store.getItemAsync(REMINDER_DEVICE_REVOKE_QUEUE_KEY);
    if (raw === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('REMINDER_REVOKE_QUEUE_INVALID'); }
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1
      || !('bindings' in parsed) || !Array.isArray(parsed.bindings) || !parsed.bindings.every(isReminderDeviceBinding)) {
      throw new Error('REMINDER_REVOKE_QUEUE_INVALID');
    }
    const bindings = parsed.bindings.map(capturedBinding);
    if (bindings.some((item, index) => bindings.slice(0, index).some((prior) => sameBinding(item, prior)))) throw new Error('REMINDER_REVOKE_QUEUE_INVALID');
    return bindings;
  }

  async function write(bindings: ReminderDeviceBinding[]): Promise<void> {
    const raw = JSON.stringify({ version: 1, bindings });
    // Only the injected Expo SecureStore receives credential-bearing queue JSON.
    await store.setItemAsync(REMINDER_DEVICE_REVOKE_QUEUE_KEY, raw);
    if (await store.getItemAsync(REMINDER_DEVICE_REVOKE_QUEUE_KEY) !== raw) throw new Error('REMINDER_REVOKE_QUEUE_WRITE_FAILED');
  }

  async function enqueue(binding: ReminderDeviceBinding): Promise<void> {
    if (!isReminderDeviceBinding(binding)) throw new Error('REMINDER_REVOKE_BINDING_INVALID');
    const captured = capturedBinding(binding);
    await mutate(async () => {
      const pending = await read();
      if (!pending.some((item) => sameBinding(item, captured))) await write([...pending, captured]);
    });
  }

  function flush(): Promise<void> {
    if (state.flush) return state.flush;
    const operation = async () => {
      const attempted: ReminderDeviceBinding[] = [];
      while (true) {
        const binding = await mutate(async () => (await read()).find((item) => !attempted.some((prior) => sameBinding(item, prior))));
        if (!binding) return;
        attempted.push(binding);
        let result: ReminderDeviceRevokeResult = 'RETRY';
        // No mutation lock is held while the transport waits, so new logout
        // intents can become durable even during an offline/pending attempt.
        try { result = await options.revoke(binding); } catch { /* Keep the durable intent. */ }
        if (result === 'REVOKED' || result === 'ALREADY_INVALID') {
          await mutate(async () => {
            const pending = await read();
            const remaining = pending.filter((item) => !sameBinding(item, binding));
            if (remaining.length !== pending.length) await write(remaining);
          });
        }
      }
    };
    const result = operation().finally(() => { if (state.flush === result) state.flush = null; });
    state.flush = result;
    return result;
  }

  return { enqueue, flush };
}
