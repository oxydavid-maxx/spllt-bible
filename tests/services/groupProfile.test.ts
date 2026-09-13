import { describe, expect, it } from 'vitest';

import { createApiClient } from '../../src/services/apiClient';

describe('group profile client contract', () => {
  it('preserves meeting revision and masked roster fields', async () => {
    const client = createApiClient({ baseUrl: 'https://example.test', token: 'session', memberId: 'member:one', fetchImpl: async () => new Response(JSON.stringify({ groupId: 'G01', groupName: 'A小組', rpgs: [{ rpgId: 'G01-RPG1', rpgName: 'A-RPG1', openChatUrl: 'https://line.test', callUrl: 'https://meet.test', callProvider: 'meet', callScope: 'APPROVED', linkStatus: 'READY', linkRevision: 2, meeting: { meetingId: 'm1', title: '本週RPG', startsAt: '2026-09-12T19:00:00+08:00', timeZone: 'Asia/Taipei', revision: 3, status: 'SCHEDULED' }, roster: [{ label: '小明', isSelf: true }] }] }), { status: 200 }) });
    await expect(client.getGroups()).resolves.toMatchObject({ rpgs: [{ meeting: { revision: 3 }, roster: [{ isSelf: true }] }] });
  });
});
