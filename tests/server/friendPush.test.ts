import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createFcmSender } from '../../server/fcmSender';
import { registerDeviceDeliveryToken, revokeDeviceDeliveryToken } from '../../server/reminderPreferences';

/**
 * 小明 scans your 我的好友 QR and your phone learns about it from the server, not by asking every few
 * seconds. The push is a courtesy on top of the claim: the claim's answer never waits for it, never
 * depends on it, and a retried claim does not announce the same friendship twice.
 */

const databases: Array<{ close: () => void }> = [];
afterEach(() => { databases.splice(0).forEach((database) => database.close()); vi.restoreAllMocks(); });

function setup(pushData?: (token: string, data: Record<string, string>) => Promise<unknown>) {
  const database = createDatabase({
    members: [
      { id: 'member-owner', displayName: '光佑', groupId: 'g' },
      { id: 'member-scanner', displayName: '小明', groupId: 'g' },
      { id: 'member-third', displayName: '小華', groupId: 'g' },
    ],
  });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', now: () => new Date('2026-09-27T04:00:00.000Z'), ...(pushData ? { pushData } : {}) });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  const qrToken = async (memberId: string) => {
    const qr = await api({ method: 'POST', url: '/api/friends/qr', headers: headers(memberId), body: '{}' });
    return new URL(String(qr.body.payload)).searchParams.get('token')!;
  };
  const claim = (memberId: string, token: string, operationId = randomUUID()) =>
    api({ method: 'POST', url: '/api/friends/claim', headers: headers(memberId), body: JSON.stringify({ operationId, token }) });
  const device = (memberId: string, installationId: string, token: string) =>
    registerDeviceDeliveryToken(database.db, { memberId, installationId, token, ownerGeneration: 1 });
  return { database, api, headers, qrToken, claim, device };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the QR owner hears about a new friend by push', () => {
  it('sends FRIEND_ADDED with the scanner’s name to every active device of the QR owner', async () => {
    const sent: Array<{ token: string; data: Record<string, string> }> = [];
    const { qrToken, claim, device, database } = setup(async (token, data) => { sent.push({ token, data }); return { messageId: 'm' }; });
    device('member-owner', 'install-phone', 'owner-phone-token');
    device('member-owner', 'install-tablet', 'owner-tablet-token');
    device('member-owner', 'install-old', 'owner-old-token');
    revokeDeviceDeliveryToken(database.db, 'member-owner', 'install-old');
    device('member-scanner', 'install-scanner', 'scanner-token');

    const response = await claim('member-scanner', await qrToken('member-owner'));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ memberId: 'member-owner', friendshipCreated: true });
    await settle();

    expect(sent.map((item) => item.token).sort()).toEqual(['owner-phone-token', 'owner-tablet-token']);
    for (const item of sent) expect(item.data).toEqual({ event: 'FRIEND_ADDED', friendMemberId: 'member-scanner', friendName: '小明' });
  });

  it('does not announce the same friendship again for a retried claim or a second scan', async () => {
    const send = vi.fn(async () => ({ messageId: 'm' }));
    const { qrToken, claim, device } = setup(send);
    device('member-owner', 'install-phone', 'owner-phone-token');
    const token = await qrToken('member-owner');
    const operationId = randomUUID();
    await claim('member-scanner', token, operationId);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    // The phone lost the first answer and sends the same operation again.
    const replay = await claim('member-scanner', token, operationId);
    expect(replay.status).toBe(200);
    // And a second scan of a fresh QR by someone who is already a friend.
    const again = await claim('member-scanner', await qrToken('member-owner'));
    expect(again.body).toMatchObject({ friendshipCreated: false });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers the claim without waiting for the push, and a failed push changes nothing about it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hanging = setup(() => new Promise(() => undefined));
    hanging.device('member-owner', 'install-phone', 'owner-phone-token');
    const answered = await hanging.claim('member-scanner', await hanging.qrToken('member-owner'));
    expect(answered).toMatchObject({ status: 200, body: { friendshipCreated: true } });

    const failing = setup(async () => { throw new Error('FCM_SEND_FAILED_404 owner-phone-token'); });
    failing.device('member-owner', 'install-phone', 'owner-phone-token');
    const failed = await failing.claim('member-scanner', await failing.qrToken('member-owner'));
    expect(failed).toMatchObject({ status: 200, body: { friendshipCreated: true } });
    await settle();
    expect(warn).toHaveBeenCalled();
    for (const spy of [warn, error]) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('owner-phone-token');
  });

  it('works exactly as before on a server with no FCM configured', async () => {
    const { qrToken, claim, device } = setup();
    device('member-owner', 'install-phone', 'owner-phone-token');
    expect(await claim('member-scanner', await qrToken('member-owner'))).toMatchObject({ status: 200, body: { friendshipCreated: true } });
  });
});

describe('the FCM message a friend push becomes', () => {
  it('is a data-only, high-priority message whose values are all strings', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ name: 'projects/p/messages/1' }), { status: 200 }));
    const sender = createFcmSender({ projectId: 'p', enabled: true, getAccessToken: async () => 'access', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(sender.sendData('device-token', { data: { event: 'FRIEND_ADDED', friendMemberId: 'member-scanner', friendName: '小明' }, ttlSeconds: 3600, collapseKey: 'friend:member-scanner', priority: 'HIGH' }))
      .resolves.toEqual({ messageId: 'projects/p/messages/1' });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]!.body));
    expect(body.message).toEqual({
      token: 'device-token',
      data: { event: 'FRIEND_ADDED', friendMemberId: 'member-scanner', friendName: '小明' },
      android: { ttl: '3600s', collapse_key: 'friend:member-scanner', priority: 'HIGH' },
    });
    expect(body.message.notification).toBeUndefined();
  });
});
