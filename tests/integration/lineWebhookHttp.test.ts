import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';

const SECRET = 'abcdef0123456789abcdef0123456789';
// Made-up post in the pastor's format.
const POST = '📖🌾 《 測試的樹 》\n2030.01.03 (四) 讀經：詩1\n背誦經文：\n詩篇 1:1 測試經文。\n默想經文：\n1:2 測試默想。\n用經文禱告：\n測試禱告。\n阿們！\nhttps://youtu.be/abcdefghijk';

async function listen(backend: ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => { backend.server.once('listening', () => resolve()); backend.server.once('error', reject); backend.server.listen(0, '127.0.0.1'); });
  const address = backend.server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP_TEST_ADDRESS_MISSING');
  return `http://127.0.0.1:${address.port}/api/line/webhook`;
}

describe('the LINE webhook route on the real HTTP server', () => {
  let dir: string;
  afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('verifies the signature over the exact bytes and writes the day\'s 靈修 into the private folder', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qm-line-http-'));
    writeFileSync(join(dir, 'line.json'), JSON.stringify({ channelSecret: SECRET }));
    vi.stubEnv('QINGMU_LINE_SECRET_FILE', join(dir, 'line.json'));
    vi.stubEnv('QINGMU_DEVOTIONAL_DIR', join(dir, 'devotionals'));
    const backend = createHttpServer({ database: createDatabase(), fixtureToken: 'line-http-fixture' });
    const url = await listen(backend);
    try {
      const body = JSON.stringify({ destination: 'Ubot', events: [{ type: 'message', source: { type: 'group', groupId: 'Cgroup', userId: 'Usender' }, message: { id: 'm', type: 'text', text: POST } }] });
      const signature = createHmac('sha256', SECRET).update(Buffer.from(body, 'utf8')).digest('base64');
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': signature }, body })).status).toBe(200);
      expect(readFileSync(join(dir, 'devotionals', '20300103.txt'), 'utf8')).toBe(POST);
      expect((await fetch(url, { method: 'POST', headers: { 'x-line-signature': 'AAAA' }, body })).status).toBe(401);
      expect((await fetch(url, { method: 'POST', headers: { 'x-line-signature': signature }, body: 'x'.repeat(300_000) })).status).toBe(413);
    } finally {
      await new Promise<void>((resolve) => backend.server.close(() => resolve()));
    }
  });

  it('is not there at all when no channel secret is configured', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qm-line-http-'));
    vi.stubEnv('QINGMU_LINE_SECRET_FILE', '');
    vi.stubEnv('QINGMU_DEVOTIONAL_DIR', join(dir, 'devotionals'));
    const backend = createHttpServer({ database: createDatabase(), fixtureToken: 'line-http-fixture' });
    const url = await listen(backend);
    try {
      expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(404);
      expect(existsSync(join(dir, 'devotionals'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => backend.server.close(() => resolve()));
    }
  });
});
