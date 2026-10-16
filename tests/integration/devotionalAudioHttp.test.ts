import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it('prepares the newest post at start, then serves authenticated mp3 bytes from it through the actual HTTP entry', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T08:00:00+08:00'));
  const dir = mkdtempSync(join(tmpdir(), 'qm-audio-http-'));
  const secret = join(dir, 'speech.json');
  writeFileSync(secret, JSON.stringify({ key: 'synthetic-key', region: 'eastasia' }));
  writeFileSync(join(dir, '20261016.txt'), '📖🌾 《 測試 》\n2026.10.16 (五) 讀經：詩1\n背誦經文：\n詩篇 1:1 測試甲。\n默想經文：\n測試乙。\n用經文禱告：\n測試丙。\nhttps://youtu.be/abcdefghijk');
  vi.stubEnv('QINGMU_AZURE_SPEECH_FILE', secret);
  vi.stubEnv('QINGMU_DEVOTIONAL_DIR', dir);
  vi.stubEnv('QINGMU_LINE_SECRET_FILE', '');
  vi.stubEnv('QINGMU_REMINDER_WORKER_AUTOSTART', 'false');
  const mp3 = new Uint8Array([0xff, 0xf3, 0x64, 0xc4]);
  const azure = vi.fn(async () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } }));
  const httpFetch = globalThis.fetch;
  vi.stubGlobal('fetch', azure);
  const backend = createHttpServer({ database: createDatabase({ members: [{ id: 'test', displayName: '測試', groupId: 'g' }] }), fixtureToken: 'fixture' });
  try {
    await new Promise<void>(resolve => backend.server.listen(0, '127.0.0.1', resolve));
    const address = backend.server.address();
    if (!address || typeof address === 'string') throw new Error('NO_ADDRESS');
    const url = `http://127.0.0.1:${address.port}/api/devotional/2026-10-16/audio/0`;
    // Three paragraphs in two voices, asked of Azure before anyone presses ▶.
    await vi.waitFor(() => expect(azure).toHaveBeenCalledTimes(6));
    expect((await httpFetch(url)).status).toBe(401);
    const response = await httpFetch(url, { headers: { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'test' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(mp3);
    expect(azure, 'the listener is served the prepared file').toHaveBeenCalledTimes(6);
  } finally { await backend.stop(); rmSync(dir, { recursive: true, force: true }); }
});
