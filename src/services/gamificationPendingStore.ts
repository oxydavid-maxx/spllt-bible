import * as SecureStore from 'expo-secure-store';

export interface PendingRedemptionOperation { operationId: string; memberId: string; rewardId: string; expectedRewardRevision: number; }
export interface PendingReverseOperation { operationId: string; redemptionId: string; reason: string; }
export interface PendingGamificationOperations { ownerMemberId: string; redemptions: PendingRedemptionOperation[]; reversals: PendingReverseOperation[]; }
export interface GamificationPendingStore { read: (memberId: string) => Promise<PendingGamificationOperations | null>; write: (memberId: string, state: PendingGamificationOperations) => Promise<void>; clear: (memberId: string) => Promise<void>; }

export class GamificationPendingStoreError extends Error {
  readonly code: 'PENDING_STORAGE_ERROR' | 'PENDING_DATA_INVALID';
  constructor(code: 'PENDING_STORAGE_ERROR' | 'PENDING_DATA_INVALID') {
    super(code);
    this.name = 'GamificationPendingStoreError';
    this.code = code;
  }
}

interface SecureStoreAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

function cloneState(value: PendingGamificationOperations): PendingGamificationOperations {
  return { ownerMemberId: value.ownerMemberId, redemptions: value.redemptions.map((row) => ({ ...row })), reversals: value.reversals.map((row) => ({ ...row })) };
}

// Four fixed hexadecimal digits per UTF-16 code unit are injective for JavaScript strings and
// stay inside Expo SecureStore's installed /^[\w.-]+$/ key contract.
export function pendingStorageKey(memberId: string): string {
  const encoded = Array.from({ length: memberId.length }, (_, index) => memberId.charCodeAt(index).toString(16).padStart(4, '0')).join('');
  return `qingmu.gamification.pending.v1.${encoded || 'empty'}`;
}

function parseState(value: unknown, memberId: string): PendingGamificationOperations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GamificationPendingStoreError('PENDING_DATA_INVALID');
  const item = value as Partial<PendingGamificationOperations>;
  if (item.ownerMemberId !== memberId || !Array.isArray(item.redemptions) || !Array.isArray(item.reversals)) throw new GamificationPendingStoreError('PENDING_DATA_INVALID');
  const redemptionsValid = item.redemptions.every((row) => Boolean(row) && typeof row === 'object'
    && typeof row.operationId === 'string' && typeof row.memberId === 'string' && typeof row.rewardId === 'string'
    && Number.isInteger(row.expectedRewardRevision) && row.expectedRewardRevision > 0);
  const reversalsValid = item.reversals.every((row) => Boolean(row) && typeof row === 'object'
    && typeof row.operationId === 'string' && typeof row.redemptionId === 'string'
    && typeof row.reason === 'string' && Boolean(row.reason.trim()));
  if (!redemptionsValid || !reversalsValid) throw new GamificationPendingStoreError('PENDING_DATA_INVALID');
  return cloneState(item as PendingGamificationOperations);
}

function asStorageError(reason: unknown): GamificationPendingStoreError {
  return reason instanceof GamificationPendingStoreError ? reason : new GamificationPendingStoreError('PENDING_STORAGE_ERROR');
}

export function createGamificationPendingStore(secureStore: SecureStoreAdapter): GamificationPendingStore {
  return {
    async read(memberId) {
      try {
        const raw = await secureStore.getItemAsync(pendingStorageKey(memberId));
        if (raw === null) return null;
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new GamificationPendingStoreError('PENDING_DATA_INVALID'); }
        return parseState(value, memberId);
      } catch (reason) { throw asStorageError(reason); }
    },
    async write(memberId, state) {
      try {
        const safe = parseState(state, memberId);
        await secureStore.setItemAsync(pendingStorageKey(memberId), JSON.stringify(safe));
      } catch (reason) { throw asStorageError(reason); }
    },
    async clear(memberId) {
      try { await secureStore.deleteItemAsync(pendingStorageKey(memberId)); }
      catch (reason) { throw asStorageError(reason); }
    },
  };
}

export function createDefaultGamificationPendingStore(): GamificationPendingStore {
  return createGamificationPendingStore(SecureStore);
}
