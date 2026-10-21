import type { DatabaseSync } from 'node:sqlite';

/**
 * Which version each phone runs, and the last day it was opened (光佑 2026-10-21: 「以後能不能紀錄誰用的是什麼
 * 版本？」). The app sends five headers with every request to this server (src/services/clientInfo.ts); a
 * signed-in request carrying them updates one row per installation. Only the 全體 (管理) list reads it back
 * (server/routes.ts, administrators only); friends never see it.
 *
 * Older apps send none of these headers and are served exactly as before: nothing is recorded for them.
 * A malformed header records nothing rather than half a row. The day is enough (Taipei date, no time),
 * and a request that changes nothing writes nothing, so a member opening the app twenty times a day costs
 * one write. Account deletion clears the rows (server/accountDeletion.ts).
 */
export interface ClientInstall {
  platform: 'android' | 'ios';
  version: string;
  build: string | null;
  updateId: string | null;
  lastSeenDate: string;
}

export interface ClientReport {
  installId: string;
  platform: 'android' | 'ios';
  version: string;
  build: string | null;
  updateId: string | null;
}

export const CLIENT_HEADERS = {
  install: 'x-qingmu-client-install',
  platform: 'x-qingmu-client-platform',
  version: 'x-qingmu-client-version',
  build: 'x-qingmu-client-build',
  update: 'x-qingmu-client-update',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const BUILD = /^\d{1,9}$/;

export function ensureClientInstallSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS client_installs (
    install_id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('android', 'ios')),
    app_version TEXT NOT NULL,
    app_build TEXT,
    update_id TEXT,
    last_seen_date TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS client_installs_member ON client_installs(member_id, last_seen_date)`);
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

/** The app's own report, or null when it is absent (an older app) or anything in it is malformed. */
export function readClientReport(headers: Record<string, string | undefined>): ClientReport | null {
  const installId = header(headers, CLIENT_HEADERS.install);
  const platform = header(headers, CLIENT_HEADERS.platform);
  const version = header(headers, CLIENT_HEADERS.version);
  const build = header(headers, CLIENT_HEADERS.build) || null;
  const updateId = header(headers, CLIENT_HEADERS.update) || null;
  if (!installId || !UUID.test(installId)) return null;
  if (platform !== 'android' && platform !== 'ios') return null;
  if (!version || !VERSION.test(version)) return null;
  if (build !== null && !BUILD.test(build)) return null;
  if (updateId !== null && !UUID.test(updateId)) return null;
  return { installId: installId.toLowerCase(), platform, version, build, updateId: updateId?.toLowerCase() ?? null };
}

/**
 * One row per installation, the newest report only. The WHERE clause makes an unchanged report a no-op, so
 * the database is written at most once a day per phone unless the phone changed version or member.
 */
export function recordClientInstall(db: DatabaseSync, memberId: string, report: ClientReport, date: string): void {
  db.prepare(`INSERT INTO client_installs(install_id, member_id, platform, app_version, app_build, update_id, last_seen_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(install_id) DO UPDATE SET member_id = excluded.member_id, platform = excluded.platform,
      app_version = excluded.app_version, app_build = excluded.app_build, update_id = excluded.update_id,
      last_seen_date = excluded.last_seen_date
    WHERE client_installs.member_id IS NOT excluded.member_id OR client_installs.platform IS NOT excluded.platform
      OR client_installs.app_version IS NOT excluded.app_version OR client_installs.app_build IS NOT excluded.app_build
      OR client_installs.update_id IS NOT excluded.update_id OR client_installs.last_seen_date IS NOT excluded.last_seen_date`)
    .run(report.installId, memberId, report.platform, report.version, report.build, report.updateId, date);
}

/** The member's most recently opened installation, or null when no app of theirs has reported yet. */
export function latestClientInstall(db: DatabaseSync, memberId: string): ClientInstall | null {
  const row = db.prepare(`SELECT platform, app_version, app_build, update_id, last_seen_date FROM client_installs
    WHERE member_id = ? ORDER BY last_seen_date DESC, rowid DESC LIMIT 1`).get(memberId) as
    { platform: 'android' | 'ios'; app_version: string; app_build: string | null; update_id: string | null; last_seen_date: string } | undefined;
  return row ? { platform: row.platform, version: row.app_version, build: row.app_build, updateId: row.update_id, lastSeenDate: row.last_seen_date } : null;
}
