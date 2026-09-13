import { afterEach, describe, expect, it, vi } from 'vitest';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../server/db';
import { createRemoteConfiguration } from '../server/remoteConfiguration';
import { createFcmSender } from '../server/fcmSender';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) { if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !basename(dir).startsWith('qingmu-remote-import-')) throw new Error('UNSAFE_TEST_CLEANUP'); rmSync(dir, { recursive: true }); } });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'qingmu-remote-import-')); dirs.push(dir); return dir; }

describe('operator entry and remote configuration boundaries', () => {
  it('separates a configured sender from disabled dispatcher without reading credentials or sending', () => {
    const dir = directory(), placeholder = join(dir, 'metadata-only.json');
    writeFileSync(placeholder, 'not-a-credential-and-must-not-be-read');
    const pending = createRemoteConfiguration({ QINGMU_FCM_PROJECT_ID: 'isolated-project', QINGMU_FCM_CREDENTIAL_FILE: placeholder, QINGMU_REMINDER_WORKER_AUTOSTART: 'false' });
    expect(pending).toMatchObject({ status: 'REMOTE_PENDING', senderConfigured: true, dispatcherEnabled: false, pendingReasons: ['DISPATCHER_DISABLED'] });
    expect(pending.delivery?.enabled).toBe(true);
    const ready = createRemoteConfiguration({ QINGMU_FCM_PROJECT_ID: 'isolated-project', QINGMU_FCM_CREDENTIAL_FILE: placeholder, QINGMU_REMINDER_WORKER_AUTOSTART: 'true' });
    expect(ready).toMatchObject({ status: 'REMOTE_READY', senderConfigured: true, dispatcherEnabled: true });
    // No call to delivery.send: configuration presence is deliberately not evidence of provider auth/delivery.
  });
  it('runs the actual CLI in read-only preview mode and requires a bound input hash to apply', () => {
    const dir = directory(), filename = join(dir, 'isolated.sqlite'), input = join(dir, 'isolated-source.json');
    const db = createDatabase({ filename, members: [{ id: 'test:a', displayName: 'Test', groupId: 'test:g' }], groupProfiles: [{ memberId: 'test:a', groupId: 'test:g', groupName: 'Test group', rpgId: 'test:rpg', rpgName: 'Test RPG', linkStatus: 'READY' }] }); db.close();
    writeFileSync(input, JSON.stringify({ sourceRef: 'isolated-authority', schedules: [{ memberId: 'test:a', rpgId: 'test:rpg', meetingId: 'test:m', title: 'Isolated event', startsAt: '2030-09-13T12:00:00+08:00', timeZone: 'Asia/Taipei', revision: 1, status: 'SCHEDULED' }] }));
    const sha = createHash('sha256').update(readFileSync(input)).digest('hex');
    const run = (...args: string[]) => spawnSync(process.execPath, ['--require', resolve('node_modules/tsx/dist/preflight.cjs'), '--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, 'server/importMeetingSchedules.ts', '--file', input, '--database', filename, ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
    const beforeHash = createHash('sha256').update(readFileSync(filename)).digest('hex');
    const preview = run(); expect(preview.status, preview.stderr).toBe(0); expect(JSON.parse(preview.stdout)).toMatchObject({ applied: false, changed: 1, input_sha256: sha });
    expect(createHash('sha256').update(readFileSync(filename)).digest('hex')).toBe(beforeHash);
    const unbound = run('--apply'); expect(unbound.status).toBe(1); expect(unbound.stderr).toContain('IMPORT_SHA256_REQUIRED_OR_CHANGED');
    const applied = run('--apply', '--sha256', sha); expect(applied.status, applied.stderr).toBe(0); expect(JSON.parse(applied.stdout)).toMatchObject({ applied: true, changed: 1 });
    const repeat = run('--apply', '--sha256', sha); expect(repeat.status, repeat.stderr).toBe(0); expect(JSON.parse(repeat.stdout)).toMatchObject({ applied: true, changed: 0 });
    const reopened = createDatabase({ filename });
    expect(reopened.db.prepare('SELECT meeting_id,starts_at FROM member_group_profiles').get()).toMatchObject({ meeting_id: 'test:m', starts_at: '2030-09-13T04:00:00.000Z' }); reopened.close();
  });
  it('uses the existing FCM v1 data contract and preserves provider acknowledgment with an injected transport', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: 'projects/isolated/messages/ack' }), { status: 200 }));
    const sender = createFcmSender({ projectId: 'isolated-project', enabled: true, getAccessToken: async () => 'isolated-test-access-token', fetchImpl: fetchImpl as typeof fetch });
    expect(await sender.send('isolated-device-token', { event: 'MEETING_REMINDER', reminderId: 'meeting:test:1', meetingId: 'test', scheduleRevision: 1 })).toEqual({ messageId: 'projects/isolated/messages/ack' });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ message: { token: 'isolated-device-token', data: { event: 'MEETING_REMINDER', scheduleRevision: '1' }, android: { ttl: '300s', collapse_key: 'meeting:test' } } });
    expect(body.message).not.toHaveProperty('notification');
  });
  it('does not call token auth or transport while the sender is disabled', async () => {
    const getAccessToken = vi.fn(async () => 'unused'), fetchImpl = vi.fn();
    const sender = createFcmSender({ projectId: 'test', enabled: false, getAccessToken, fetchImpl });
    await expect(sender.send('unused', { event: 'MEETING_REMINDER', reminderId: 'unused', meetingId: 'unused', scheduleRevision: 1 })).rejects.toThrow('REMOTE_DELIVERY_PENDING');
    expect(getAccessToken).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
