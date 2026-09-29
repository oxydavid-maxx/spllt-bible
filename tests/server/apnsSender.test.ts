// tests/server/apnsSender.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createApnsSender } from '../../server/apnsSender';

describe('APNs alert sender', () => {
  it('sends an alert whose custom fields sit under body, where expo-notifications reads them on iOS', async () => {
    const provider = { send: vi.fn(async () => ({ sent: [{ device: 'tok' }], failed: [] })), shutdown: vi.fn() };
    const sender = createApnsSender({ keyFile: 'unused', keyId: 'K', teamId: 'T', topic: 'org.qingmu.youth', production: true, provider });
    await sender.send('tok', { title: '竹科聖經', body: '乙 已加你為好友', data: { event: 'FRIEND_ADDED', kind: 'FRIEND_ADDED', memberId: 'm1', friendMemberId: 'm2', friendName: '乙' }, collapseId: 'friend:m2' });
    const [note, token] = provider.send.mock.calls[0] as unknown as [{ topic: string; pushType: string; collapseId: string; compile(): string }, string];
    expect(token).toBe('tok');
    expect(note.topic).toBe('org.qingmu.youth');
    expect(note.pushType).toBe('alert');
    expect(note.collapseId).toBe('friend:m2');
    expect(JSON.parse(note.compile())).toEqual({
      aps: { alert: { title: '竹科聖經', body: '乙 已加你為好友' }, sound: 'default' },
      body: { event: 'FRIEND_ADDED', kind: 'FRIEND_ADDED', memberId: 'm1', friendMemberId: 'm2', friendName: '乙' },
    });
  });
  it('reports an unregistered device so the caller can revoke the token', async () => {
    const provider = { send: vi.fn(async () => ({ sent: [], failed: [{ device: 'tok', status: 410, response: { reason: 'Unregistered' } }] })), shutdown: vi.fn() };
    const sender = createApnsSender({ keyFile: 'unused', keyId: 'K', teamId: 'T', topic: 'org.qingmu.youth', production: true, provider });
    await expect(sender.send('tok', { title: 't', body: 'b', data: {} })).rejects.toThrow('APNS_UNREGISTERED');
  });
});
