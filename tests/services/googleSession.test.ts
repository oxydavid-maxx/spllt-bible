import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: { OS: 'android' }, read: vi.fn(), modules: {} as Record<string, unknown> }));
vi.mock('react-native', () => ({ Platform: native.platform, NativeModules: native.modules }));
import { establishGoogleSession } from '../../src/services/googleSession';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); native.platform.OS = 'android'; });

describe('Android Test Lab setting reaches the Google session POST', () => {
  it.each([true, false])('carries native %s through the real client, route and isolated database', async (signal) => {
    const database = createDatabase();
    try {
      native.modules.QingmuTestLab = { isRunningInTestLab: native.read.mockResolvedValue(signal) };
      const api = createApiHandler({ db: database, sessionSecret: 'test-secret', autoProvisionGoogleMembers: true,
        productionGoogleAuth: { verify: async () => ({ provider: 'google' as const, subject: 'synthetic' }), resolveMember: async () => null } });
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        const result = await api({ method: init.method!, url, headers: { ...(init.headers as Record<string, string>), 'cf-connecting-ip': '192.0.2.10' }, body: String(init.body) });
        return new Response(JSON.stringify(result.body), { status: result.status });
      });
      const result = await establishGoogleSession('https://api.example.test', 'synthetic-token');
      if (signal) {
        expect(result).toEqual({ status: 403, error: 'ACCOUNT_DISABLED' });
        expect(database.db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 });
      } else {
        expect(result).toMatchObject({ memberId: expect.any(String), sessionToken: expect.any(String) });
        expect(database.db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({ count: 1 });
      }
    } finally { database.close(); }
  });

  it.each([true, false])('reads the native setting at login and sends %s', async (value) => {
    native.modules.QingmuTestLab = { isRunningInTestLab: native.read.mockResolvedValue(value) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);
    await establishGoogleSession('https://api.example.test', 'synthetic-token');
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ session_type: 'device', firebase_test_lab: value });
  });

  it('does not read or send the Android-only setting on iOS', async () => {
    native.platform.OS = 'ios';
    Object.defineProperty(native.modules, 'QingmuTestLab', { configurable: true, get: () => { throw new Error('Android bridge accessed on iOS'); } });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);
    await establishGoogleSession('https://api.example.test', 'synthetic-token');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ session_type: 'device' });
    delete native.modules.QingmuTestLab;
  });

  it.each(['missing', 'throws'])('keeps login working when the Android bridge %s', async (failure) => {
    native.modules.QingmuTestLab = failure === 'missing' ? undefined : { isRunningInTestLab: native.read.mockRejectedValue(new Error('unavailable')) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);
    await establishGoogleSession('https://api.example.test', 'synthetic-token');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ session_type: 'device' });
  });
});
