import * as SecureStore from 'expo-secure-store';
import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { registerAuthExpiryHandler } from './authState';
import { createApiClient, type SessionResult } from './apiClient';
import { isDeviceSessionCredential, isLegacySessionCredential } from './authCredential';

export interface AuthSession { memberId: string; sessionToken: string; }
export type AuthStatus = 'hydrating' | 'signed-out' | 'signed-in' | 'expired';
export interface VerifiedProfile { memberId: string; displayName: string; avatarUrl: string | null; groupId: string | null; groupName: string | null; }
/**
 * Review 121 C9. The profile load used to have no state of its own: a swallowed non-401 failure
 * published signed-in with profile null, which every surface rendered as 'still loading'. The
 * account screen therefore span forever on a request that had already finished and failed.
 */
export type ProfileStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
/**
 * `epoch` increments on every identity transition - sign in, switch, expiry, sign out. It is what
 * lets a consumer tell 'signed back in with the same token' apart from 'never left', which a
 * memberId+token pair alone cannot express.
 */
export interface AuthSnapshot { status: AuthStatus; session: AuthSession | null; profile: VerifiedProfile | null; expiresAt: number | null; profileStatus: ProfileStatus; epoch: number; }
export type AuthLifecycleReason = 'session-start' | 'session-switch' | 'logout' | 'expired' | 'revoked' | 'hydrate';
export interface AuthLifecycleChange { previous: AuthSession | null; current: AuthSession | null; invalidated: AuthSession | null; reason: AuthLifecycleReason; }

interface SecureStoreLike { getItemAsync: (key: string) => Promise<string | null>; setItemAsync: (key: string, value: string) => Promise<void>; deleteItemAsync: (key: string) => Promise<void>; }
type Listener = () => void;
const listeners = new Set<Listener>();
const lifecycleListeners = new Set<(change: AuthLifecycleChange) => void>();

function fixtureSessionFromEnv(): AuthSession | null {
  const token = process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim();
  return process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' && token ? { memberId: 'fixture:self', sessionToken: token } : null;
}

const fixtureSession = fixtureSessionFromEnv();
let snapshot: AuthSnapshot = fixtureSession ? { status: 'signed-in', session: fixtureSession, profile: null, expiresAt: null, profileStatus: 'idle', epoch: 0 } : { status: 'hydrating', session: null, profile: null, expiresAt: null, profileStatus: 'idle', epoch: 0 };
let restorePromise: Promise<AuthSnapshot> | null = null;
let epoch = 0;
let authExpiryTimer: ReturnType<typeof setTimeout> | null = null;

// A profile refresh cannot extend the identity deadline or expire a later account.
function scheduleAuthExpiry(): void {
  if (authExpiryTimer !== null) clearTimeout(authExpiryTimer);
  authExpiryTimer = null;
  const { status, session, expiresAt, epoch: expectedEpoch } = snapshot;
  if (status !== 'signed-in' || !session || expiresAt === null || !Number.isFinite(expiresAt)) return;
  const delay = Math.min(2_147_483_647, Math.max(0, expiresAt * 1000 - Date.now()));
  const timer = setTimeout(() => {
    if (authExpiryTimer !== timer) return;
    authExpiryTimer = null;
    if (snapshot.status !== 'signed-in' || snapshot.epoch !== expectedEpoch
      || snapshot.expiresAt !== expiresAt || !sameSession(snapshot.session, session)) return;
    if (Date.now() >= expiresAt * 1000) markAuthExpired();
    else scheduleAuthExpiry();
  }, delay);
  authExpiryTimer = timer;
}
let configuredProfileLoader: ((session: AuthSession) => Promise<VerifiedProfile | null>) | undefined;
const ACTIVE_STORAGE_OWNER_KEY = 'qingmu.session.activeOwner.v1';
const STORAGE_OWNER_PREFIX = 'qingmu.session.owner';
const LEGACY_LOGOUT_MARKER_KEY = 'qingmu.session.logoutEpoch.v1';
let storageOwnerSequence = 0;
let activeStorageOwner: string | null = null;
let invalidatedStorageOwner: string | null = null;
let storageMutationTail: Promise<void> = Promise.resolve();
let loginAttemptSequence = 0;
let pendingLoginAttempt: AuthSessionAttempt | null = null;
let sessionTransport: { baseUrl: string; fetchImpl?: typeof fetch } = { baseUrl: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL?.trim() ?? '' };
const SESSION_REVOCATIONS_KEY = 'qingmu.session.revocations.v1';
let revocationTail: Promise<void> = Promise.resolve();
let upgradePromise: Promise<void> | null = null;

export function configureAuthSessionTransport(options: { baseUrl: string; fetchImpl?: typeof fetch }): void { sessionTransport = options; }
export interface AuthSessionAttempt { epoch: number; sequence: number; }
export function beginAuthSessionAttempt(): AuthSessionAttempt { return (pendingLoginAttempt = { epoch, sequence: ++loginAttemptSequence }); }
export function finishAuthSessionAttempt(attempt: AuthSessionAttempt): void {
  if (pendingLoginAttempt?.sequence === attempt.sequence) pendingLoginAttempt = null;
}

function readRevocations(raw: string | null): AuthSession[] {
  try {
    const values = raw ? JSON.parse(raw) : [];
    return Array.isArray(values) ? values.filter((item): item is AuthSession => item && typeof item.memberId === 'string' && typeof item.sessionToken === 'string'
      && (isDeviceSessionCredential(item.sessionToken) || isLegacySessionCredential(item.sessionToken))).map(item => ({ memberId: item.memberId, sessionToken: item.sessionToken })) : [];
  } catch { return []; }
}
async function drainSessionRevocations(): Promise<void> {
  if (!sessionTransport.baseUrl) return;
  const pending = await enqueueStorageMutation(async () => readRevocations(await SecureStore.getItemAsync(SESSION_REVOCATIONS_KEY)));
  for (const session of pending) {
    try {
      const terminal = await createApiClient({ ...sessionTransport, token: session.sessionToken, memberId: session.memberId }).revokeSession();
      if (!terminal) continue;
      await enqueueStorageMutation(async () => {
        const latest = readRevocations(await SecureStore.getItemAsync(SESSION_REVOCATIONS_KEY));
        await SecureStore.setItemAsync(SESSION_REVOCATIONS_KEY, JSON.stringify(latest.filter(item => !sameSession(item, session))));
      });
    } catch { /* Keep the encrypted tombstone for a future foreground/restart. */ }
  }
}
function queueSessionRevocation(session: AuthSession): void {
  if (!isDeviceSessionCredential(session.sessionToken) && !isLegacySessionCredential(session.sessionToken)) return;
  const persisted = enqueueStorageMutation(async () => {
    const pending = readRevocations(await SecureStore.getItemAsync(SESSION_REVOCATIONS_KEY));
    if (!pending.some(item => sameSession(item, session))) pending.push({ ...session });
    await SecureStore.setItemAsync(SESSION_REVOCATIONS_KEY, JSON.stringify(pending));
  });
  // Network I/O is deliberately outside storageMutationTail: an offline old
  // revoke cannot prevent the next account's credential from being persisted.
  revocationTail = revocationTail.then(async () => { await persisted; await drainSessionRevocations(); }).catch(() => undefined);
}
export async function flushAuthSessionRevocations(): Promise<void> {
  await storageMutationTail.catch(() => undefined);
  await revocationTail;
  await drainSessionRevocations();
}

export async function persistEstablishedAuthSession(result: SessionResult, attempt: AuthSessionAttempt): Promise<boolean> {
  const session = { memberId: result.memberId, sessionToken: result.sessionToken };
  try {
    if (attempt.epoch !== epoch || attempt.sequence !== loginAttemptSequence) { queueSessionRevocation(session); return false; }
    await persistAuthSession(session, result.expiresInSeconds);
    return isCurrentAuthSession(session);
  } finally { finishAuthSessionAttempt(attempt); }
}

/** One-time migration of an unexpired legacy app credential; never Google UI. */
export async function upgradeLegacyAuthSession(): Promise<void> {
  if (upgradePromise) return upgradePromise;
  if (pendingLoginAttempt) return;
  // Hydration owns the identity epoch until its profile request settles. An
  // upgrade must not invalidate that request or an interactive account switch.
  await storageMutationTail.catch(() => undefined);
  await restorePromise?.catch(() => undefined);
  if (upgradePromise) return upgradePromise;
  if (pendingLoginAttempt) return;
  const current = snapshot;
  if (!current.session || current.status !== 'signed-in' || !isLegacySessionCredential(current.session.sessionToken)
    || current.expiresAt === null || current.expiresAt <= Math.floor(Date.now() / 1000) || !sessionTransport.baseUrl) return;
  const session = current.session, expectedEpoch = epoch, attemptSequence = loginAttemptSequence;
  upgradePromise = (async () => {
    try {
      const result = await createApiClient({ ...sessionTransport, token: session.sessionToken, memberId: session.memberId }).upgradeSession();
      if (!result || 'error' in result || result.sessionKind !== 'device') return;
      if (epoch !== expectedEpoch || loginAttemptSequence !== attemptSequence || !isCurrentAuthSession(session) || result.memberId !== session.memberId) {
        queueSessionRevocation({ memberId: result.memberId, sessionToken: result.sessionToken }); return;
      }
      const next = { memberId: result.memberId, sessionToken: result.sessionToken };
      await persistAuthSession(next, null);
      if (current.profile && isCurrentAuthSession(next)) await persistAuthProfile(current.profile);
    } catch { /* Keep the original credential and its real deadline; retry later. */ }
  })();
  try { await upgradePromise; } finally { upgradePromise = null; }
}

function ownerKeys(owner: string) {
  return {
    token: `${STORAGE_OWNER_PREFIX}.${owner}.token`,
    member: `${STORAGE_OWNER_PREFIX}.${owner}.member`,
    expiresAt: `${STORAGE_OWNER_PREFIX}.${owner}.expiresAt`,
    profile: `${STORAGE_OWNER_PREFIX}.${owner}.profile.v1`,
  };
}

function legacyKeys() {
  return { token: 'qingmu.session.token', member: 'qingmu.session.member', expiresAt: 'qingmu.session.expiresAt', profile: 'qingmu.session.profile.v1' };
}

function allocateStorageOwner(): string {
  storageOwnerSequence += 1;
  // This is a local storage namespace, not an authentication secret. Include a
  // fresh suffix so a process restart/clock rollback cannot reuse a logout tombstone.
  return `${Date.now().toString(36)}-${storageOwnerSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function ownerFromPointer(pointer: string | null): string | null {
  return pointer?.startsWith('owner:') ? pointer.slice('owner:'.length) : null;
}

function logoutMarkerKey(owner: string): string { return `${STORAGE_OWNER_PREFIX}.${owner}.logoutEpoch`; }

/** Read-only local authority for headless consumers; never starts Google/profile I/O. */
export async function hasPersistedAuthTermination(secureStore: Pick<SecureStoreLike, 'getItemAsync'> = SecureStore): Promise<boolean> {
  const pointer = await secureStore.getItemAsync(ACTIVE_STORAGE_OWNER_KEY);
  if (pointer?.startsWith('signed-out:')) return true;
  const owner = ownerFromPointer(pointer);
  const marker = await secureStore.getItemAsync(owner ? logoutMarkerKey(owner) : LEGACY_LOGOUT_MARKER_KEY);
  return Boolean(marker && /^\d+$/.test(marker));
}

function enqueueStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = storageMutationTail.then(operation, operation);
  storageMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

function notify(): void { listeners.forEach((listener) => listener()); }
function publish(next: Omit<AuthSnapshot, 'profileStatus' | 'epoch'> & { profileStatus?: ProfileStatus; epoch?: number }): void {
  // default is a real derivation, not a guess: a profile we hold is ready, otherwise nothing has
  // been attempted yet. Only the load path below reports 'loading' / 'empty' / 'error'.
  snapshot = { ...next, profileStatus: next.profileStatus ?? (next.profile ? 'ready' : 'idle'), epoch: next.epoch ?? epoch };
  scheduleAuthExpiry();
  notify();
}
function sameSession(left: AuthSession | null, right: AuthSession | null): boolean { return Boolean(left && right && left.memberId === right.memberId && left.sessionToken === right.sessionToken); }
function emitAuthLifecycle(previous: AuthSession | null, current: AuthSession | null, reason: AuthLifecycleReason, invalidated: AuthSession | null = previous && !sameSession(previous, current) ? previous : null): void {
  if (!invalidated && sameSession(previous, current) && reason !== 'expired' && reason !== 'logout') return;
  const change = { previous, current, invalidated, reason };
  lifecycleListeners.forEach((listener) => listener(change));
  if (invalidated && reason !== 'expired') queueSessionRevocation(invalidated);
}
export function registerAuthLifecycleListener(listener: (change: AuthLifecycleChange) => void): () => void { lifecycleListeners.add(listener); return () => lifecycleListeners.delete(listener); }
export function getAuthSnapshot(): AuthSnapshot { return snapshot; }

export function createAuthSessionStore(initial: AuthSession | null) {
  let session = initial;
  return { get: () => session, set: (next: AuthSession) => { session = next; }, clear: () => { session = null; } };
}

export function getAuthSession(): AuthSession | null { return snapshot.session; }
export function isCurrentAuthSession(session: AuthSession | null): boolean {
  return Boolean(session && snapshot.status === 'signed-in' && snapshot.session?.memberId === session.memberId && snapshot.session.sessionToken === session.sessionToken);
}
export function setAuthSession(session: AuthSession): void { const previous = snapshot.session; epoch += 1; publish({ status: 'signed-in', session, profile: null, expiresAt: null }); emitAuthLifecycle(previous, session, previous && !sameSession(previous, session) ? 'session-switch' : 'session-start'); }
export function markAuthExpired(expected?: AuthSession): void {
  if (expected && !sameSession(snapshot.session, expected)) return;
  if (snapshot.status === 'expired' || snapshot.status === 'signed-out') return;
  const previous = snapshot.session;
  const revoked = Boolean(previous && isDeviceSessionCredential(previous.sessionToken));
  const owner = activeStorageOwner;
  if (revoked) activeStorageOwner = null;
  const invalidationEpoch = ++epoch;
  publish(revoked ? { status: 'expired', session: null, profile: null, expiresAt: null } : { ...snapshot, status: 'expired', epoch });
  emitAuthLifecycle(previous, null, revoked ? 'revoked' : 'expired', previous);
  if (revoked) {
    void enqueueStorageMutation(async () => {
      await SecureStore.setItemAsync(owner ? logoutMarkerKey(owner) : LEGACY_LOGOUT_MARKER_KEY, String(invalidationEpoch));
      const keys = owner ? ownerKeys(owner) : legacyKeys();
      await Promise.all([SecureStore.deleteItemAsync(keys.token), SecureStore.deleteItemAsync(keys.member), SecureStore.deleteItemAsync(keys.expiresAt), SecureStore.deleteItemAsync(keys.profile)]);
    });
  }
}
registerAuthExpiryHandler(markAuthExpired);

export function clearAuthSession(): void {
  const previous = snapshot.session;
  epoch += 1;
  restorePromise = null;
  const persistedOwner = activeStorageOwner;
  const owner = persistedOwner ?? `legacy-${epoch}`;
  activeStorageOwner = null;
  invalidatedStorageOwner = owner;
  publish({ status: 'signed-out', session: null, profile: null, expiresAt: null });
  emitAuthLifecycle(previous, null, 'logout', previous);
  const keys = ownerKeys(owner);
  const markerKey = persistedOwner ? logoutMarkerKey(owner) : LEGACY_LOGOUT_MARKER_KEY;
  void enqueueStorageMutation(async () => {
    await Promise.all([
      SecureStore.setItemAsync(markerKey, String(epoch)),
      SecureStore.deleteItemAsync(keys.token), SecureStore.deleteItemAsync(keys.member),
      SecureStore.deleteItemAsync(keys.expiresAt), SecureStore.deleteItemAsync(keys.profile),
    ]);
  });
}

export async function persistAuthSession(session: AuthSession, expiresInSeconds: number | null = 3600): Promise<void> {
  if (expiresInSeconds === null && !isDeviceSessionCredential(session.sessionToken)) throw new Error('PERSISTENT_DEVICE_SESSION_REQUIRED');
  const previous = snapshot.session;
  const nextEpoch = ++epoch;
  const expiresAt = expiresInSeconds === null ? null : Math.floor(Date.now() / 1000) + Math.max(0, Math.floor(expiresInSeconds));
  const owner = allocateStorageOwner();
  const keys = ownerKeys(owner);
  activeStorageOwner = owner;
  invalidatedStorageOwner = null;
  publish({ status: 'signed-in', session, profile: null, expiresAt });
  emitAuthLifecycle(previous, session, previous && !sameSession(previous, session) ? 'session-switch' : 'session-start');
  await enqueueStorageMutation(async () => {
    if (epoch !== nextEpoch) {
      if (!snapshot.session && invalidatedStorageOwner === owner) {
        const legacy = legacyKeys();
        await Promise.all([SecureStore.deleteItemAsync(legacy.token), SecureStore.deleteItemAsync(legacy.member), SecureStore.deleteItemAsync(legacy.expiresAt), SecureStore.deleteItemAsync(legacy.profile)]);
      }
      return;
    }
    await SecureStore.setItemAsync(ACTIVE_STORAGE_OWNER_KEY, `owner:${owner}`);
    await Promise.all([
      SecureStore.setItemAsync(keys.token, session.sessionToken), SecureStore.setItemAsync(keys.member, session.memberId),
      SecureStore.setItemAsync(keys.expiresAt, expiresAt === null ? '' : String(expiresAt)),
      SecureStore.setItemAsync('qingmu.session.token', session.sessionToken), SecureStore.setItemAsync('qingmu.session.member', session.memberId),
      SecureStore.setItemAsync('qingmu.session.expiresAt', expiresAt === null ? '' : String(expiresAt)),
    ]);
    if (epoch !== nextEpoch && !snapshot.session && invalidatedStorageOwner === owner) {
      const legacy = legacyKeys();
      await Promise.all([SecureStore.deleteItemAsync(legacy.token), SecureStore.deleteItemAsync(legacy.member), SecureStore.deleteItemAsync(legacy.expiresAt), SecureStore.deleteItemAsync(legacy.profile)]);
    }
  });
}

export async function persistAuthProfile(profile: VerifiedProfile): Promise<void> {
  if (snapshot.session?.memberId !== profile.memberId || snapshot.status === 'signed-out') return;
  const owner = activeStorageOwner;
  publish({ ...snapshot, profile, status: snapshot.status === 'expired' ? 'expired' : 'signed-in' });
  const value = JSON.stringify(profile);
  await enqueueStorageMutation(async () => {
    if (snapshot.session?.memberId !== profile.memberId || snapshot.status === 'signed-out') return;
    await SecureStore.setItemAsync(owner ? ownerKeys(owner).profile : legacyKeys().profile, value);
    if (owner) await SecureStore.setItemAsync(legacyKeys().profile, value);
  });
}

export async function hydrateAuthSnapshot(options: { secureStore?: SecureStoreLike; nowSeconds?: () => number; loadProfile?: (session: AuthSession) => Promise<VerifiedProfile | null> } = {}): Promise<AuthSnapshot> {
  if (fixtureSession && snapshot.session?.memberId === fixtureSession.memberId) {
    if (!options.loadProfile || snapshot.profile) return snapshot;
    const fixtureEpoch = ++epoch;
    try {
      const profile = await options.loadProfile(fixtureSession);
      if (epoch === fixtureEpoch && profile) publish({ ...snapshot, status: 'signed-in', profile });
    } catch { /* fixture profile can remain synthetic when the shadow is not running */ }
    return snapshot;
  }
  // A server-rejected device cannot be resurrected from the local cache while
  // its durable logout marker is still being written.
  if (snapshot.status === 'expired' && (!snapshot.session || isDeviceSessionCredential(snapshot.session.sessionToken))) return snapshot;
  if (snapshot.status === 'signed-in' && snapshot.session && !options.loadProfile) return snapshot;
  if (restorePromise) return restorePromise;
  const secureStore = options.secureStore ?? SecureStore;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  if (snapshot.status === 'signed-in' && snapshot.session) await storageMutationTail.catch(() => undefined);
  const requestEpoch = ++epoch;
  restorePromise = (async () => {
    const ownerPointer = await secureStore.getItemAsync(ACTIVE_STORAGE_OWNER_KEY);
    let owner = ownerFromPointer(ownerPointer);
    const marker = await secureStore.getItemAsync(owner ? logoutMarkerKey(owner) : LEGACY_LOGOUT_MARKER_KEY);
    if (ownerPointer?.startsWith('signed-out:') || (marker && /^\d+$/.test(marker))) {
      if (epoch !== requestEpoch) return snapshot;
      activeStorageOwner = null;
      const previous = snapshot.session;
      publish({ status: 'signed-out', session: null, profile: null, expiresAt: null });
      emitAuthLifecycle(previous, null, 'hydrate', previous);
      return snapshot;
    }
    let keys = owner ? ownerKeys(owner) : legacyKeys();
    const readKeys = async (selected: ReturnType<typeof legacyKeys>) => Promise.all([
      secureStore.getItemAsync(selected.token), secureStore.getItemAsync(selected.member),
      secureStore.getItemAsync(selected.expiresAt), secureStore.getItemAsync(selected.profile),
    ]);
    let [sessionToken, memberId, expiresAtValue, profileValue] = await readKeys(keys);
    if (owner && (!sessionToken?.trim() || !memberId?.trim())) {
      owner = null;
      keys = legacyKeys();
      [sessionToken, memberId, expiresAtValue, profileValue] = await readKeys(keys);
    }
    if (epoch !== requestEpoch) return snapshot;
    activeStorageOwner = owner;
    if (!sessionToken?.trim() || !memberId?.trim()) { const previous = snapshot.session; publish({ status: 'signed-out', session: null, profile: null, expiresAt: null }); emitAuthLifecycle(previous, null, 'hydrate', previous); return snapshot; }
    const session = { memberId: memberId.trim(), sessionToken: sessionToken.trim() };
    const parsedExpiry = expiresAtValue ? Number(expiresAtValue) : null;
    const expiresAt = parsedExpiry !== null && Number.isFinite(parsedExpiry) ? parsedExpiry : null;
    let profile: VerifiedProfile | null = null;
    if (profileValue) { try { const cached = JSON.parse(profileValue) as VerifiedProfile; if (cached.memberId === session.memberId) profile = cached; } catch { profile = null; } }
    let status: AuthStatus = expiresAt !== null && expiresAt <= nowSeconds() ? 'expired' : 'signed-in';
    const previousSession = snapshot.session;
    publish({ status, session, profile, expiresAt });
    emitAuthLifecycle(previousSession, status === 'signed-in' ? session : null, 'hydrate', status === 'expired' ? session : (previousSession && !sameSession(previousSession, session) ? previousSession : null));
    if (status === 'signed-in' && options.loadProfile) {
      publish({ status, session, profile, expiresAt, profileStatus: profile ? 'ready' : 'loading' });
      let profileStatus: ProfileStatus = profile ? 'ready' : 'loading';
      try {
        const loaded = await options.loadProfile(session);
        if (epoch !== requestEpoch) return snapshot;
        if (loaded && loaded.memberId === session.memberId) {
          profile = loaded;
          profileStatus = 'ready';
          await enqueueStorageMutation(async () => {
            if (epoch === requestEpoch) await secureStore.setItemAsync(keys.profile, JSON.stringify(loaded));
          });
        } else {
          // the request FINISHED and returned nothing usable for this member. That is 'empty', not
          // 'still loading', and the surface must be able to tell the difference.
          profileStatus = profile ? 'ready' : 'empty';
        }
      } catch {
        // API 401 marks the shared snapshot expired; any other failure keeps whatever identity we had
        // cached but must be REPORTED, so the account screen can offer a real retry instead of spinning.
        profileStatus = profile ? 'ready' : 'error';
      }
      if (epoch !== requestEpoch) return snapshot;
      status = snapshot.status === 'expired' ? 'expired' : 'signed-in';
      publish({ status, session, profile, expiresAt, profileStatus });
    }
    return snapshot;
  })();
  try { return await restorePromise; } finally { restorePromise = null; }
}

export async function retryAuthProfile(): Promise<AuthSnapshot> {
  if (!configuredProfileLoader || snapshot.status !== 'signed-in' || !snapshot.session) return snapshot;
  return hydrateAuthSnapshot({ loadProfile: configuredProfileLoader });
}

export async function restoreAuthSession(): Promise<AuthSession | null> { if (snapshot.status === 'signed-in' || snapshot.status === 'expired') return snapshot.session; return (await hydrateAuthSnapshot()).session; }

export function useAuthSnapshot(): AuthSnapshot {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getAuthSnapshot, getAuthSnapshot);
}
export function useAuthSession(): AuthSession | null { return useAuthSnapshot().session; }

const AuthContext = createContext<AuthSnapshot>(snapshot);
export function AuthProvider({ children, loadProfile }: { children: ReactNode; loadProfile?: (session: AuthSession) => Promise<VerifiedProfile | null> }) {
  const current = useAuthSnapshot();
  configuredProfileLoader = loadProfile;
  useEffect(() => { void hydrateAuthSnapshot({ loadProfile }); }, [loadProfile]);
  useEffect(() => { void flushAuthSessionRevocations(); }, [current.status, current.session?.sessionToken]);
  useEffect(() => {
    let alive = true;
    let subscription: { remove(): void } | undefined;
    void import('react-native').then(({ AppState }) => {
      if (!alive) return;
      subscription = AppState.addEventListener('change', state => {
        if (alive && state === 'active') { void flushAuthSessionRevocations(); void upgradeLegacyAuthSession(); }
      });
    }).catch(() => { /* A later provider mount will attach the native foreground listener. */ });
    return () => { alive = false; subscription?.remove(); };
  }, []);
  useEffect(() => { if (current.status === 'signed-in') void upgradeLegacyAuthSession(); }, [current.status, current.session?.sessionToken]);
  useEffect(() => {
    if (current.status === 'signed-in' && current.session && !current.profile && loadProfile) void hydrateAuthSnapshot({ loadProfile });
  }, [current.status, current.session?.memberId, current.session?.sessionToken, current.profile, loadProfile]);
  return createElement(AuthContext.Provider, { value: current }, children);
}
export function useAuthContext(): AuthSnapshot { return useContext(AuthContext); }

export function createAuthSessionController(options: { secureStore?: SecureStoreLike; nowSeconds?: () => number } = {}) {
  const secureStore = options.secureStore ?? SecureStore;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  let localSnapshot: AuthSnapshot = { status: 'hydrating', session: null, profile: null, expiresAt: null, profileStatus: 'idle', epoch: 0 };
  return {
    async hydrate(): Promise<AuthSnapshot> {
      const [sessionToken, memberId, expiresAtValue, profileValue] = await Promise.all([
        secureStore.getItemAsync('qingmu.session.token'), secureStore.getItemAsync('qingmu.session.member'), secureStore.getItemAsync('qingmu.session.expiresAt'), secureStore.getItemAsync('qingmu.session.profile.v1'),
      ]);
      if (!sessionToken?.trim() || !memberId?.trim()) return (localSnapshot = { status: 'signed-out', session: null, profile: null, expiresAt: null, profileStatus: 'idle', epoch: localSnapshot.epoch + 1 });
      const expiresAt = expiresAtValue ? Number(expiresAtValue) : null;
      let profile: VerifiedProfile | null = null;
      try { profile = profileValue ? JSON.parse(profileValue) as VerifiedProfile : null; } catch { profile = null; }
      return (localSnapshot = { status: expiresAt !== null && expiresAt <= nowSeconds() ? 'expired' : 'signed-in', session: { memberId: memberId.trim(), sessionToken: sessionToken.trim() }, profile, expiresAt, profileStatus: profile ? 'ready' : 'idle', epoch: localSnapshot.epoch + 1 });
    },
    getSnapshot: (): AuthSnapshot => localSnapshot,
    markExpired: (): void => { localSnapshot = { ...localSnapshot, status: 'expired' }; },
  };
}
