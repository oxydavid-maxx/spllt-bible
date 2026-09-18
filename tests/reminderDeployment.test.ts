import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../server/db';
import { createDatabase as createOldDatabase } from './baseline/db';
import { createApiHandler } from '../server/routes';
import { createSessionToken } from '../server/session';
import { createApiClient } from '../src/services/apiClient';

const secret = 'isolated-reminder-test-secret-never-used-live';
const handles: Array<ReturnType<typeof createDatabase>> = [];
const directories: string[] = [];
const members = [
  { id: 'test:alice', displayName: 'Alice', groupId: 'test:g1' },
  { id: 'test:bob', displayName: 'Bob', groupId: 'test:g2' },
];
afterEach(() => { for (const db of handles.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });

function assembled(database = createDatabase({ filename: ':memory:', members })) {
  handles.push(database);
  const api = createApiHandler({ db: database, authMode: 'google-only', instanceId: 'memory-test', sessionSecret: secret,
    productionGoogleAuth: { verify: async () => { throw new Error('No Google credential in isolated tests'); }, resolveMember: async () => null } });
  const token = (memberId: string) => createSessionToken(memberId, secret);
  const request = (method: string, url: string, body?: Record<string, unknown>, memberId = 'test:alice', headerMemberId = memberId) => api({
    method, url, body: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${token(memberId)}`, 'x-qingmu-member-id': headerMemberId },
  });
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await api({ method: init?.method ?? 'GET', url: String(input), body: init?.body as string | undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = (memberId = 'test:alice', headerMemberId = memberId) => createApiClient({ baseUrl: 'http://memory', token: token(memberId), memberId: headerMemberId, fetchImpl: transport });
  return { database, api, request, client };
}

describe('live-baseline reminder deployment candidate', () => {
  it('keeps all four App operations behind existing production-session authentication', async () => {
    const { api } = assembled();
    for (const [method, url] of [['GET', '/api/me/reminders'], ['PUT', '/api/me/reminders'], ['POST', '/api/me/reminders/device-token'], ['POST', '/api/me/reminders/device-token/revoke']]) {
      for (const authorization of [undefined, 'Bearer invalid-test-session', `Bearer ${createSessionToken('test:alice', secret, Math.floor(Date.now() / 1000) - 2, 1)}`]) {
        expect(await api({ method, url, headers: { authorization } })).toMatchObject({ status: 401 });
      }
    }
  });

  it('lets the real App client read defaults without creating synthetic settings or meeting schedules', async () => {
    const { client, database } = assembled();
    expect(await client().getReminderSnapshot()).toEqual({ memberId: 'test:alice', readingEnabled: true, meetingEnabled: false, readingTime: '06:30', meetingAdvanceMinutes: 30, preferenceGeneration: 0, remoteDeliveryStatus: 'REMOTE_PENDING', meetings: [] });
    expect(database.db.prepare('SELECT count(*) AS n FROM reminder_preferences').get()).toMatchObject({ n: 0 });
  });

  it('saves switches/time/advance via the actual App client and returns the persisted values on reopen', async () => {
    const { client } = assembled();
    expect(await client().saveReminderPreferences({ readingEnabled: true, meetingEnabled: true, readingTime: '07:45', meetingAdvanceMinutes: 15, preferenceGeneration: 1 })).toMatchObject({ readingEnabled: true, meetingEnabled: true, readingTime: '07:45', meetingAdvanceMinutes: 15, preferenceGeneration: 1, remoteDeliveryStatus: 'REMOTE_PENDING' });
    expect(await client().getReminderSnapshot()).toMatchObject({ readingEnabled: true, meetingEnabled: true, readingTime: '07:45', meetingAdvanceMinutes: 15, remoteDeliveryStatus: 'REMOTE_PENDING', meetings: [] });
    expect(await client().saveReminderPreferences({ readingEnabled: false, meetingEnabled: false })).toMatchObject({ readingEnabled: false, meetingEnabled: false, readingTime: '07:45', meetingAdvanceMinutes: 15, preferenceGeneration: 1 });
  });

  it('binds settings to the authenticated member rather than a spoofed header', async () => {
    const { client } = assembled();
    expect(await client('test:alice', 'test:bob').saveReminderPreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '22:30', preferenceGeneration: 3 })).toMatchObject({ memberId: 'test:alice', readingTime: '22:30' });
    expect(await client('test:bob').getReminderSnapshot()).toMatchObject({ memberId: 'test:bob', readingEnabled: true, readingTime: '06:30' });
  });

  it('ignores a late older preference generation', async () => {
    const { client } = assembled();
    expect(await client().saveReminderPreferences({ readingEnabled: true, meetingEnabled: true, readingTime: '18:15', preferenceGeneration: 5 })).toMatchObject({ preferenceGeneration: 5 });
    expect(await client().saveReminderPreferences({ readingEnabled: false, meetingEnabled: false, readingTime: '06:00', preferenceGeneration: 4 })).toMatchObject({ preferenceGeneration: 5, readingEnabled: true, meetingEnabled: true, readingTime: '18:15' });
  });

  it.each([{ reading_enabled: 'true' }, { reading_time: '24:00' }, { reading_time: '7:45' }, { meeting_advance_minutes: -1 }, { meeting_advance_minutes: 1441 }, { preference_generation: -1 }, { preference_generation: 1.5 }])('rejects invalid preferences before any write: %j', async (patch) => {
    const { request, database } = assembled();
    expect(await request('PUT', '/api/me/reminders', { reading_enabled: true, meeting_enabled: true, ...patch })).toMatchObject({ status: 400 });
    expect(database.db.prepare('SELECT count(*) AS n FROM reminder_preferences').get()).toMatchObject({ n: 0 });
  });

  it('does not create reminder data for a signed session whose member no longer exists', async () => {
    const { request, database } = assembled();
    expect(await request('PUT', '/api/me/reminders', { reading_enabled: true, meeting_enabled: true }, 'test:missing')).toMatchObject({ status: 404, body: { error: 'PROFILE_NOT_FOUND' } });
    expect(database.db.prepare('SELECT count(*) AS n FROM reminder_preferences').get()).toMatchObject({ n: 0 });
  });

  it('registers/revokes a token with generation protection without making remote delivery ready', async () => {
    const { client, request, database } = assembled();
    const alice = await client().registerReminderDeviceToken({ installationId: 'test:installation', token: 'isolated-device-token', ownerGeneration: 1 });
    expect(alice).toMatchObject({ registered: true, bindingVersion: 1, ownerGeneration: 1 });
    const bob = await client('test:bob').registerReminderDeviceToken({ installationId: 'test:installation', token: 'isolated-device-token', ownerGeneration: 2 });
    expect(bob).toMatchObject({ registered: true, bindingVersion: 2, ownerGeneration: 2 });
    expect(await request('POST', '/api/me/reminders/device-token/revoke', { installation_id: 'test:installation', binding_version: 1, owner_generation: 1 })).toMatchObject({ status: 200, body: { revoked: false } });
    expect(await client().registerReminderDeviceToken({ installationId: 'test:installation', token: 'old-token', ownerGeneration: 1 })).toMatchObject({ registered: false, bindingVersion: 2, ownerGeneration: 2 });
    expect(database.db.prepare('SELECT member_id, revoked_at FROM device_delivery_tokens').get()).toMatchObject({ member_id: 'test:bob', revoked_at: null });
    expect(await request('POST', '/api/me/reminders/device-token', { installation_id: 'test:other', token: 'isolated-device-token', platform: 'ANDROID', owner_generation: 1 })).toMatchObject({ body: { remoteDeliveryStatus: 'REMOTE_PENDING' } });
    expect(await client('test:bob').revokeReminderDeviceToken('test:installation', 2, 2)).toBe(true);
    expect(database.db.prepare('SELECT revoked_at FROM device_delivery_tokens WHERE installation_id = ?').get('test:installation')?.revoked_at).toBeTypeOf('string');
  });

  it('requires a higher owner generation to transfer an installation between members while allowing same-member token rotation', async () => {
    const { client, database } = assembled();
    const input = { installationId: 'test:shared-installation', token: 'isolated-token', ownerGeneration: 7 };
    expect(await client().registerReminderDeviceToken(input)).toMatchObject({ registered: true, bindingVersion: 1, ownerGeneration: 7 });
    expect(await client('test:bob').registerReminderDeviceToken(input)).toMatchObject({ registered: false, bindingVersion: 1, ownerGeneration: 7 });
    expect(database.db.prepare('SELECT member_id, token FROM device_delivery_tokens').get()).toMatchObject({ member_id: 'test:alice', token: 'isolated-token' });
    expect(await client().registerReminderDeviceToken({ ...input, token: 'rotated-token' })).toMatchObject({ registered: true, bindingVersion: 2, ownerGeneration: 7 });
    expect(await client('test:bob').registerReminderDeviceToken({ ...input, ownerGeneration: 8, token: 'bob-token' })).toMatchObject({ registered: true, bindingVersion: 3, ownerGeneration: 8 });
    expect(await client().registerReminderDeviceToken({ ...input, ownerGeneration: 8, token: 'late-alice-token' })).toMatchObject({ registered: false, bindingVersion: 3, ownerGeneration: 8 });
    expect(database.db.prepare('SELECT member_id, token FROM device_delivery_tokens').get()).toMatchObject({ member_id: 'test:bob', token: 'bob-token' });
  });

  it('additively upgrades a disk-backed old-schema test DB, preserves every old row, and survives restart without seeds', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qingmu-reminder-test-'));
    directories.push(directory);
    const filename = join(directory, 'test.sqlite');
    const old = createOldDatabase({ filename, members, groupProfiles: [{ memberId: 'test:alice', groupId: 'test:g1', groupName: 'Test group', rpgId: 'test:rpg', rpgName: 'Test RPG', linkStatus: 'READY' }] });
    old.db.prepare('INSERT INTO completions (member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run('test:alice', 'church-2026-09', '2026-09-13', 'COMPLETED', 3, 'CONFIRMED', 'test:operation');
    old.db.prepare('INSERT INTO point_events (event_id, member_id, completion_key, status, policy_version) VALUES (?, ?, ?, ?, ?)').run('test:point', 'test:alice', 'church-2026-09:2026-09-13', 'EARNED', 'test-policy');
    old.db.prepare('INSERT INTO operations (operation_id, response_json, command_fingerprint) VALUES (?, ?, ?)').run('test:operation', '{"revision":3}', 'test-existing-fingerprint');
    old.db.prepare('INSERT INTO identity_bindings (provider, subject, member_id, created_at) VALUES (?, ?, ?, ?)').run('google', 'test:subject', 'test:alice', '2026-09-01T00:00:00Z');
    old.db.prepare('INSERT INTO member_invites (invite_id, code_hash, member_id, display_name, group_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('test:invite', 'test-hash', 'test:bob', 'Bob', 'test:g2', '2026-09-30T00:00:00Z', null, '2026-09-01T00:00:00Z');
    const tables = (old.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    const oldDefinitions = old.db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const oldColumns = Object.fromEntries(tables.map(table => [table, old.db.prepare(`PRAGMA table_info("${table}")`).all()]));
    const oldValues = (db: ReturnType<typeof createDatabase>) => Object.fromEntries(tables.map(table => [table, db.db.prepare(`SELECT ${oldColumns[table].map(column => `"${column.name}"`).join(',')} FROM "${table}"`).all()]));
    const before = Object.fromEntries(tables.map((table) => [table, old.db.prepare(`SELECT * FROM "${table}"`).all()]));
    old.close();
    const first = assembled(createDatabase({ filename }));
    expect(await first.client().saveReminderPreferences({ readingEnabled: true, meetingEnabled: false, readingTime: '09:10', preferenceGeneration: 6 })).toMatchObject({ readingTime: '09:10' });
    expect(oldValues(first.database)).toEqual(before);
    const migratedDefinitions = first.database.db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string; sql: string }>;
    const unchangedTable = (row: { name?: unknown }) => row.name !== 'member_group_profiles' && row.name !== 'members';
    expect(migratedDefinitions.filter(row => tables.includes(row.name) && unchangedTable(row))).toEqual(oldDefinitions.filter(unchangedTable));
    const memberColumns = first.database.db.prepare('PRAGMA table_info(members)').all();
    expect(memberColumns.slice(0, oldColumns.members.length)).toEqual(oldColumns.members);
    expect(memberColumns.slice(oldColumns.members.length)).toEqual([
      { cid: oldColumns.members.length, name: 'disabled_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    ]);
    expect(first.database.db.prepare('SELECT disabled_at FROM members').all()).toEqual(members.map(() => ({ disabled_at: null })));
    const profileColumns = first.database.db.prepare('PRAGMA table_info(member_group_profiles)').all();
    expect(profileColumns.slice(0, oldColumns.member_group_profiles.length)).toEqual(oldColumns.member_group_profiles);
    // Gamification later added its own tables additively; the reminder tables must still be among the new ones.
    expect(migratedDefinitions.filter((row) => !tables.includes(row.name)).map((row) => row.name)).toEqual(expect.arrayContaining(['auth_sessions', 'device_delivery_tokens', 'reminder_deliveries', 'reminder_preferences']));
    expect(first.database.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toMatchObject({ n: 0 });
    handles.splice(handles.indexOf(first.database), 1); first.database.close();
    const restarted = assembled(createDatabase({ filename }));
    expect(await restarted.client().getReminderSnapshot()).toMatchObject({ readingEnabled: true, readingTime: '09:10', preferenceGeneration: 6, remoteDeliveryStatus: 'REMOTE_PENDING' });
    expect(restarted.database.db.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
    expect(oldValues(restarted.database)).toEqual(before);
    expect(restarted.database.db.prepare('PRAGMA table_info(members)').all()).toEqual(memberColumns);
    expect(restarted.database.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toMatchObject({ n: 0 });
  });

  it('does not expose a sending worker while remote delivery is unconfigured', async () => {
    const { request } = assembled();
    expect(await request('POST', '/internal/reminders/due', {})).toMatchObject({ status: 404 });
  });
});
