import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientHeaders, setClientInfo, withClientHeaders } from '../../src/services/clientInfo';
import { CLIENT_INSTALL_KEY, startClientInfo, type ClientInfoSources } from '../../src/services/clientInfoNative';
import { createApiClient } from '../../src/services/apiClient';
import { createGamificationApiClient } from '../../src/services/gamificationApiClient';

// 光佑 (2026-10-21): record which version each phone runs and the last day it was opened. The app says it on
// every request to its own server (server/clientInstalls.ts): platform, store version, build, the running OTA
// update and a random installation id. Nothing else, and never to anyone else.
const INSTALL = '0f0e0d0c-0b0a-4908-8706-050403020100';
const UPDATE = '019a3c1e-7d4f-7b2e-9c41-5e8f2abff271';
afterEach(() => setClientInfo(null));

describe('what the app says about itself', () => {
  it('says nothing until the installation is known', () => {
    expect(clientHeaders()).toEqual({});
  });

  it('names the platform, store version, build, running update and installation', () => {
    setClientInfo({ installId: INSTALL, platform: 'android', version: '0.5.35', build: '60', updateId: UPDATE });
    expect(clientHeaders()).toEqual({
      'x-qingmu-client-install': INSTALL, 'x-qingmu-client-platform': 'android', 'x-qingmu-client-version': '0.5.35',
      'x-qingmu-client-build': '60', 'x-qingmu-client-update': UPDATE,
    });
  });

  it('leaves out what the phone cannot tell, such as the store build\'s own embedded copy', () => {
    setClientInfo({ installId: INSTALL, platform: 'ios', version: '0.5.35', build: null, updateId: null });
    expect(clientHeaders()).toEqual({ 'x-qingmu-client-install': INSTALL, 'x-qingmu-client-platform': 'ios', 'x-qingmu-client-version': '0.5.35' });
  });

  it('adds the headers to a request without dropping the request\'s own', async () => {
    setClientInfo({ installId: INSTALL, platform: 'android', version: '0.5.35', build: '60', updateId: null });
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await withClientHeaders(fetchImpl as unknown as typeof fetch)('https://api.test/x', { method: 'POST', headers: { authorization: 'Bearer t' } });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/x', { method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer t', 'x-qingmu-client-version': '0.5.35' }) });
  });

  it('passes a request through untouched before the installation is known', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const init = { headers: { authorization: 'Bearer t' } };
    await withClientHeaders(fetchImpl as unknown as typeof fetch)('https://api.test/x', init);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/x', init);
  });
});

describe('where the app learns it', () => {
  const sources = (store: Map<string, string>, overrides: Partial<ClientInfoSources> = {}): ClientInfoSources => ({
    platform: 'android', version: '0.5.35', build: '60', update: { isEmbeddedLaunch: false, updateId: UPDATE },
    store: { getItemAsync: async (key) => store.get(key) ?? null, setItemAsync: async (key, value) => { store.set(key, value); } },
    newId: () => INSTALL, ...overrides,
  });

  it('creates one random installation id, keeps it on the phone and reuses it', async () => {
    const store = new Map<string, string>();
    await startClientInfo(sources(store));
    expect(store.get(CLIENT_INSTALL_KEY)).toBe(INSTALL);
    expect(clientHeaders()['x-qingmu-client-install']).toBe(INSTALL);
    const newId = vi.fn(() => 'another');
    await startClientInfo(sources(store, { newId }));
    expect(newId).not.toHaveBeenCalled();
    expect(clientHeaders()['x-qingmu-client-install']).toBe(INSTALL);
  });

  it('names the running update only when it is a downloaded one', async () => {
    await startClientInfo(sources(new Map(), { update: { isEmbeddedLaunch: true, updateId: UPDATE } }));
    expect(clientHeaders()['x-qingmu-client-update']).toBeUndefined();
  });

  it('says nothing when the version cannot be read, on the web, or when the phone storage fails', async () => {
    await startClientInfo(sources(new Map(), { version: null }));
    expect(clientHeaders()).toEqual({});
    await startClientInfo(sources(new Map(), { platform: 'web' }));
    expect(clientHeaders()).toEqual({});
    await startClientInfo(sources(new Map(), { store: { getItemAsync: async () => { throw new Error('locked'); }, setItemAsync: async () => undefined } }));
    expect(clientHeaders()).toEqual({});
  });
});

describe('every request to the server carries it', () => {
  it('the profile read at every start and return to the foreground', async () => {
    setClientInfo({ installId: INSTALL, platform: 'ios', version: '0.5.35', build: '60', updateId: UPDATE });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ displayName: 'x' })));
    await createApiClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl: fetchImpl as unknown as typeof fetch }).getProfile();
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-qingmu-client-update': UPDATE });
  });

  it('the points requests', async () => {
    setClientInfo({ installId: INSTALL, platform: 'android', version: '0.5.35', build: '60', updateId: null });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ canViewAllScores: false }), { headers: { 'content-type': 'application/json' } }));
    await createGamificationApiClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl: fetchImpl as unknown as typeof fetch }).getCapabilities().catch(() => undefined);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-qingmu-client-install': INSTALL });
  });

  it('every module that sends a signed-in request builds its fetch with withClientHeaders', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path.replaceAll('\\', '/')] : [];
    });
    // reminderDelivery.ts talks to Firebase (FCM), not to this app's server; it must not carry these headers.
    const elsewhere = new Set(['src/services/reminderDelivery.ts', 'src/services/clientInfo.ts']);
    const missing = [...walk('src'), ...walk('app')]
      .filter((path) => !elsewhere.has(path))
      .filter((path) => { const text = readFileSync(path, 'utf8'); return /Bearer \$\{/.test(text) && !text.includes('withClientHeaders('); });
    expect(missing).toEqual([]);
    expect(readFileSync('src/services/reminderDelivery.ts', 'utf8')).not.toContain('withClientHeaders(');
  });
});
