import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAdminLinks } from '../../server/adminLinks';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// 後台規則與文件 (維護者 2026-10-17): the back-office links come from a private file, for administrators only.
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function linksFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'qm-admin-links-'));
  dirs.push(dir);
  const file = join(dir, 'admin-links.json');
  writeFileSync(file, content);
  return file;
}

describe('the back-office links', () => {
  it('reads https links with a name, and lists nothing for a missing or broken file', () => {
    const file = linksFile(JSON.stringify([{ name: '獎品與兌換試算表', url: 'https://docs.google.com/spreadsheets/d/x' }, { name: '壞的', url: 'http://plain.test' }, { name: '', url: 'https://x.test' }, 3]));
    expect(readAdminLinks(file)).toEqual([{ name: '獎品與兌換試算表', url: 'https://docs.google.com/spreadsheets/d/x' }]);
    expect(readAdminLinks(join(tmpdir(), 'no-such-admin-links.json'))).toEqual([]);
    expect(readAdminLinks(linksFile('{not json'))).toEqual([]);
    expect(readAdminLinks(undefined)).toEqual([]);
  });

  it('gives them to an administrator and to nobody else', async () => {
    const db = createDatabase({ members: [{ id: 'admin', displayName: '管理者', groupId: 'g' }, { id: 'm', displayName: '成員', groupId: 'g' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'fixture', adminMemberIds: ['admin'], adminLinksFile: linksFile(JSON.stringify([{ name: '讀經表', url: 'https://example.test/plan' }])) });
      const get = (memberId: string) => api({ method: 'GET', url: '/api/admin/documents', headers: { authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId } });
      expect((await get('admin')).body).toEqual({ links: [{ name: '讀經表', url: 'https://example.test/plan' }] });
      expect((await get('m')).status).toBe(403);
    } finally { db.close(); }
  });
});
