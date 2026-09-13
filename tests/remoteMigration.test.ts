import { describe, expect, it } from 'vitest';
import { createDatabase } from '../server/db';
import { createDatabase as createDeployedDatabase } from './baseline/deployedDb';
import { saveReminderPreferences, registerDeviceDeliveryToken } from './baseline/reminderPreferences';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

describe('deployed nine-table reminder data migration', () => {
  it('preserves old rows, settings and owner bindings while adding nullable schedule/account fields and empty ledgers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qingmu-remote-migration-')), filename = join(dir, 'isolated.sqlite');
    try {
      const old = createDeployedDatabase({ filename, members: [{ id: 'test:a', displayName: 'Test A', groupId: 'G' }], groupProfiles: [{ memberId: 'test:a', groupId: 'G', groupName: 'Test G', rpgId: 'test:rpg', rpgName: 'Test RPG', linkStatus: 'READY' }] });
      saveReminderPreferences(old.db, 'test:a', { readingEnabled: true, meetingEnabled: true, readingTime: '06:45', meetingAdvanceMinutes: 45, preferenceGeneration: 9 });
      registerDeviceDeliveryToken(old.db, { memberId: 'test:a', installationId: 'test:install', token: 'isolated-device-token', ownerGeneration: 12 });
      old.db.prepare('INSERT INTO completions (member_id,plan_id,task_date,status,revision,sync_status) VALUES (?,?,?,?,?,?)').run('test:a','church-2026-09','2026-09-13','COMPLETED',2,'CONFIRMED');
      old.db.prepare('INSERT INTO point_events (event_id,member_id,completion_key,status,policy_version) VALUES (?,?,?,?,?)').run('test:e','test:a','test:c','EARNED','test:p');
      const tableNames = old.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => String(row.name));
      expect(tableNames).toHaveLength(9);
      const columns = Object.fromEntries(tableNames.map(table => [table,old.db.prepare(`PRAGMA table_info("${table}")`).all().map(row => String(row.name))]));
      const values = Object.fromEntries(tableNames.map(table => [table,old.db.prepare(`SELECT * FROM "${table}"`).all()]));
      old.close();
      for (let pass=0;pass<2;pass++) {
        const next = createDatabase({ filename });
        try {
          for (const table of tableNames) expect(next.db.prepare(`SELECT ${columns[table].map(column => `"${column}"`).join(',')} FROM "${table}"`).all()).toEqual(values[table]);
          expect(next.db.prepare('SELECT count(*) AS n FROM reminder_deliveries').get()).toMatchObject({ n: 0 });
          expect(next.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toMatchObject({ n: 0 });
          expect(next.db.prepare('SELECT disabled_at FROM members').get()).toMatchObject({ disabled_at: null });
          expect(next.db.prepare('SELECT meeting_id,schedule_revision,schedule_source_ref FROM member_group_profiles').get()).toMatchObject({ meeting_id: null, schedule_revision: null, schedule_source_ref: null });
          expect(next.db.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
          expect(next.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)).toEqual([...tableNames,'reminder_deliveries','auth_sessions'].sort());
        } finally { next.close(); }
      }
    } finally { if (!resolve(dir).startsWith(resolve(tmpdir())+sep) || !basename(dir).startsWith('qingmu-remote-migration-')) throw new Error('UNSAFE_TEST_CLEANUP'); rmSync(dir,{recursive:true}); }
  });
});
