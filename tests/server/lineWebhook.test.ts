import { createHmac } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineWebhook, readLineChannelSecret } from '../../server/lineWebhook';
import { parseDevotionalPost } from '../../server/devotional';

// Made-up content in the pastor's format; the real posts never enter this public repository.
const POST = [
  '📖🌾 《 測試的樹 》',
  '2030.01.02 (三) 讀經：彼前5、詩118',
  '背誦經文：',
  '彼得前書 5:7 這是一段測試經文。',
  '默想經文：',
  '5:8-9 這是測試默想的第一段。',
  '用經文禱告：',
  '主啊，這是測試禱告。',
  '阿們！',
  'https://youtu.be/abcdefghijk',
].join('\n');
const SECRET = '0123456789abcdef0123456789abcdef';

function sign(body: string, secret = SECRET) {
  return createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');
}

function groupText(text: string, source: Record<string, string> = { type: 'group', groupId: 'Cgroup', userId: 'Usender' }) {
  return JSON.stringify({ destination: 'Ubot', events: [{ type: 'message', mode: 'active', timestamp: 1, source, webhookEventId: 'e1', deliveryContext: { isRedelivery: false }, replyToken: 'r1', message: { id: 'm1', type: 'text', quoteToken: 'q', text } }] });
}

describe('LINE webhook for the pastor\'s daily 靈修', () => {
  let dir: string;
  let logs: string[];
  let webhook: ReturnType<typeof createLineWebhook>;
  const deliver = (body: string, signature: string | undefined = sign(body)) => webhook({ rawBody: Buffer.from(body, 'utf8'), signature });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qm-line-'));
    logs = [];
    webhook = createLineWebhook({ channelSecret: SECRET, devotionalDir: join(dir, 'devotionals'), log: (line) => logs.push(line) });
    expect(parseDevotionalPost(POST)?.date).toBe('2030-01-02');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('saves a group post in the 靈修 format as that day\'s file, exactly as written', async () => {
    expect(await deliver(groupText(POST))).toEqual({ status: 200, body: { ok: true } });
    expect(readFileSync(join(dir, 'devotionals', '20300102.txt'), 'utf8')).toBe(POST);
    expect(logs).toEqual(['LINE_DEVOTIONAL_SAVED date=2030-01-02']);
  });

  it('rejects a request LINE did not sign with this channel, and saves nothing', async () => {
    const body = groupText(POST);
    for (const signature of [undefined, '', sign(body, 'fedcba9876543210fedcba9876543210'), 'not-base64!']) {
      expect((await webhook({ rawBody: Buffer.from(body, 'utf8'), signature })).status, String(signature)).toBe(401);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('answers LINE\'s verify call (no events) with 200', async () => {
    expect(await deliver(JSON.stringify({ destination: 'Ubot', events: [] }))).toEqual({ status: 200, body: { ok: true } });
  });

  it('drops every other group message without keeping or logging any of it', async () => {
    const chat = '大家早安，今天聚會改到七點';
    expect((await deliver(groupText(chat))).status).toBe(200);
    expect((await deliver(JSON.stringify({ destination: 'Ubot', events: [{ type: 'message', source: { type: 'group', groupId: 'Cgroup', userId: 'U1' }, message: { type: 'sticker', id: 's' } }, { type: 'join', source: { type: 'group', groupId: 'Cgroup' } }, { type: 'memberJoined', source: { type: 'group', groupId: 'Cgroup' } }] }))).status).toBe(200);
    expect(readdirSync(dir)).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('only takes posts from group chats, not from a one-to-one chat with the bot', async () => {
    expect((await deliver(groupText(POST, { type: 'user', userId: 'Ustranger' }))).status).toBe(200);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('notes a post that looks like a 靈修 but does not parse, without writing its text anywhere', async () => {
    const broken = POST.replace('用經文禱告：', '禱告：');
    expect((await deliver(groupText(broken))).status).toBe(200);
    expect(readdirSync(dir)).toEqual([]);
    expect(logs).toEqual(['LINE_DEVOTIONAL_REJECTED reason=FORMAT']);
    expect(logs.join('\n')).not.toContain('測試');
  });

  it('keeps one file per day: a redelivery changes nothing, a corrected re-post replaces it', async () => {
    await deliver(groupText(POST));
    await deliver(groupText(POST));
    expect(logs).toEqual(['LINE_DEVOTIONAL_SAVED date=2030-01-02', 'LINE_DEVOTIONAL_UNCHANGED date=2030-01-02']);
    const corrected = POST.replace('這是測試禱告。', '這是更正後的測試禱告。');
    await deliver(groupText(corrected));
    expect(readFileSync(join(dir, 'devotionals', '20300102.txt'), 'utf8')).toBe(corrected);
    expect(readdirSync(join(dir, 'devotionals'))).toEqual(['20300102.txt']);
  });

  it('tells the server each newly saved or corrected day (to prepare its audio), not a redelivery or a rejected post', async () => {
    const saved: string[] = [];
    webhook = createLineWebhook({ channelSecret: SECRET, devotionalDir: join(dir, 'devotionals'), log: (line) => logs.push(line), onSaved: (date) => saved.push(date) });
    await deliver(groupText(POST));
    await deliver(groupText(POST));
    await deliver(groupText(POST.replace('這是測試禱告。', '這是更正後的測試禱告。')));
    await deliver(groupText(POST.replace('背誦經文：', '')));
    expect(saved).toEqual(['2030-01-02', '2030-01-02']);
  });

  it('never talks back: no network call of any kind', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await deliver(groupText(POST));
    await deliver(groupText('哈囉'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 400 to a signed body that is not JSON', async () => {
    expect((await deliver('not json')).status).toBe(400);
  });
});

describe('reading the LINE channel secret file', () => {
  it('accepts only a 32-hex channel secret and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-line-secret-'));
    try {
      const file = join(dir, 'line.json');
      writeFileSync(file, JSON.stringify({ channelSecret: SECRET, note: 'x' }));
      expect(readLineChannelSecret(file)).toBe(SECRET);
      for (const content of ['not json', JSON.stringify({ channelSecret: 'short' }), JSON.stringify({})]) {
        writeFileSync(file, content);
        expect(readLineChannelSecret(file)).toBeNull();
      }
      expect(readLineChannelSecret(join(dir, 'absent.json'))).toBeNull();
      expect(readLineChannelSecret(undefined)).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
