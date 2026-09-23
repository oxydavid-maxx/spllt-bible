/**
 * Stand-in for expo-crypto in the node test environment.
 *
 * Same reason as the other doubles here: the real module reaches expo-modules-core's native registry
 * at import time, so any component test that renders a screen calling randomUUID fails to load
 * rather than fails an assertion.
 *
 * It delegates to node's own crypto rather than returning a fixed value. A constant UUID would make
 * every operation id in a test identical, and the idempotency this app relies on — an outbox that
 * de-duplicates by operation id, a mutation receipt keyed on one — would then appear to work in a
 * test for the opposite of the real reason.
 */
import { randomUUID as nodeRandomUUID } from 'node:crypto';

export function randomUUID(): string {
  return nodeRandomUUID();
}

export function getRandomBytes(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount);
  for (let index = 0; index < byteCount; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export const getRandomBytesAsync = async (byteCount: number): Promise<Uint8Array> => getRandomBytes(byteCount);
