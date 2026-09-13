import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Module from 'node:module';
vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL = 'https://in-memory.test'; });
const storage = vi.hoisted(() => new Map<string, string>());
const storageGate = vi.hoisted(() => ({ beforeWrite: null as null | ((key: string) => Promise<void>) }));
const foreground = vi.hoisted(() => ({ callback: null as null | ((state: string) => void) }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => { const R = require('react'); return R.createElement(name, props, props.children); });
vi.mock('react-native', () => ({ View: primitive('View'), Text: primitive('Text'), TextInput: primitive('TextInput'), Pressable: primitive('Pressable'), StyleSheet: { create: (x: unknown) => x }, AppState: { addEventListener: (_: string, callback: (state: string) => void) => { foreground.callback = callback; return { remove: () => { foreground.callback = null; } }; } } }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => storage.get(key) ?? null, setItemAsync: async (key: string, value: string) => { await storageGate.beforeWrite?.(key); storage.set(key, value); }, deleteItemAsync: async (key: string) => { storage.delete(key); } }));
let auth: any, createClient: any;
let db: ReturnType<typeof createDatabase>, handler: ReturnType<typeof createApiHandler>;
let googleCalls: number, offline: boolean;
let transport: typeof fetch;
let onOnlineRevoke: (() => void) | null;
let view: TestRenderer.ReactTestRenderer | null;
const baseUrl = 'https://in-memory.test';
const header = (token: string) => ({ authorization: `Bearer ${token}` });
async function loadAuth() {
  auth = await import('../src/services/authSession');
  createClient = (await import('../src/services/apiClient')).createApiClient;
  auth.configureAuthSessionTransport?.({ baseUrl, fetchImpl: transport });
}
async function exchange(member: string, persistentDevice = true) {
  return createClient({ baseUrl, token: '', memberId: '', fetchImpl: transport }).establishSession(`test-google-${member}`, { persistentDevice });
}
async function commit(result: any) {
  expect(result?.sessionKind).toBe('device');
  await auth.persistAuthSession({ memberId: result.memberId, sessionToken: result.sessionToken }, result.expiresInSeconds);
}
const profile = (session: { memberId: string; sessionToken: string }, fetchImpl = transport) => createClient({ baseUrl, token: session.sessionToken, memberId: session.memberId, fetchImpl }).getProfile();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-09-13T00:00:00Z'); vi.resetModules(); storage.clear(); storageGate.beforeWrite = null; googleCalls = 0; offline = false; onOnlineRevoke = null; view = null; foreground.callback = null;
  db = createDatabase({ filename: ':memory:', members: [{ id: 'A', displayName: 'Test A', groupId: 'G' }, { id: 'B', displayName: 'Test B', groupId: 'G' }] });
  handler = createApiHandler({ db, sessionSecret: 'test-session-signing-secret', productionGoogleAuth: {
    verify: async token => { if (!['test-google-A', 'test-google-B'].includes(token)) throw new Error('invalid synthetic Google token'); googleCalls++; return { subject: token.slice(-1), provider: 'google' }; }, resolveMember: async value => value.subject,
  } });
  transport = async (input, init) => {
    if (offline) throw new Error('synthetic offline');
    const url = String(input); if (!url.startsWith(baseUrl)) throw new Error('Unexpected test transport target');
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const result = await handler({ method: init?.method ?? 'GET', url, headers, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/api/session/revoke')) onOnlineRevoke?.();
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  };
  vi.stubGlobal('fetch', transport);
  await loadAuth();
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); offline = false; auth.clearAuthSession(); await auth.flushAuthSessionRevocations?.(); db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('actual App auth/storage/client to isolated server handler', () => {
  it('exposes persisted termination to cold headless consumers without mixing a later active owner', async () => {
    const a = await exchange('A'); await commit(a);
    expect(await auth.hasPersistedAuthTermination()).toBe(false);
    await handler({ method: 'POST', url: '/api/session/revoke', headers: header(a.sessionToken) }); await profile(a); await auth.flushAuthSessionRevocations();
    vi.resetModules(); await loadAuth();
    expect(auth.getAuthSnapshot().status).toBe('hydrating');
    expect(await auth.hasPersistedAuthTermination()).toBe(true);
    const b = await exchange('B'); await commit(b);
    expect(await auth.hasPersistedAuthTermination()).toBe(false);
  });
  it('distinguishes rejected persistent credentials from legacy natural expiry for lifecycle consumers', async () => {
    const events: any[] = []; const unsubscribe = auth.registerAuthLifecycleListener((event: any) => events.push(event));
    try {
      const a = await exchange('A'); await commit(a); events.length = 0;
      await handler({ method: 'POST', url: '/api/session/revoke', headers: header(a.sessionToken) }); await profile(a);
      expect(events.map(event => event.reason)).toEqual(['revoked']);
      expect(events[0].invalidated.memberId).toBe('A'); expect(events[0].current).toBeNull();
      expect(auth.getAuthSnapshot()).toMatchObject({ status: 'expired', session: null });
      const legacy = await exchange('B', false); await auth.persistAuthSession(legacy, legacy.expiresInSeconds); events.length = 0;
      await vi.advanceTimersByTimeAsync(3601_000);
      expect(events.map(event => event.reason)).toEqual(['expired']);
      expect(auth.getAuthSnapshot().session.memberId).toBe('B');
    } finally { unsubscribe(); }
  });
  it('cannot rehydrate a known revoked device while its logout marker is still writing', async () => {
    const a = await exchange('A'); await commit(a);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    storageGate.beforeWrite = key => key.endsWith('.logoutEpoch') ? gate : Promise.resolve();
    try {
      await handler({ method: 'POST', url: '/api/session/revoke', headers: header(a.sessionToken) });
      await profile(a);
      expect((await auth.hydrateAuthSnapshot()).status).toBe('expired');
    } finally { release(); storageGate.beforeWrite = null; await auth.flushAuthSessionRevocations(); }
  });
  it('does not let background legacy migration invalidate an ongoing Google account switch', async () => {
    const a = await exchange('A', false); await auth.persistAuthSession(a, a.expiresInSeconds);
    const attempt = auth.beginAuthSessionAttempt();
    await auth.upgradeLegacyAuthSession();
    const b = await exchange('B');
    expect(await auth.persistEstablishedAuthSession(b, attempt)).toBe(true);
    expect(auth.getAuthSnapshot().session.memberId).toBe('B');
  });
  it('waits for legacy profile hydration and retains its profile during transparent migration', async () => {
    const a = await exchange('A', false); await auth.persistAuthSession(a, a.expiresInSeconds);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void; const observed = new Promise<void>(resolve => { started = resolve; });
    const hydration = auth.hydrateAuthSnapshot({ loadProfile: async (session: any) => { started(); await gate; return profile(session); } });
    await observed;
    const migration = auth.upgradeLegacyAuthSession();
    release(); await hydration; await migration;
    expect(auth.getAuthSnapshot().expiresAt).toBeNull();
    expect(auth.getAuthSnapshot().profile?.memberId).toBe('A');
    expect(googleCalls).toBe(1);
  });
  it('the real GoogleLoginCard requests and persists a device session with one native Google invocation', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-web-client';
    let nativeCalls = 0;
    const native = { GoogleOneTapSignIn: { configure() {}, checkPlayServices: async () => {}, signIn: async () => { nativeCalls++; return { data: { idToken: 'test-google-A' } }; }, createAccount: async () => { throw new Error('unexpected picker'); }, presentExplicitSignIn: async () => { throw new Error('unexpected picker'); } }, isSuccessResponse: (value: any) => Boolean(value?.data?.idToken), isNoSavedCredentialFoundResponse: () => false, isCancelledResponse: () => false };
    const originalLoad = (Module as any)._load;
    vi.spyOn(Module as any, '_load').mockImplementation(function(this: unknown, ...args: unknown[]) { return args[0] === 'react-native-nitro-google-signin' ? native : originalLoad.apply(this, args); });
    const { GoogleLoginCard } = await import('../src/ui/GoogleLoginCard');
    await act(async () => { view = TestRenderer.create(React.createElement(GoogleLoginCard, { baseUrl })); });
    await act(async () => { view!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '使用Google登入')[0].props.onPress(); });
    expect(auth.getAuthSnapshot().status).toBe('signed-in'); expect(auth.getAuthSnapshot().expiresAt).toBeNull();
    await vi.advanceTimersByTimeAsync(3601_000); expect(auth.getAuthSnapshot().status).toBe('signed-in'); expect(nativeCalls).toBe(1);
  });
  it('the real AuthProvider retries a durable offline logout revoke on native foreground', async () => {
    const a = await exchange('A'); await commit(a);
    await act(async () => { view = TestRenderer.create(React.createElement(auth.AuthProvider, { children: null })); });
    offline = true; await act(async () => auth.clearAuthSession()); await auth.flushAuthSessionRevocations();
    offline = false; const observed = new Promise<void>(resolve => { onOnlineRevoke = resolve; });
    await vi.dynamicImportSettled();
    expect(typeof foreground.callback).toBe('function');
    await act(async () => { foreground.callback!('active'); await observed; });
    expect((await handler({ method: 'GET', url: '/api/me/profile', headers: header(a.sessionToken) })).status).toBe(401);
    expect(auth.getAuthSnapshot().status).toBe('signed-out');
  });
  it('stays signed in across one hour, the next day and a cold App module without another Google call', async () => {
    const login = await exchange('A'); await commit(login);
    expect(auth.getAuthSnapshot().expiresAt).toBeNull();
    await vi.advanceTimersByTimeAsync(3601_000); expect(auth.getAuthSnapshot().status).toBe('signed-in');
    vi.setSystemTime('2026-09-14T12:00:00Z');
    vi.resetModules(); await loadAuth();
    const restored = await auth.hydrateAuthSnapshot({ loadProfile: profile });
    expect(restored.status).toBe('signed-in'); expect(restored.profile?.memberId).toBe('A'); expect(googleCalls).toBe(1);
  });
  it('revokes A on switch, keeps B valid and ignores A late401 without clearing B storage', async () => {
    const a = await exchange('A'); await commit(a);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const oldProfile = profile(a, async (input, init) => { await gate; return transport(input, init); });
    const b = await exchange('B'); await commit(b); await auth.flushAuthSessionRevocations();
    expect((await handler({ method: 'GET', url: '/api/me/profile', headers: header(a.sessionToken) })).status).toBe(401);
    release(); await oldProfile;
    expect(auth.getAuthSnapshot().session?.memberId).toBe('B'); expect(auth.getAuthSnapshot().status).toBe('signed-in');
    vi.resetModules(); await loadAuth();
    expect((await auth.hydrateAuthSnapshot({ loadProfile: profile })).session?.memberId).toBe('B');
  });
  it('logout persists independently of a new owner and retries exact server revocation after offline restart', async () => {
    const a = await exchange('A'); await commit(a);
    storage.set('qingmu.reader.preferences.keep', 'synthetic-preferences'); offline = true;
    auth.clearAuthSession(); await auth.flushAuthSessionRevocations(); expect(auth.getAuthSnapshot().status).toBe('signed-out');
    vi.resetModules(); await loadAuth(); expect((await auth.hydrateAuthSnapshot()).status).toBe('signed-out');
    offline = false; const b = await exchange('B'); await commit(b); await auth.flushAuthSessionRevocations();
    expect((await handler({ method: 'GET', url: '/api/me/profile', headers: header(a.sessionToken) })).status).toBe(401);
    expect((await profile(b))?.memberId).toBe('B'); expect(storage.get('qingmu.reader.preferences.keep')).toBe('synthetic-preferences');
  });
  it('server device revocation ends the session durably and cannot trigger silent re-login', async () => {
    const a = await exchange('A'); await commit(a);
    await handler({ method: 'POST', url: '/api/session/revoke', headers: header(a.sessionToken) });
    await profile(a); await auth.flushAuthSessionRevocations();
    expect(auth.getAuthSnapshot().status).not.toBe('signed-in');
    vi.resetModules(); await loadAuth(); expect((await auth.hydrateAuthSnapshot()).status).toBe('signed-out'); expect(googleCalls).toBe(1);
  });
  it('account disablement ends a persistent session without erasing preferences', async () => {
    const a = await exchange('A'); await commit(a); storage.set('qingmu.reader.preferences.keep', 'keep');
    db.db.prepare('UPDATE members SET disabled_at=1 WHERE id=?').run('A'); await profile(a); await auth.flushAuthSessionRevocations();
    expect(auth.getAuthSnapshot().status).not.toBe('signed-in'); expect(storage.get('qingmu.reader.preferences.keep')).toBe('keep');
  });
  it('fences a late old Google exchange and revokes its unused credential', async () => {
    expect(typeof auth.beginAuthSessionAttempt).toBe('function');
    const attemptA = auth.beginAuthSessionAttempt(); const a = await exchange('A');
    const attemptB = auth.beginAuthSessionAttempt(); const b = await exchange('B');
    expect(await auth.persistEstablishedAuthSession(b, attemptB)).toBe(true);
    expect(await auth.persistEstablishedAuthSession(a, attemptA)).toBe(false);
    await auth.flushAuthSessionRevocations();
    expect(auth.getAuthSnapshot().session?.memberId).toBe('B');
    expect((await handler({ method: 'GET', url: '/api/me/profile', headers: header(a.sessionToken) })).status).toBe(401);
    expect((await profile(b))?.memberId).toBe('B');
  });
  it('upgrades a still-valid legacy session in the background without another Google exchange', async () => {
    const a = await exchange('A', false); expect(a.expiresInSeconds).toBe(3600);
    await auth.persistAuthSession({ memberId: a.memberId, sessionToken: a.sessionToken }, a.expiresInSeconds);
    expect(typeof auth.upgradeLegacyAuthSession).toBe('function');
    await auth.upgradeLegacyAuthSession();
    expect(auth.getAuthSnapshot().expiresAt).toBeNull(); expect(googleCalls).toBe(1);
    vi.setSystemTime('2026-09-14T12:00:00Z'); expect((await profile(auth.getAuthSnapshot().session))?.memberId).toBe('A');
  });
});
