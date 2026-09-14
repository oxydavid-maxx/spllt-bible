import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureGamificationSchema } from '../server/gamification';
import {
  applyPreparedLegacyPointMigration,
  prepareLegacyPointMigration,
  type LegacyMigrationPreparation,
  type PreparedLegacyPointMigration,
} from '../server/legacyPointMigration';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function frozenSnapshotPath(): string {
  const sourcePath = resolve(required('QINGMU_SOURCE_DB_PATH'));
  if (!existsSync(sourcePath)) throw new Error('QINGMU_SOURCE_DB_PATH must be an existing frozen snapshot');
  if (existsSync(`${sourcePath}-wal`) || existsSync(`${sourcePath}-shm`) || existsSync(`${sourcePath}-journal`)) throw new Error('source snapshot must not have WAL, SHM, or journal sidecars');
  return sourcePath;
}

function preparation(sourcePath: string): LegacyMigrationPreparation {
  return {
    migrationId: required('QINGMU_MIGRATION_ID'),
    cutoff: required('QINGMU_CUTOFF'),
    sourceVersion: required('QINGMU_SOURCE_VERSION'),
    sourceFileSha256: fileSha256(sourcePath),
    legacyCalculator: {
      version: required('QINGMU_LEGACY_CALCULATOR_VERSION'),
      sha256: fileSha256(resolve('src/domain/points.ts')),
    },
    migrationCode: {
      version: required('QINGMU_MIGRATION_CODE_VERSION'),
      sha256: fileSha256(resolve('server/legacyPointMigration.ts')),
    },
    policy: {
      version: required('QINGMU_LEGACY_POINT_POLICY_VERSION'),
      status: 'ACTIVE',
      pointsPerCompletion: Number(required('QINGMU_LEGACY_POINTS_PER_COMPLETION')),
    },
  };
}

function inspect(sourcePath: string, metadata: LegacyMigrationPreparation): PreparedLegacyPointMigration {
  const before = fileSha256(sourcePath);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const result = prepareLegacyPointMigration(source, metadata);
    if ('code' in result) throw new Error(`${result.code}${result.details ? ` ${JSON.stringify(result.details)}` : ''}`);
    const after = fileSha256(sourcePath);
    if (before !== after || after !== result.sourceFileSha256) throw new Error('MIGRATION_SOURCE_CHANGED');
    return result;
  } finally {
    source.close();
  }
}

function preparePhase(): void {
  const sourcePath = frozenSnapshotPath();
  const artifactPath = resolve(required('QINGMU_MIGRATION_ARTIFACT_PATH'));
  if (artifactPath.toLowerCase() === sourcePath.toLowerCase()) throw new Error('artifact path must differ from source snapshot');
  const artifact = inspect(sourcePath, preparation(sourcePath));
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ phase: 'prepare', migrationId: artifact.migrationId, inputHash: artifact.inputHash, sourceSchemaDigest: artifact.sourceSchemaDigest, sourceDataDigest: artifact.sourceDataDigest }, null, 2));
}

function applyPhase(): void {
  const sourcePath = frozenSnapshotPath();
  const targetPath = resolve(required('QINGMU_TARGET_DB_PATH'));
  if (!existsSync(targetPath)) throw new Error('QINGMU_TARGET_DB_PATH must be an existing target copy');
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) throw new Error('source snapshot and target database must be separate files');
  const artifactPath = resolve(required('QINGMU_MIGRATION_ARTIFACT_PATH'));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as PreparedLegacyPointMigration;
  const currentPreparation = preparation(sourcePath);
  if (JSON.stringify(currentPreparation) !== JSON.stringify({
    migrationId: artifact.migrationId,
    cutoff: artifact.cutoff,
    sourceVersion: artifact.sourceVersion,
    sourceFileSha256: artifact.sourceFileSha256,
    legacyCalculator: artifact.legacyCalculator,
    migrationCode: artifact.migrationCode,
    policy: artifact.policy,
  })) throw new Error('migration metadata differs from prepared artifact');

  // Finish every read-only source check before the target is opened.
  const verified = inspect(sourcePath, currentPreparation);
  if (JSON.stringify(verified) !== JSON.stringify(artifact)) throw new Error('MIGRATION_SOURCE_CHANGED');

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new DatabaseSync(targetPath);
  try {
    const result = applyPreparedLegacyPointMigration(source, target, artifact, ensureGamificationSchema);
    if ('code' in result) throw new Error(`${result.code}${result.details ? ` ${JSON.stringify(result.details)}` : ''}`);
    console.log(JSON.stringify({ phase: 'apply', ...result }, null, 2));
  } finally {
    target.close();
    source.close();
  }
}

const phase = required('QINGMU_MIGRATION_PHASE');
if (phase === 'prepare') preparePhase();
else if (phase === 'apply') applyPhase();
else throw new Error('QINGMU_MIGRATION_PHASE must be prepare or apply');
