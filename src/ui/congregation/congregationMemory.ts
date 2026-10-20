import type { Congregation } from '../../services/devotionClient';

/**
 * What this phone last saw of a member's 青少/主堂 (維護者 2026-10-20). When the server cannot be read, a phone
 * that has seen the member's choice uses it and does not ask; a phone that never saw it asks (CongregationGate).
 * One small value per member in SecureStore, the same store as the member's own points cache. Loaded only when
 * used, and every failure reads as "never seen": a phone that cannot remember still asks, it never skips.
 */
const KEY_PREFIX = 'qingmu.congregation.v1.';
// SecureStore accepts only alphanumerics, '.', '-' and '_'; member IDs include ':' (same rule as profileCache).
const key = (memberId: string) => `${KEY_PREFIX}${Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_')}`;

export async function recallCongregation(memberId: string): Promise<Congregation | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const value = await SecureStore.getItemAsync(key(memberId));
    return value === 'youth' || value === 'main' ? value : null;
  } catch { return null; }
}

export async function rememberCongregation(memberId: string, value: Congregation | null): Promise<void> {
  try {
    const SecureStore = await import('expo-secure-store');
    if (value) await SecureStore.setItemAsync(key(memberId), value);
    else await SecureStore.deleteItemAsync(key(memberId));
  } catch { /* A phone that cannot remember still asks; nothing else depends on this. */ }
}
