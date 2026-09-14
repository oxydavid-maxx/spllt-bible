import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureGamificationSchema } from '../../server/gamification';
import {
  applyPreparedLegacyPointMigration,
  prepareLegacyPointMigration,
  type LegacyMigrationPreparation,
  type PreparedLegacyPointMigration,
} from '../../server/legacyPointMigration';

const policy = { version: 'old-v1', status: 'ACTIVE' as const, pointsPerCompletion: 2 };
const preparation: LegacyMigrationPreparation = {
  migrationId: 'migration-1',
  cutoff: '2026-09-14T00:00:00.000Z',
  sourceVersion: 'legacy-release-c89b6d8',
  sourceFileSha256: 'a'.repeat(64),
  legacyCalculator: { version: 'c89b6d8:src/domain/points.ts', sha256: 'b'.repeat(64) },
  migrationCode: { version: 'reading-gamification-v1', sha256: 'c'.repeat(64) },
  policy,
};

function schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE members(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, group_id TEXT NOT NULL);
    CREATE TABLE identity_bindings(provider TEXT NOT NULL, subject TEXT NOT NULL, member_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(provider, subject));
    CREATE TABLE completions(member_id TEXT NOT NULL, plan_id TEXT NOT NULL, task_date TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, sync_status TEXT NOT NULL, last_operation_id TEXT, PRIMARY KEY(member_id, plan_id, task_date));
    CREATE TABLE operations(operation_id TEXT PRIMARY KEY, response_json TEXT NOT NULL, command_fingerprint TEXT);
    CREATE TABLE point_events(event_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, completion_key TEXT NOT NULL, status TEXT NOT NULL, policy_version TEXT NOT NULL);
    CREATE TABLE reminder_preferences(member_id TEXT PRIMARY KEY, reading_enabled INTEGER NOT NULL, meeting_enabled INTEGER NOT NULL, reading_time TEXT NOT NULL, meeting_advance_minutes INTEGER NOT NULL, preference_generation INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);
}

function commandFingerprint(memberId: string, planId: string, taskDate: string, status: string): string {
  return JSON.stringify([memberId, planId, taskDate, status]);
}

interface OperationSeed {
  id: string;
  memberId: string;
  planId: string;
  taskDate: string;
  status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED';
  revision: number;
  event?: boolean;
  eventMemberId?: string;
  eventStatus?: string;
  eventPolicy?: string;
  completionKey?: string;
  responseOperationId?: string;
  fingerprint?: string | null;
}

function addOperation(db: DatabaseSync, item: OperationSeed): void {
  db.prepare('INSERT INTO operations(operation_id,response_json,command_fingerprint) VALUES(?,?,?)').run(
    item.id,
    JSON.stringify({ operationId: item.responseOperationId ?? item.id, memberId: item.memberId, planId: item.planId, taskDate: item.taskDate, status: item.status, revision: item.revision, points: 999 }),
    item.fingerprint === undefined ? commandFingerprint(item.memberId, item.planId, item.taskDate, item.status) : item.fingerprint,
  );
  if (item.event !== false) {
    db.prepare('INSERT INTO point_events(event_id,member_id,completion_key,status,policy_version) VALUES(?,?,?,?,?)').run(
      item.id,
      item.eventMemberId ?? item.memberId,
      item.completionKey ?? `${item.memberId}:${item.planId}:${item.taskDate}`,
      item.eventStatus ?? item.status,
      item.eventPolicy ?? policy.version,
    );
  }
}

function setCurrent(db: DatabaseSync, item: OperationSeed): void {
  db.prepare('INSERT OR REPLACE INTO completions(member_id,plan_id,task_date,status,revision,sync_status,last_operation_id) VALUES(?,?,?,?,?,?,?)').run(
    item.memberId, item.planId, item.taskDate, item.status, item.revision, 'CONFIRMED', item.id,
  );
}

function databases(seed: (db: DatabaseSync) => void): { source: DatabaseSync; target: DatabaseSync } {
  const source = new DatabaseSync(':memory:');
  const target = new DatabaseSync(':memory:');
  for (const db of [source, target]) {
    schema(db);
    db.prepare('INSERT INTO members VALUES(?,?,?)').run('member:with:colon', '甲', 'unassigned:member:with:colon');
    db.prepare('INSERT INTO members VALUES(?,?,?)').run('member-b', '乙', 'unassigned:member-b');
    db.prepare('INSERT INTO identity_bindings VALUES(?,?,?,?)').run('google', 'subject-a', 'member:with:colon', '2026-09-01T00:00:00.000Z');
    db.prepare('INSERT INTO reminder_preferences VALUES(?,?,?,?,?,?,?)').run('member:with:colon', 1, 0, '08:00', 30, 4, '2026-09-01T00:00:00.000Z');
    seed(db);
  }
  return { source, target };
}

function prepared(source: DatabaseSync, config: LegacyMigrationPreparation = preparation): PreparedLegacyPointMigration {
  const result = prepareLegacyPointMigration(source, config);
  if ('code' in result) throw new Error(`${result.code}:${JSON.stringify(result.details)}`);
  return result;
}

function tableRows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

describe('legacy point opening migration', () => {
  it('matches the frozen legacy projection per key, member, and month while preserving legacy rows', () => {
    const pair = databases((db) => {
      const august = { id: 'op-a1', memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-08-31', status: 'COMPLETED' as const, revision: 1 };
      const septemberEarn = { id: 'op-a2', memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-09-01', status: 'COMPLETED' as const, revision: 1 };
      const septemberRevoke = { id: 'op-a3', memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-09-01', status: 'NOT_COMPLETED' as const, revision: 2 };
      const unconfiguredGap = { id: 'op-a4', memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-09-01', status: 'COMPLETED' as const, revision: 3, event: false };
      const memberB = { id: 'op-b1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-02', status: 'COMPLETED' as const, revision: 1 };
      for (const item of [august, septemberEarn, septemberRevoke, unconfiguredGap, memberB]) addOperation(db, item);
      setCurrent(db, august);
      setCurrent(db, unconfiguredGap);
      setCurrent(db, memberB);
    });
    const before = Object.fromEntries(['members', 'identity_bindings', 'completions', 'operations', 'point_events', 'reminder_preferences'].map((table) => [table, tableRows(pair.target, table)]));
    const artifact = prepared(pair.source);

    expect(artifact.expected.byCompletionKey).toEqual([
      { memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-02', amount: 2 },
      { memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-08-31', amount: 2 },
      { memberId: 'member:with:colon', planId: 'plan-old', taskDate: '2026-09-01', amount: 0 },
    ]);
    expect(artifact.expected.byMemberMonth).toEqual([
      { memberId: 'member-b', month: '2026-09', amount: 2 },
      { memberId: 'member:with:colon', month: '2026-08', amount: 2 },
      { memberId: 'member:with:colon', month: '2026-09', amount: 0 },
    ]);

    const result = applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema);
    expect(result).toMatchObject({ migrationId: 'migration-1', inserted: 2, openingPoints: 4, inputHash: artifact.inputHash });
    expect(pair.target.prepare('SELECT * FROM daily_point_entitlements ORDER BY member_id,task_date').all()).toEqual([
      expect.objectContaining({ member_id: 'member-b', task_date: '2026-09-02', amount: 2, active: 1, first_awarded_at: null, migration_id: 'migration-1' }),
      expect.objectContaining({ member_id: 'member:with:colon', task_date: '2026-08-31', amount: 2, active: 1, first_awarded_at: null, migration_id: 'migration-1' }),
    ]);
    expect(pair.target.prepare('SELECT member_id,SUM(delta) AS amount FROM wallet_entries GROUP BY member_id ORDER BY member_id').all()).toEqual([
      { member_id: 'member-b', amount: 2 },
      { member_id: 'member:with:colon', amount: 2 },
    ]);
    for (const [table, rows] of Object.entries(before)) expect(tableRows(pair.target, table)).toEqual(rows);
    pair.source.close();
    pair.target.close();
  });

  it('rolls back credits and receipt when revision ordering disagrees with the frozen legacy calculator', () => {
    const pair = databases((db) => {
      const current = { id: 'op-new', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-03', status: 'NOT_COMPLETED' as const, revision: 2 };
      const older = { id: 'op-old', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-03', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, current);
      addOperation(db, older);
      setCurrent(db, current);
    });
    const result = applyPreparedLegacyPointMigration(pair.source, pair.target, prepared(pair.source), ensureGamificationSchema);
    expect(result).toMatchObject({ code: 'MIGRATION_EXPECTED_MISMATCH', status: 409 });
    expect(pair.target.prepare("SELECT name FROM sqlite_schema WHERE name IN ('daily_point_entitlements','wallet_entries','migration_receipts')").all()).toEqual([]);
    pair.source.close();
    pair.target.close();
  });

  it('replays the same immutable input as a no-op and rejects the same id with changed input', () => {
    const pair = databases((db) => {
      const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-04', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const firstArtifact = prepared(pair.source);
    const first = applyPreparedLegacyPointMigration(pair.source, pair.target, firstArtifact, ensureGamificationSchema);
    const second = applyPreparedLegacyPointMigration(pair.source, pair.target, firstArtifact, ensureGamificationSchema);
    expect(second).toEqual(first);
    expect(pair.target.prepare('SELECT COUNT(*) AS count FROM wallet_entries').get()).toEqual({ count: 1 });

    const changed = prepared(pair.source, { ...preparation, policy: { ...policy, pointsPerCompletion: 3 } });
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, changed, ensureGamificationSchema)).toMatchObject({ code: 'MIGRATION_ID_REUSED', status: 409 });
    expect(pair.target.prepare('SELECT COUNT(*) AS count FROM wallet_entries').get()).toEqual({ count: 1 });
    pair.source.close();
    pair.target.close();
  });

  it('rejects replay when the committed opening ledger no longer matches its receipt', () => {
    const pair = databases((db) => {
      const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-04', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const artifact = prepared(pair.source);
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toMatchObject({ inserted: 1 });
    pair.target.prepare("UPDATE wallet_entries SET delta=9 WHERE migration_id='migration-1'").run();
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toMatchObject({ code: 'MIGRATION_TARGET_DIVERGED', status: 409 });
    pair.source.close();
    pair.target.close();
  });

  it('replays as a no-op after later business changes without restoring mutable state or adding credit', () => {
    const pair = databases((db) => {
      const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-04', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const artifact = prepared(pair.source);
    const first = applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema);
    expect(first).toMatchObject({ inserted: 1, openingPoints: 2 });
    pair.target.prepare("UPDATE daily_point_entitlements SET active=0,completion_revision=2 WHERE migration_id='migration-1'").run();
    pair.target.prepare("UPDATE completions SET status='NOT_COMPLETED',revision=2,last_operation_id='later-op' WHERE member_id='member-b'").run();
    pair.target.prepare("UPDATE members SET display_name='Later name' WHERE id='member-b'").run();
    pair.target.prepare("INSERT INTO wallet_entries(entry_id,member_id,kind,delta,task_date,created_at,migration_id) VALUES('later-reversal','member-b','READING_REVERSAL',-2,'2026-09-04',1789344000001,NULL)").run();
    const walletBeforeReplay = tableRows(pair.target, 'wallet_entries');

    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toEqual(first);
    expect(tableRows(pair.target, 'wallet_entries')).toEqual(walletBeforeReplay);
    expect(pair.target.prepare("SELECT active FROM daily_point_entitlements WHERE migration_id='migration-1'").get()).toEqual({ active: 0 });
    expect(pair.target.prepare("SELECT display_name FROM members WHERE id='member-b'").get()).toEqual({ display_name: 'Later name' });
    pair.source.close();
    pair.target.close();
  });

  it.each([
    ['missing operation', (db: DatabaseSync) => db.prepare('INSERT INTO point_events VALUES(?,?,?,?,?)').run('missing', 'member-b', 'member-b:plan-old:2026-09-05', 'COMPLETED', 'old-v1')],
    ['fingerprint mismatch', (db: DatabaseSync) => { const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1, fingerprint: 'wrong' }; addOperation(db, item); setCurrent(db, item); }],
    ['operation id mismatch', (db: DatabaseSync) => { const item = { id: 'op-1', responseOperationId: 'op-other', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1 }; addOperation(db, item); setCurrent(db, item); }],
    ['completion key mismatch', (db: DatabaseSync) => { const item = { id: 'op-1', completionKey: 'unsafe:key', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1 }; addOperation(db, item); setCurrent(db, item); }],
    ['malformed date', (db: DatabaseSync) => { const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-02-30', status: 'COMPLETED' as const, revision: 1 }; addOperation(db, item); setCurrent(db, item); }],
    ['unknown event policy', (db: DatabaseSync) => { const item = { id: 'op-1', eventPolicy: 'unknown', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1 }; addOperation(db, item); setCurrent(db, item); }],
    ['invalid event status', (db: DatabaseSync) => { const item = { id: 'op-1', eventStatus: 'EARNED', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1 }; addOperation(db, item); setCurrent(db, item); }],
  ])('rejects %s during source preparation', (_name, seed) => {
    const pair = databases(seed);
    expect(prepareLegacyPointMigration(pair.source, preparation)).toMatchObject({ code: 'MIGRATION_SOURCE_INVALID', status: 409 });
    expect(pair.target.prepare("SELECT name FROM sqlite_schema WHERE name='daily_point_entitlements'").get()).toBeUndefined();
    pair.source.close();
    pair.target.close();
  });

  it('rejects two operations for the same completion revision', () => {
    const pair = databases((db) => {
      const first = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-05', status: 'COMPLETED' as const, revision: 1 };
      const second = { ...first, id: 'op-2' };
      addOperation(db, first);
      addOperation(db, second);
      setCurrent(db, second);
    });
    expect(prepareLegacyPointMigration(pair.source, preparation)).toMatchObject({ code: 'MIGRATION_SOURCE_CONFLICT', status: 409 });
    pair.source.close();
    pair.target.close();
  });

  it.each([
    ['event revision beyond current', 1, 'op-event'],
    ['current last operation mismatch', 2, 'missing-current-operation'],
  ])('rejects %s', (_name, currentRevision, lastOperationId) => {
    const pair = databases((db) => {
      const event = { id: 'op-event', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-06', status: 'COMPLETED' as const, revision: 2 };
      addOperation(db, event);
      db.prepare('INSERT INTO completions VALUES(?,?,?,?,?,?,?)').run('member-b', 'plan-old', '2026-09-06', 'COMPLETED', currentRevision, 'CONFIRMED', lastOperationId);
    });
    expect(prepareLegacyPointMigration(pair.source, preparation)).toMatchObject({ code: 'MIGRATION_SOURCE_INVALID', status: 409 });
    pair.source.close();
    pair.target.close();
  });

  it('does not credit a completion with no event during an unconfigured revision gap', () => {
    const pair = databases((db) => {
      const item = { id: 'op-gap', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-07', status: 'COMPLETED' as const, revision: 1, event: false };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const artifact = prepared(pair.source);
    expect(artifact.expected).toMatchObject({ byCompletionKey: [], byMemberMonth: [], byMember: [] });
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toMatchObject({ inserted: 0, openingPoints: 0 });
    pair.source.close();
    pair.target.close();
  });

  it('rejects positive cross-plan credits for the same member and day', () => {
    const pair = databases((db) => {
      const first = { id: 'op-1', memberId: 'member-b', planId: 'plan-a', taskDate: '2026-09-08', status: 'COMPLETED' as const, revision: 1 };
      const second = { id: 'op-2', memberId: 'member-b', planId: 'plan-b', taskDate: '2026-09-08', status: 'COMPLETED' as const, revision: 1 };
      for (const item of [first, second]) { addOperation(db, item); setCurrent(db, item); }
    });
    expect(prepareLegacyPointMigration(pair.source, preparation)).toMatchObject({ code: 'MIGRATION_CROSS_PLAN_CONFLICT', status: 409 });
    pair.source.close();
    pair.target.close();
  });

  it('rejects source changes before creating target migration tables', () => {
    const pair = databases((db) => {
      const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-09', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const artifact = prepared(pair.source);
    pair.source.prepare('UPDATE members SET display_name=? WHERE id=?').run('changed', 'member-b');
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toMatchObject({ code: 'MIGRATION_SOURCE_CHANGED', status: 409 });
    expect(pair.target.prepare("SELECT name FROM sqlite_schema WHERE name='daily_point_entitlements'").get()).toBeUndefined();
    pair.source.close();
    pair.target.close();
  });

  it('rejects a target copy whose preserved legacy rows diverged', () => {
    const pair = databases((db) => {
      const item = { id: 'op-1', memberId: 'member-b', planId: 'plan-old', taskDate: '2026-09-10', status: 'COMPLETED' as const, revision: 1 };
      addOperation(db, item);
      setCurrent(db, item);
    });
    const artifact = prepared(pair.source);
    pair.target.prepare('UPDATE reminder_preferences SET reading_enabled=0 WHERE member_id=?').run('member:with:colon');
    expect(applyPreparedLegacyPointMigration(pair.source, pair.target, artifact, ensureGamificationSchema)).toMatchObject({ code: 'MIGRATION_TARGET_DIVERGED', status: 409 });
    expect(pair.target.prepare("SELECT name FROM sqlite_schema WHERE name='daily_point_entitlements'").get()).toBeUndefined();
    pair.source.close();
    pair.target.close();
  });
});
