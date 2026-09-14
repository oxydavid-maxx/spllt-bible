import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { calculateNetPoints, type PointEvent } from '../src/domain/points';

export interface LegacyPointPolicy {
  version: string;
  status: 'ACTIVE' | 'UNCONFIGURED';
  pointsPerCompletion: number;
}

export interface LegacyMigrationPreparation {
  migrationId: string;
  cutoff: string;
  sourceVersion: string;
  sourceFileSha256: string;
  legacyCalculator: { version: string; sha256: string };
  migrationCode: { version: string; sha256: string };
  policy: LegacyPointPolicy;
}

export interface LegacyMigrationError {
  status: 409;
  code:
    | 'MIGRATION_CONFIGURATION_INVALID'
    | 'MIGRATION_POLICY_UNKNOWN'
    | 'MIGRATION_SOURCE_INVALID'
    | 'MIGRATION_SOURCE_CONFLICT'
    | 'MIGRATION_CROSS_PLAN_CONFLICT'
    | 'MIGRATION_SOURCE_CHANGED'
    | 'MIGRATION_TARGET_DIVERGED'
    | 'MIGRATION_TARGET_NOT_EMPTY'
    | 'MIGRATION_EXPECTED_MISMATCH'
    | 'MIGRATION_ID_REUSED';
  details?: Record<string, unknown>;
}

type CompletionStatus = 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED';

interface PreparedEvent {
  eventId: string;
  memberId: string;
  planId: string;
  taskDate: string;
  status: CompletionStatus;
  revision: number;
  policyVersion: string;
}

interface SourceTableDigest {
  name: string;
  schemaDigest: string;
  dataDigest: string;
}

interface KeyProjection {
  memberId: string;
  planId: string;
  taskDate: string;
  amount: number;
}

interface MonthProjection {
  memberId: string;
  month: string;
  amount: number;
}

interface MemberProjection {
  memberId: string;
  earned: number;
  wallet: number;
}

export interface PreparedLegacyPointMigration extends LegacyMigrationPreparation {
  formatVersion: 1;
  runtime: { node: string; sqlite: string };
  sourceSchemaDigest: string;
  sourceDataDigest: string;
  sourceTables: SourceTableDigest[];
  events: PreparedEvent[];
  expected: {
    byCompletionKey: KeyProjection[];
    byMemberMonth: MonthProjection[];
    byMember: MemberProjection[];
  };
  inputHash: string;
}

export interface LegacyMigrationResult {
  migrationId: string;
  inserted: number;
  openingPoints: number;
  inputHash: string;
  sourceDigest: string;
}

interface RawEventRow {
  event_id: string;
  member_id: string;
  completion_key: string;
  status: string;
  policy_version: string;
  operation_id: string | null;
  response_json: string | null;
  command_fingerprint: string | null;
}

interface CompletionRow {
  member_id: string;
  plan_id: string;
  task_date: string;
  status: string;
  revision: number;
  last_operation_id: string | null;
}

interface ParsedOperation {
  operationId: string;
  memberId: string;
  planId: string;
  taskDate: string;
  status: CompletionStatus;
  revision: number;
}

const REQUIRED_SOURCE_TABLES = ['members', 'completions', 'operations', 'point_events'] as const;
const TARGET_MUTATION_TABLES = new Set([
  'daily_point_entitlements',
  'wallet_entries',
  'migration_receipts',
  'reading_days',
  'rewards',
  'reward_targets',
  'redemptions',
  'friend_tokens',
  'friendships',
  'mutation_receipts',
]);

function failure(code: LegacyMigrationError['code'], details?: Record<string, unknown>): LegacyMigrationError {
  return { status: 409, code, ...(details ? { details } : {}) };
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(`${value}n`);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Uint8Array) return JSON.stringify(`hex:${Buffer.from(value).toString('hex')}`);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sourceTableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function tableDigest(db: DatabaseSync, name: string): SourceTableDigest | null {
  const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
  if (!exists) return null;
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name=? ORDER BY type,name").all(name);
  const rows = db.prepare(`SELECT * FROM ${quotedIdentifier(name)}`).all().map((row) => canonical(row)).sort();
  return { name, schemaDigest: digest(schema), dataDigest: digest(rows) };
}

function inspectSource(db: DatabaseSync): { sourceSchemaDigest: string; sourceDataDigest: string; sourceTables: SourceTableDigest[] } | LegacyMigrationError {
  const names = sourceTableNames(db);
  for (const required of REQUIRED_SOURCE_TABLES) {
    if (!names.includes(required)) return failure('MIGRATION_SOURCE_INVALID', { reason: 'MISSING_TABLE', table: required });
  }
  const sourceTables = names.map((name) => tableDigest(db, name)).filter((row): row is SourceTableDigest => row !== null);
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return {
    sourceSchemaDigest: digest(schema),
    sourceDataDigest: digest(sourceTables.map(({ name, dataDigest }) => ({ name, dataDigest }))),
    sourceTables,
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isStatus(value: unknown): value is CompletionStatus {
  return value === 'UNREPORTED' || value === 'NOT_COMPLETED' || value === 'COMPLETED';
}

function parseOperation(
  operationId: string,
  responseJson: string | null,
  commandFingerprint: string | null,
): ParsedOperation | LegacyMigrationError {
  if (!responseJson || !commandFingerprint) return failure('MIGRATION_SOURCE_INVALID', { operationId, reason: 'MISSING_OPERATION_PROOF' });
  let response: Record<string, unknown>;
  try {
    response = JSON.parse(responseJson) as Record<string, unknown>;
  } catch {
    return failure('MIGRATION_SOURCE_INVALID', { operationId, reason: 'MALFORMED_OPERATION' });
  }
  const parsed: ParsedOperation = {
    operationId: typeof response.operationId === 'string' ? response.operationId : '',
    memberId: typeof response.memberId === 'string' ? response.memberId : '',
    planId: typeof response.planId === 'string' ? response.planId : '',
    taskDate: typeof response.taskDate === 'string' ? response.taskDate : '',
    status: isStatus(response.status) ? response.status : 'UNREPORTED',
    revision: Number(response.revision),
  };
  const expectedFingerprint = JSON.stringify([parsed.memberId, parsed.planId, parsed.taskDate, parsed.status]);
  if (
    parsed.operationId !== operationId
    || !parsed.memberId
    || !parsed.planId
    || !validDate(parsed.taskDate)
    || !isStatus(response.status)
    || !Number.isSafeInteger(parsed.revision)
    || parsed.revision < 1
    || commandFingerprint !== expectedFingerprint
  ) return failure('MIGRATION_SOURCE_INVALID', { operationId, reason: 'OPERATION_PROOF_MISMATCH' });
  return parsed;
}

function validatePreparation(preparation: LegacyMigrationPreparation): LegacyMigrationError | null {
  const sha = /^[a-f0-9]{64}$/i;
  if (
    !preparation.migrationId.trim()
    || !preparation.sourceVersion.trim()
    || !preparation.legacyCalculator.version.trim()
    || !preparation.migrationCode.version.trim()
    || !sha.test(preparation.sourceFileSha256)
    || !sha.test(preparation.legacyCalculator.sha256)
    || !sha.test(preparation.migrationCode.sha256)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(preparation.cutoff)
    || new Date(preparation.cutoff).toISOString() !== preparation.cutoff
  ) return failure('MIGRATION_CONFIGURATION_INVALID');
  if (
    preparation.policy.status !== 'ACTIVE'
    || !preparation.policy.version.trim()
    || !Number.isSafeInteger(preparation.policy.pointsPerCompletion)
    || preparation.policy.pointsPerCompletion < 0
  ) return failure('MIGRATION_POLICY_UNKNOWN');
  return null;
}

function eventPointStatus(status: CompletionStatus): PointEvent['status'] {
  return status === 'COMPLETED' ? 'COMPLETED' : 'NOT_COMPLETED';
}

function projectionSort<T extends { memberId: string }>(left: T, right: T): number {
  const leftRow = left as T & { planId?: string; taskDate?: string; month?: string };
  const rightRow = right as T & { planId?: string; taskDate?: string; month?: string };
  return left.memberId.localeCompare(right.memberId)
    || (leftRow.taskDate ?? leftRow.month ?? '').localeCompare(rightRow.taskDate ?? rightRow.month ?? '')
    || (leftRow.planId ?? '').localeCompare(rightRow.planId ?? '');
}

function buildExpectedProjection(
  db: DatabaseSync,
  events: PreparedEvent[],
  policy: LegacyPointPolicy,
): PreparedLegacyPointMigration['expected'] {
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const memberIds = [...new Set(events.map((event) => event.memberId))].sort((a, b) => a.localeCompare(b));
  const byCompletionKey: KeyProjection[] = [];
  const byMemberMonth: MonthProjection[] = [];
  const byMember: MemberProjection[] = [];
  for (const memberId of memberIds) {
    // This query and its SQLite-returned row order intentionally match the frozen legacy service.
    const rows = db.prepare('SELECT event_id,completion_key,status FROM point_events WHERE member_id=? AND policy_version=?').all(memberId, policy.version) as Array<{ event_id: string; completion_key: string; status: string }>;
    const referenceEvents: PointEvent[] = rows.map((row) => ({ eventId: row.event_id, completionKey: row.completion_key, status: eventPointStatus(eventById.get(row.event_id)!.status) }));
    const memberPoints = calculateNetPoints(referenceEvents, policy).points;
    byMember.push({ memberId, earned: memberPoints, wallet: memberPoints });
    const keys = [...new Map(events.filter((event) => event.memberId === memberId).map((event) => [`${event.memberId}\0${event.planId}\0${event.taskDate}`, event])).values()];
    for (const key of keys) {
      const completionKey = `${key.memberId}:${key.planId}:${key.taskDate}`;
      const points = calculateNetPoints(referenceEvents.filter((event) => event.completionKey === completionKey), policy).points;
      byCompletionKey.push({ memberId, planId: key.planId, taskDate: key.taskDate, amount: points });
    }
    const months = [...new Set(keys.map((key) => key.taskDate.slice(0, 7)))];
    for (const month of months) {
      const eventIds = new Set(events.filter((event) => event.memberId === memberId && event.taskDate.startsWith(`${month}-`)).map((event) => event.eventId));
      const points = calculateNetPoints(referenceEvents.filter((event) => eventIds.has(event.eventId)), policy).points;
      byMemberMonth.push({ memberId, month, amount: points });
    }
  }
  return {
    byCompletionKey: byCompletionKey.sort(projectionSort),
    byMemberMonth: byMemberMonth.sort(projectionSort),
    byMember: byMember.sort(projectionSort),
  };
}

function artifactWithoutHash(artifact: Omit<PreparedLegacyPointMigration, 'inputHash'> | PreparedLegacyPointMigration): Omit<PreparedLegacyPointMigration, 'inputHash'> {
  const { inputHash: _inputHash, ...withoutHash } = artifact as PreparedLegacyPointMigration;
  return withoutHash;
}

export function prepareLegacyPointMigration(
  sourceDb: DatabaseSync,
  preparation: LegacyMigrationPreparation,
): PreparedLegacyPointMigration | LegacyMigrationError {
  const configurationError = validatePreparation(preparation);
  if (configurationError) return configurationError;
  const inspection = inspectSource(sourceDb);
  if ('code' in inspection) return inspection;

  const completions = sourceDb.prepare('SELECT member_id,plan_id,task_date,status,revision,last_operation_id FROM completions').all() as unknown as CompletionRow[];
  const completionByKey = new Map<string, CompletionRow>();
  for (const completion of completions) {
    if (!completion.member_id || !completion.plan_id || !validDate(completion.task_date) || !isStatus(completion.status) || !Number.isSafeInteger(completion.revision) || completion.revision < 1 || !completion.last_operation_id) {
      return failure('MIGRATION_SOURCE_INVALID', { reason: 'INVALID_CURRENT_COMPLETION' });
    }
    const operation = sourceDb.prepare('SELECT operation_id,response_json,command_fingerprint FROM operations WHERE operation_id=?').get(completion.last_operation_id) as { operation_id: string; response_json: string; command_fingerprint: string | null } | undefined;
    if (!operation) return failure('MIGRATION_SOURCE_INVALID', { reason: 'MISSING_CURRENT_OPERATION' });
    const parsed = parseOperation(operation.operation_id, operation.response_json, operation.command_fingerprint);
    if ('code' in parsed || parsed.memberId !== completion.member_id || parsed.planId !== completion.plan_id || parsed.taskDate !== completion.task_date || parsed.status !== completion.status || parsed.revision !== completion.revision) {
      return failure('MIGRATION_SOURCE_INVALID', { operationId: completion.last_operation_id, reason: 'CURRENT_OPERATION_MISMATCH' });
    }
    completionByKey.set(`${completion.member_id}\0${completion.plan_id}\0${completion.task_date}`, completion);
  }

  const rows = sourceDb.prepare(`SELECT p.event_id,p.member_id,p.completion_key,p.status,p.policy_version,
    o.operation_id,o.response_json,o.command_fingerprint
    FROM point_events p LEFT JOIN operations o ON o.operation_id=p.event_id`).all() as unknown as RawEventRow[];
  const events: PreparedEvent[] = [];
  const revisionOwners = new Map<string, string>();
  for (const row of rows) {
    if (!row.operation_id || row.operation_id !== row.event_id || row.policy_version !== preparation.policy.version || !isStatus(row.status)) {
      return failure('MIGRATION_SOURCE_INVALID', { eventId: row.event_id, reason: 'EVENT_LINK_MISMATCH' });
    }
    const parsed = parseOperation(row.operation_id, row.response_json, row.command_fingerprint);
    if ('code' in parsed) return parsed;
    const structuredKey = `${parsed.memberId}:${parsed.planId}:${parsed.taskDate}`;
    if (parsed.memberId !== row.member_id || parsed.status !== row.status || row.completion_key !== structuredKey) {
      return failure('MIGRATION_SOURCE_INVALID', { eventId: row.event_id, reason: 'EVENT_OPERATION_MISMATCH' });
    }
    if (!sourceDb.prepare('SELECT 1 FROM members WHERE id=?').get(parsed.memberId)) {
      return failure('MIGRATION_SOURCE_INVALID', { eventId: row.event_id, reason: 'UNKNOWN_MEMBER' });
    }
    const key = `${parsed.memberId}\0${parsed.planId}\0${parsed.taskDate}`;
    const current = completionByKey.get(key);
    if (!current || parsed.revision > current.revision) return failure('MIGRATION_SOURCE_INVALID', { eventId: row.event_id, reason: 'EVENT_REVISION_OUT_OF_RANGE' });
    const revisionKey = `${key}\0${parsed.revision}`;
    const priorOperationId = revisionOwners.get(revisionKey);
    if (priorOperationId && priorOperationId !== parsed.operationId) {
      return failure('MIGRATION_SOURCE_CONFLICT', { eventId: row.event_id, revision: parsed.revision });
    }
    revisionOwners.set(revisionKey, parsed.operationId);
    events.push({ eventId: row.event_id, memberId: parsed.memberId, planId: parsed.planId, taskDate: parsed.taskDate, status: parsed.status, revision: parsed.revision, policyVersion: row.policy_version });
  }

  const grouped = new Map<string, PreparedEvent[]>();
  for (const event of events) {
    const key = `${event.memberId}\0${event.planId}\0${event.taskDate}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }
  const positivePlans = new Map<string, Set<string>>();
  if (preparation.policy.pointsPerCompletion > 0) {
    for (const bucket of grouped.values()) {
      const latest = [...bucket].sort((left, right) => left.revision - right.revision).at(-1)!;
      if (latest.status !== 'COMPLETED') continue;
      const dayKey = `${latest.memberId}\0${latest.taskDate}`;
      const plans = positivePlans.get(dayKey) ?? new Set<string>();
      plans.add(latest.planId);
      positivePlans.set(dayKey, plans);
    }
  }
  for (const [key, plans] of positivePlans) {
    if (plans.size > 1) return failure('MIGRATION_CROSS_PLAN_CONFLICT', { key });
  }

  const withoutHash: Omit<PreparedLegacyPointMigration, 'inputHash'> = {
    formatVersion: 1,
    ...preparation,
    runtime: { node: process.versions.node, sqlite: process.versions.sqlite ?? 'unknown' },
    ...inspection,
    events: events.sort((left, right) => left.memberId.localeCompare(right.memberId) || left.planId.localeCompare(right.planId) || left.taskDate.localeCompare(right.taskDate) || left.revision - right.revision || left.eventId.localeCompare(right.eventId)),
    expected: buildExpectedProjection(sourceDb, events, preparation.policy),
  };
  return { ...withoutHash, inputHash: digest(withoutHash) };
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function compareTargetSource(targetDb: DatabaseSync, artifact: PreparedLegacyPointMigration): LegacyMigrationError | null {
  for (const expected of artifact.sourceTables) {
    if (TARGET_MUTATION_TABLES.has(expected.name)) continue;
    const actual = tableDigest(targetDb, expected.name);
    if (!actual || !same(actual, expected)) return failure('MIGRATION_TARGET_DIVERGED', { table: expected.name });
  }
  return null;
}

function candidateEvents(events: PreparedEvent[], amount: number): PreparedEvent[] {
  if (amount === 0) return [];
  const grouped = new Map<string, PreparedEvent[]>();
  for (const event of events) {
    const key = `${event.memberId}\0${event.planId}\0${event.taskDate}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }
  return [...grouped.values()]
    .map((bucket) => [...bucket].sort((left, right) => left.revision - right.revision).at(-1)!)
    .filter((event) => event.status === 'COMPLETED');
}

function actualProjection(
  targetDb: DatabaseSync,
  artifact: PreparedLegacyPointMigration,
): PreparedLegacyPointMigration['expected'] {
  const amountByKey = new Map((targetDb.prepare('SELECT member_id,plan_id,task_date,amount FROM daily_point_entitlements WHERE migration_id=? AND active=1').all(artifact.migrationId) as Array<{ member_id: string; plan_id: string; task_date: string; amount: number }>).map((row) => [`${row.member_id}\0${row.plan_id}\0${row.task_date}`, Number(row.amount)]));
  const byCompletionKey = artifact.expected.byCompletionKey.map((row) => ({ ...row, amount: amountByKey.get(`${row.memberId}\0${row.planId}\0${row.taskDate}`) ?? 0 })).sort(projectionSort);
  const byMemberMonth = artifact.expected.byMemberMonth.map((row) => {
    const result = targetDb.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM daily_point_entitlements WHERE migration_id=? AND member_id=? AND active=1 AND substr(task_date,1,7)=?").get(artifact.migrationId, row.memberId, row.month) as { amount: number };
    return { ...row, amount: Number(result.amount) };
  }).sort(projectionSort);
  const byMember = artifact.expected.byMember.map((row) => {
    const earned = targetDb.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM daily_point_entitlements WHERE migration_id=? AND member_id=? AND active=1').get(artifact.migrationId, row.memberId) as { amount: number };
    const wallet = targetDb.prepare('SELECT COALESCE(SUM(delta),0) AS amount FROM wallet_entries WHERE migration_id=? AND member_id=?').get(artifact.migrationId, row.memberId) as { amount: number };
    return { memberId: row.memberId, earned: Number(earned.amount), wallet: Number(wallet.amount) };
  }).sort(projectionSort);
  return { byCompletionKey, byMemberMonth, byMember };
}

function openingLedgerMatches(targetDb: DatabaseSync, artifact: PreparedLegacyPointMigration): boolean {
  const actual = actualProjection(targetDb, artifact);
  const actualPositiveKeys = (targetDb.prepare('SELECT member_id,plan_id,task_date,amount FROM daily_point_entitlements WHERE migration_id=? AND active=1').all(artifact.migrationId) as Array<{ member_id: string; plan_id: string; task_date: string; amount: number }>)
    .map((row) => ({ memberId: row.member_id, planId: row.plan_id, taskDate: row.task_date, amount: Number(row.amount) }))
    .sort(projectionSort);
  const expectedPositiveKeys = artifact.expected.byCompletionKey.filter((row) => row.amount > 0);
  return same(actual, artifact.expected) && same(actualPositiveKeys, expectedPositiveKeys);
}

function immutableOpeningCreditsMatch(targetDb: DatabaseSync, artifact: PreparedLegacyPointMigration): boolean {
  const cutoffMs = new Date(artifact.cutoff).getTime();
  const expected = candidateEvents(artifact.events, artifact.policy.pointsPerCompletion)
    .map((event) => ({
      entry_id: digest(['LEGACY_OPENING_CREDIT', artifact.migrationId, event.memberId, event.planId, event.taskDate]),
      member_id: event.memberId,
      kind: 'LEGACY_OPENING_CREDIT',
      delta: artifact.policy.pointsPerCompletion,
      task_date: event.taskDate,
      redemption_id: null,
      operation_id: null,
      created_at: cutoffMs,
      migration_id: artifact.migrationId,
    }))
    .sort((left, right) => left.entry_id.localeCompare(right.entry_id));
  const actual = targetDb.prepare(`SELECT entry_id,member_id,kind,delta,task_date,redemption_id,operation_id,created_at,migration_id
    FROM wallet_entries WHERE migration_id=? ORDER BY entry_id`).all(artifact.migrationId);
  return same(actual, expected);
}

class MigrationAbort {
  constructor(readonly error: LegacyMigrationError) {}
}

export function applyPreparedLegacyPointMigration(
  sourceDb: DatabaseSync,
  targetDb: DatabaseSync,
  artifact: PreparedLegacyPointMigration,
  ensureTargetSchema: (db: DatabaseSync) => void,
): LegacyMigrationResult | LegacyMigrationError {
  if (sourceDb === targetDb || artifact.formatVersion !== 1 || digest(artifactWithoutHash(artifact)) !== artifact.inputHash) {
    return failure('MIGRATION_CONFIGURATION_INVALID');
  }
  const refreshed = prepareLegacyPointMigration(sourceDb, artifactWithoutHash(artifact));
  if ('code' in refreshed || !same(refreshed, artifact)) return failure('MIGRATION_SOURCE_CHANGED');
  targetDb.exec('BEGIN IMMEDIATE');
  try {
    ensureTargetSchema(targetDb);
    const prior = targetDb.prepare('SELECT source_digest,result_json FROM migration_receipts WHERE migration_id=?').get(artifact.migrationId) as { source_digest: string; result_json: string } | undefined;
    if (prior) {
      if (prior.source_digest !== artifact.inputHash) throw new MigrationAbort(failure('MIGRATION_ID_REUSED'));
      let result: LegacyMigrationResult;
      try { result = JSON.parse(prior.result_json) as LegacyMigrationResult; }
      catch { throw new MigrationAbort(failure('MIGRATION_TARGET_DIVERGED', { reason: 'INVALID_RECEIPT' })); }
      const expectedCandidates = candidateEvents(artifact.events, artifact.policy.pointsPerCompletion);
      const expectedResult: LegacyMigrationResult = {
        migrationId: artifact.migrationId,
        inserted: expectedCandidates.length,
        openingPoints: expectedCandidates.length * artifact.policy.pointsPerCompletion,
        inputHash: artifact.inputHash,
        sourceDigest: artifact.sourceDataDigest,
      };
      if (!same(result, expectedResult)) throw new MigrationAbort(failure('MIGRATION_TARGET_DIVERGED', { reason: 'INVALID_RECEIPT' }));
      if (!immutableOpeningCreditsMatch(targetDb, artifact)) throw new MigrationAbort(failure('MIGRATION_TARGET_DIVERGED', { reason: 'OPENING_CREDIT_MISMATCH' }));
      targetDb.exec('COMMIT');
      return result;
    }
    const targetError = compareTargetSource(targetDb, artifact);
    if (targetError) throw new MigrationAbort(targetError);
    const entitlementCount = Number((targetDb.prepare('SELECT COUNT(*) AS count FROM daily_point_entitlements').get() as { count: number }).count);
    const walletCount = Number((targetDb.prepare('SELECT COUNT(*) AS count FROM wallet_entries').get() as { count: number }).count);
    if (entitlementCount !== 0 || walletCount !== 0) throw new MigrationAbort(failure('MIGRATION_TARGET_NOT_EMPTY'));

    const cutoffMs = new Date(artifact.cutoff).getTime();
    const candidates = candidateEvents(artifact.events, artifact.policy.pointsPerCompletion);
    for (const event of candidates) {
      targetDb.prepare(`INSERT INTO daily_point_entitlements
        (member_id,task_date,plan_id,amount,active,completion_revision,source_policy_version,first_awarded_at,updated_at,migration_id)
        VALUES(?,?,?,?,1,?,?,NULL,?,?)`).run(event.memberId, event.taskDate, event.planId, artifact.policy.pointsPerCompletion, event.revision, event.policyVersion, cutoffMs, artifact.migrationId);
      const entryId = digest(['LEGACY_OPENING_CREDIT', artifact.migrationId, event.memberId, event.planId, event.taskDate]);
      targetDb.prepare(`INSERT INTO wallet_entries
        (entry_id,member_id,kind,delta,task_date,redemption_id,operation_id,created_at,migration_id)
        VALUES(?,?,'LEGACY_OPENING_CREDIT',?,?,NULL,NULL,?,?)`).run(entryId, event.memberId, artifact.policy.pointsPerCompletion, event.taskDate, cutoffMs, artifact.migrationId);
    }

    if (!openingLedgerMatches(targetDb, artifact)) {
      throw new MigrationAbort(failure('MIGRATION_EXPECTED_MISMATCH', { expectedDigest: digest(artifact.expected), actualDigest: digest(actualProjection(targetDb, artifact)) }));
    }
    const openingPoints = candidates.length * artifact.policy.pointsPerCompletion;
    const result: LegacyMigrationResult = { migrationId: artifact.migrationId, inserted: candidates.length, openingPoints, inputHash: artifact.inputHash, sourceDigest: artifact.sourceDataDigest };
    targetDb.prepare('INSERT INTO migration_receipts(migration_id,source_digest,result_json,created_at) VALUES(?,?,?,?)').run(artifact.migrationId, artifact.inputHash, JSON.stringify(result), cutoffMs);
    targetDb.exec('COMMIT');
    return result;
  } catch (error) {
    try { targetDb.exec('ROLLBACK'); } catch { /* retain the original failure */ }
    if (error instanceof MigrationAbort) return error.error;
    throw error;
  }
}
