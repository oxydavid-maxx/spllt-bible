import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import { createSessionToken } from '../server/session';
import { registerDeviceDeliveryToken } from '../server/reminderPreferences';

const opened: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { for (const database of opened.splice(0)) database.close(); });
function assembled() {
  const database = createDatabase({ members: [{ id: 'test:a', displayName: 'A', groupId: 'test:g1' }, { id: 'test:b', displayName: 'B', groupId: 'test:g2' }] }); opened.push(database);
  const secret = 'isolated-device-revoke-secret';
  const api = createApiHandler({ db: database, authMode: 'google-only', sessionSecret: secret, productionGoogleAuth: { verify: async () => { throw new Error('No real OAuth'); }, resolveMember: async () => null } });
  const initial = registerDeviceDeliveryToken(database.db, { memberId: 'test:a', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 5 });
  const body = { member_id: 'test:a', binding_version: initial.bindingVersion, owner_generation: initial.ownerGeneration };
  const headers = { 'x-qingmu-installation-id': 'test:installation', 'x-qingmu-device-token': 'isolated-token', authorization: `Bearer ${createSessionToken('test:a', secret, Math.floor(Date.now()/1000)-10, 1)}` };
  const request = (nextBody = body, nextHeaders: Record<string, string> = headers) => api({ method: 'POST', url: '/api/device/reminders/revoke', headers: nextHeaders, body: JSON.stringify(nextBody) });
  return { database, api, request, body, headers };
}
describe('expired-session-safe exact device binding revoke', () => {
  it('revokes only the device binding despite an expired interactive session', async () => {
    const { request, database } = assembled();
    const membersBefore = database.db.prepare('SELECT * FROM members ORDER BY id').all();
    expect(await request()).toEqual({ status: 200, body: { revoked: true } });
    expect(database.db.prepare('SELECT revoked_at FROM device_delivery_tokens').get()?.revoked_at).toBeTypeOf('string');
    expect(database.db.prepare('SELECT * FROM members ORDER BY id').all()).toEqual(membersBefore);
  });
  it('rejects missing/wrong device authentication without changing the active binding', async () => {
    const { request, database, body, headers } = assembled();
    expect(await request(body, { authorization: headers.authorization })).toMatchObject({ status: 401, body: { error: 'DEVICE_DELIVERY_AUTH_REQUIRED' } });
    expect(await request(body, { ...headers, 'x-qingmu-device-token': 'wrong-token' })).toMatchObject({ status: 403, body: { error: 'DEVICE_DELIVERY_REVOKED' } });
    expect(database.db.prepare('SELECT revoked_at FROM device_delivery_tokens').get()).toMatchObject({ revoked_at: null });
  });
  it.each([{ member_id: 'test:b' }, { binding_version: 99 }, { owner_generation: 99 }])('rejects incorrect owner receipt field %j', async patch => {
    const { request, body, database } = assembled();
    expect(await request({ ...body, ...patch })).toMatchObject({ status: 403 });
    expect(database.db.prepare('SELECT member_id,revoked_at FROM device_delivery_tokens').get()).toMatchObject({ member_id: 'test:a', revoked_at: null });
  });
  it('cannot revoke a same-member rotated binding using an older binding receipt', async () => {
    const { request, database } = assembled();
    registerDeviceDeliveryToken(database.db, { memberId: 'test:a', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 5 });
    expect(await request()).toMatchObject({ status: 403 });
    expect(database.db.prepare('SELECT binding_version,revoked_at FROM device_delivery_tokens').get()).toMatchObject({ binding_version: 2, revoked_at: null });
  });
  it('cannot revoke new owner B with late owner A cleanup even when the token is reused', async () => {
    const { request, database } = assembled();
    registerDeviceDeliveryToken(database.db, { memberId: 'test:b', installationId: 'test:installation', token: 'isolated-token', ownerGeneration: 6 });
    expect(await request()).toMatchObject({ status: 403 });
    expect(database.db.prepare('SELECT member_id,owner_generation,revoked_at FROM device_delivery_tokens').get()).toMatchObject({ member_id: 'test:b', owner_generation: 6, revoked_at: null });
  });
  it('requires the entire typed receipt and treats an inactive replay as non-mutating', async () => {
    const { request, body, database, api, headers } = assembled();
    expect(await api({ method: 'POST', url: '/api/device/reminders/revoke', headers, body: JSON.stringify({ binding_version: 1, owner_generation: 5 }) })).toMatchObject({ status: 400 });
    expect(await request({ ...body, owner_generation: -1 })).toMatchObject({ status: 400 });
    expect(await request()).toMatchObject({ status: 200 });
    const revoked = database.db.prepare('SELECT revoked_at,updated_at FROM device_delivery_tokens').get();
    expect(await request()).toMatchObject({ status: 403 });
    expect(database.db.prepare('SELECT revoked_at,updated_at FROM device_delivery_tokens').get()).toEqual(revoked);
  });
});
