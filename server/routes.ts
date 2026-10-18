import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AppleIdentity } from './appleVerifier';
import { deleteMemberAccount } from './accountDeletion';
import { openAppleToken, sealAppleToken } from './appleTokens';
import { maskForViewer } from '../src/domain/masking';
import { calculateNetPoints, type PointEvent, type PointPolicy } from '../src/domain/points';
import type { ContentGateStatus } from '../src/domain/types';
import { authenticate, authenticateGoogle, authenticateSessionOrGoogle, type ProductionGoogleAuth } from './authBoundary';
import { claimMemberInvite } from './membership';
import { isTestLabAddress } from './testLabNetwork';
import { createSessionToken } from './session';
import { parseCapabilityQuery } from './contentCapabilities';
import { createChapterAudioResolver, prewarmChapterAudio } from './genericChapterAudio';
import { getMemberGroupProfile } from './groups';
import { ensureJournalSchema, getJournalEntry, listJournalEntries } from './journal';
import { ensureEventRegistrationSchema, formRegistrationKeyMatches, formSyncIdentityMatches, getEventRegistrationView, readFormRegistrationPush, replaceEventRegistrations, type FormSyncIdentity } from './eventRegistrations';
import { getCommunityProgress } from './communityProgress';
import { readReminderPreferences, saveReminderPreferences, registerDeviceDeliveryToken, revokeDeviceDeliveryToken } from './reminderPreferences';
import { authorizeDeviceMeetingSnapshot } from './remoteReminders';
import { notifyFriendAdded, type PushDataSender } from './friendPush';
import type { ApnsAlertSender } from './apnsSender';
import { speechUnits } from '../src/domain/devotionReading';
import { DEFAULT_DEVOTION_VOICE, isDevotionVoice } from '../src/domain/devotionVoice';
import type { DevotionalAudio } from './devotionalAudio';
import { createSongTitleLookup, isDevotionalDate, readDevotional, type SongTitleLookup } from './devotional';
import { ensureDevotionSchema, getGroupReading, getScoreHistory, listDevotionDates, setDevotion } from './devotionProgress';
import { chosenCongregation, congregationOf, ensureCongregationSchema, isCongregation, setCongregation } from './congregation';
import { applyRewardSheet, listRewards, readRewardSheetPush, sheetRedemptionsFor } from './rewardSheet';
import { rewardSheetReadingStats } from './rewardSheetStats';
import { listBulletins, readBulletinPage } from './bulletins';
import { readAdminLinks } from './adminLinks';
import { createDeviceSession, isLegacySessionRevoked, isMemberEnabled, resolveDeviceSession, revokeSession } from './mobileSessions';
import {
  GAMIFICATION_POLICY_VERSION,
  GAMIFICATION_POINT_AMOUNT,
  canViewMember,
  claimFriend,
  ensureGamificationSchema,
  getPeople,
  getRedemptions,
  getScoreProfile,
  getViewerCapabilities,
  issueFriendToken,
  mutateCompletion,
  readReadingDays,
  removeFriend,
  setRewardTarget,
  type GamificationError,
} from './gamification';
import { isScoreChartRange, isValidDateOnly, projectMemberRedemption, taipeiDate, type ScoreChartQuery } from '../src/domain/gamificationV1';

export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  binaryBody?: Uint8Array;
}

export interface ApiHandlerOptions {
  remoteReminderStatus?: 'REMOTE_PENDING' | 'REMOTE_READY';
  /** Warm the chapter-audio metadata cache for today's and tomorrow's assigned chapters at start-up and at each Taipei midnight. */
  prewarmChapterAudio?: boolean;
  prewarmVersionIds?: readonly number[];
  db: { db: DatabaseSync };
  instanceId?: string;
  authMode?: 'fixture' | 'google-only';
  fixtureToken?: string;
  /** Development fixture only (authBoundary.authenticate): the member for a token-only request. */
  fixtureDefaultMemberId?: string;
  productionGoogleAuth?: ProductionGoogleAuth;
  productionAppleAuth?: {
    verify: (token: string, nonce: string) => Promise<AppleIdentity>;
    exchangeCode?: (code: string, subject: string) => Promise<string>;
    revoke?: (token: string) => Promise<void>;
  };
  sessionSecret?: string;
  contentGate?: {
    status: ContentGateStatus;
    reason: string;
    evidenceRefs?: string[];
  };
  pointPolicy?: PointPolicy;
  weeklyDates?: string[];
  scheduleDates?: string[];
  adminMemberIds?: string[];
  adminGoogleSubjects?: string[];
  autoProvisionGoogleMembers?: boolean;
  disableMeetingReminders?: boolean;
  /** Key the owner's Apps Script sends with sign-up pushes. */
  formRegistrationKey?: string;
  /** Or the script sends its Google identity token; the push route is absent without either. */
  formSyncIdentity?: FormSyncIdentity;
  /** Data-only FCM to a member's registered devices. Absent means app events are simply not pushed. */
  pushData?: PushDataSender;
  /** APNs alerts to a member's registered iPhones. Absent means iPhones are simply not pushed. */
  pushIos?: ApnsAlertSender;
  /** Private folder of the pastor's daily posts (YYYYMMDD.txt). Absent: the 靈修 tab says there is none yet. */
  devotionalDir?: string;
  devotionalAudio?: DevotionalAudio;
  /** 主堂週刊 pages kept from the LINE group (server/bulletins.ts). */
  bulletinDir?: string;
  /** Private list of back-office documents for administrators (server/adminLinks.ts). */
  adminLinksFile?: string;
  /** Song titles for the 靈修 tab; tests pass a stub so nothing reaches YouTube. */
  songTitle?: SongTitleLookup;
  now?: () => Date;
}

const PLAN_ID = 'church-2026-09';
const DEFAULT_POLICY: PointPolicy = {
  version: 'unconfigured',
  status: 'UNCONFIGURED',
  pointsPerCompletion: 0,
};

function json(status: number, body: Record<string, unknown>): ApiResponse {
  return { status, body };
}

function gamificationJson(status: number, body: Record<string, unknown>): ApiResponse {
  return { status, body, headers: { 'cache-control': 'no-store' } };
}

function gamificationError(error: GamificationError): ApiResponse {
  return gamificationJson(error.status, {
    error: {
      code: error.code,
      retryable: false,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

function isGamificationError(value: unknown): value is GamificationError {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).code === 'string' && typeof (value as Record<string, unknown>).status === 'number');
}

function isGamificationPath(pathname: string): boolean {
  return pathname === '/api/me/profile' || pathname === '/api/me/congregation' || pathname.startsWith('/api/me/reading-days') || pathname.startsWith('/api/me/completions/') || pathname.startsWith('/api/me/reward-target') || pathname.startsWith('/api/me/redemptions') || pathname.startsWith('/api/me/journal') || pathname.startsWith('/api/me/devotions') || pathname === '/api/me/score-history' || pathname.startsWith('/api/devotional/') || pathname.startsWith('/api/bulletins') || pathname.startsWith('/api/points/') || pathname.startsWith('/api/rewards') || pathname.startsWith('/api/friends/') || pathname.startsWith('/api/admin/');
}

function parseBody(body: string | undefined): Record<string, unknown> {
  try {
    const parsed = body ? JSON.parse(body) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function inviteCode(body: Record<string, unknown>): string {
  if (typeof body.invite_code !== 'string' || !body.invite_code.trim()) throw new Error('INVALID_INVITE_CODE');
  return body.invite_code.trim();
}

function memberExists(db: DatabaseSync, memberId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM members WHERE id = ?').get(memberId));
}

function parsePath(url: string): URL {
  return new URL(url, 'http://127.0.0.1');
}

function defaultWeeklyDates(scheduleDates: string[] | undefined, date: string): string[] | undefined {
  if (!scheduleDates) return undefined;
  const selected = new Date(`${date}T12:00:00Z`);
  const dayOfWeek = selected.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = new Date(selected);
  start.setUTCDate(selected.getUTCDate() - daysFromMonday);
  const startDate = start.toISOString().slice(0, 10);
  return scheduleDates.filter((scheduledDate) => scheduledDate >= startDate && scheduledDate <= date);
}

interface PeriodProgress {
  periodStart: string;
  periodEnd: string;
  completed: number;
  target: number;
  personalCompleted: number;
  points: number;
  personalPoints: number;
  policyStatus: PointPolicy['status'];
  policyVersion: string;
  pointsPerCompletion: number;
  goalTarget?: number;
  goalAchieved?: boolean;
}

function getPeriodProgress(
  db: DatabaseSync,
  viewerId: string,
  memberCount: number,
  periodDates: string[],
  policy: PointPolicy,
  includeGoal = false,
): PeriodProgress | undefined {
  if (periodDates.length === 0) return undefined;
  const placeholders = periodDates.map(() => '?').join(',');
  const rows = db.prepare(`SELECT member_id, task_date, status FROM completions WHERE member_id = ? AND plan_id = ? AND task_date IN (${placeholders})`).all(viewerId, PLAN_ID, ...periodDates) as Array<{ member_id: string; task_date: string; status: string }>;
  const completedTasks = new Set(rows.filter((row) => row.status === 'COMPLETED').map((row) => `${row.member_id}:${row.task_date}`));
  const personalCompleted = new Set(rows.filter((row) => row.member_id === viewerId && row.status === 'COMPLETED').map((row) => row.task_date)).size;
  const events = db
    .prepare('SELECT event_id, completion_key, status FROM point_events WHERE member_id = ? AND policy_version = ?')
    .all(viewerId, policy.version)
    .map((row) => {
      const item = row as { event_id: string; completion_key: string; status: PointEvent['status'] };
      return { eventId: item.event_id, completionKey: item.completion_key, status: item.status };
    })
    .filter((event) => periodDates.some((periodDate) => event.completionKey === `${viewerId}:${PLAN_ID}:${periodDate}`));
  const entitlement = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM daily_point_entitlements WHERE member_id = ? AND active = 1 AND task_date IN (${placeholders})`).get(viewerId, ...periodDates) as { count: number; total: number };
  const points = Number(entitlement.count) > 0 ? Math.max(0, Number(entitlement.total)) : calculateNetPoints(events, policy).points;
  const target = periodDates.length * memberCount;
  const result: PeriodProgress = {
    periodStart: periodDates[0],
    periodEnd: periodDates[periodDates.length - 1],
    completed: completedTasks.size,
    target,
    personalCompleted,
    points,
    personalPoints: points,
    policyStatus: policy.status,
    policyVersion: policy.version,
    pointsPerCompletion: Math.max(0, policy.pointsPerCompletion),
  };
  if (includeGoal && policy.status === 'ACTIVE' && Number.isInteger(policy.sharedGoalTarget)) {
    const goalTarget = Math.min(target, Math.max(0, Number(policy.sharedGoalTarget)));
    result.goalTarget = goalTarget;
    result.goalAchieved = goalTarget > 0 && completedTasks.size >= goalTarget;
  }
  return result;
}

function personalEarnedPoints(db: DatabaseSync, memberId: string, policy: PointPolicy): number {
  const entitlement = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM daily_point_entitlements WHERE member_id = ? AND active = 1').get(memberId) as { count: number; total: number };
  if (Number(entitlement.count) > 0) return Math.max(0, Number(entitlement.total));
  const events = db.prepare('SELECT event_id, completion_key, status FROM point_events WHERE member_id = ? AND policy_version = ?').all(memberId, policy.version).map((row) => {
    const item = row as { event_id: string; completion_key: string; status: PointEvent['status'] };
    return { eventId: item.event_id, completionKey: item.completion_key, status: item.status };
  });
  return calculateNetPoints(events, policy).points;
}

function handleProgress(db: DatabaseSync, viewerId: string, date: string, policy: PointPolicy, weeklyDates?: string[], scheduleDates?: string[], periodStart?: string, periodEnd?: string): ApiResponse {
  if (!isValidDateOnly(date)) return json(400, { error: 'INVALID_DATE' });
  const viewer = db.prepare('SELECT id, display_name FROM members WHERE id = ?').get(viewerId) as { id: string; display_name: string } | undefined;
  if (!viewer) return json(403, { error: 'UNKNOWN_MEMBER' });
  // Keep this legacy response shape for older clients, but scope every
  // projection to the authenticated member. The retired group surface must
  // never disclose peer names, statuses, counts, or aggregate points.
  const members = [viewer];
  const records = new Map(
    db
      .prepare('SELECT member_id, status, revision FROM completions WHERE plan_id = ? AND task_date = ?')
      .all(PLAN_ID, date)
      .map((row) => {
        const item = row as { member_id: string; status: string; revision: number };
        return [item.member_id, item] as const;
      }),
  );
  const masked = members.map((member) => {
    const identity = maskForViewer(viewerId, { id: member.id, displayName: member.display_name });
    const completion = records.get(member.id);
    return {
      ...identity,
      status: completion?.status ?? 'UNREPORTED',
    };
  }).sort((left, right) => Number(right.isSelf) - Number(left.isSelf));
  const completed = masked.filter((member) => member.status === 'COMPLETED').length;
  const personal = masked.find((member) => member.isSelf);
  const personalRecord = records.get(viewerId);
  const requestedPeriodDates = periodStart && periodEnd && scheduleDates
    ? scheduleDates.filter((scheduledDate) => scheduledDate >= periodStart && scheduledDate <= periodEnd && scheduledDate <= date)
    : undefined;
  const effectiveWeeklyDates = requestedPeriodDates ?? weeklyDates ?? defaultWeeklyDates(scheduleDates, date);
  const weekly = effectiveWeeklyDates && effectiveWeeklyDates.length > 0
    ? getPeriodProgress(db, viewerId, members.length, effectiveWeeklyDates, policy, true)
    : undefined;
  const monthPrefix = date.slice(0, 7);
  const monthlyDates = scheduleDates?.filter((scheduledDate) => scheduledDate.startsWith(`${monthPrefix}-`) && scheduledDate <= date);
  const monthly = monthlyDates && monthlyDates.length > 0
    ? getPeriodProgress(db, viewerId, members.length, monthlyDates, policy)
    : undefined;
  return json(200, {
    date,
    members: masked,
    completed,
    totalMembers: members.length,
    personal: personal
      ? {
          status: personal.status,
          revision: personalRecord?.revision ?? 0,
          points: personalEarnedPoints(db, viewerId, policy),
        }
      : null,
    ...(weekly ? { weekly } : {}),
    ...(monthly ? { monthly } : {}),
    pointsPolicy: {
      status: policy.status,
      version: policy.version,
      pointsPerCompletion: Math.max(0, policy.pointsPerCompletion),
    },
    version: 1,
  });
}

export function createApiHandler(options: ApiHandlerOptions) {
  ensureGamificationSchema(options.db.db);
  ensureJournalSchema(options.db.db);
  ensureEventRegistrationSchema(options.db.db);
  ensureDevotionSchema(options.db.db);
  ensureCongregationSchema(options.db.db);
  const songTitle = options.songTitle ?? createSongTitleLookup();
  if (options.scheduleDates && options.scheduleDates.length > 0) {
    // Existing tests and local deployments can narrow the aggregate period without
    // replacing the canonical reading-day source. Dates already present retain their
    // references; a new date is represented by its plan and an empty reference list
    // only when the caller has explicitly inserted it into reading_days.
  }
  const now = options.now ?? (() => new Date());
  const resolveChapterAudio = createChapterAudioResolver();
  if (options.prewarmChapterAudio) {
    const versions = options.prewarmVersionIds ?? [46, 40, 111, 406, 114];
    const warm = () => {
      try {
        const today = taipeiDate(now());
        const tomorrow = new Date(`${today}T12:00:00.000Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const rows = options.db.db.prepare('SELECT references_json FROM reading_days WHERE task_date >= ? AND task_date <= ?').all(today, tomorrow.toISOString().slice(0, 10)) as Array<{ references_json: string }>;
        const usfms = [...new Set(rows.flatMap((row) => { try { return JSON.parse(row.references_json) as string[]; } catch { return []; } }))];
        void prewarmChapterAudio(resolveChapterAudio, versions, usfms);
      } catch { /* prewarm never affects serving */ }
    };
    const unref = (timer: unknown) => { (timer as { unref?: () => void }).unref?.(); };
    // Scripture does not change and the observed audio address is content-hashed, so there is
    // nothing to poll for. The only thing that moves is which chapters are assigned, and that
    // moves once, at Taipei midnight. So warm then: once at start-up (a mid-day restart still
    // gets a warm cache), then at each date rollover.
    const msUntilTaipeiMidnight = () => {
      const current = now();
      const [year, month, day] = taipeiDate(current).split('-').map(Number);
      // Taipei is UTC+8 all year, so the next local midnight is 16:00 UTC on the same civil day.
      const rollover = Date.UTC(year, month - 1, day, 16, 0, 0, 0);
      const remaining = rollover - current.getTime();
      return remaining > 0 ? remaining : remaining + 24 * 60 * 60 * 1000;
    };
    const scheduleNextDay = () => {
      unref(setTimeout(() => { warm(); scheduleNextDay(); }, msUntilTaipeiMidnight()));
    };
    unref(setTimeout(warm, 3_000));
    scheduleNextDay();
  }
  const appleChallenges = new Map<string, number>();
  const sessions = { resolveDevice: (token: string) => resolveDeviceSession(options.db.db, token), isLegacyRevoked: (token: string) => isLegacySessionRevoked(options.db.db, token) };
  const remoteStatus = options.remoteReminderStatus ?? 'REMOTE_PENDING';
  const policy = options.pointPolicy ?? DEFAULT_POLICY;
  const configuredAdminMemberIds = options.adminMemberIds ?? (process.env.QINGMU_ADMIN_MEMBER_IDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []);
  const configuredAdminSubjects = options.adminGoogleSubjects ?? (process.env.QINGMU_ADMIN_GOOGLE_SUBJECTS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []);
  const resolvedAdminMemberIds = (): string[] => {
    const ids = new Set(configuredAdminMemberIds);
    if (configuredAdminSubjects.length > 0) {
      const placeholders = configuredAdminSubjects.map(() => '?').join(',');
      const rows = options.db.db.prepare(`SELECT member_id FROM identity_bindings WHERE provider='google' AND subject IN (${placeholders})`).all(...configuredAdminSubjects) as Array<{ member_id: string }>;
      for (const row of rows) ids.add(row.member_id);
    }
    return [...ids];
  };
  const disableMeetingReminders = options.disableMeetingReminders ?? process.env.QINGMU_DISABLE_MEETING_REMINDERS === 'true';
  return async function handle(request: ApiRequest): Promise<ApiResponse> {
    const url = parsePath(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(200, {
        status: 'ok',
        instanceId: options.instanceId ?? 'unconfigured',
        authMode: options.authMode ?? (options.productionGoogleAuth ? 'google-only' : 'fixture'),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/device/reminders/revoke') {
      const installationId = request.headers['x-qingmu-installation-id'];
      const token = request.headers['x-qingmu-device-token'];
      if (!installationId?.trim() || !token?.trim()) return json(401, { error: 'DEVICE_DELIVERY_AUTH_REQUIRED' });
      try {
        const body = parseBody(request.body);
        if (typeof body.member_id !== 'string' || !body.member_id.trim() || typeof body.binding_version !== 'number' || !Number.isSafeInteger(body.binding_version) || body.binding_version < 1 || typeof body.owner_generation !== 'number' || !Number.isSafeInteger(body.owner_generation) || body.owner_generation < 0) return json(400, { error: 'INVALID_DEVICE_REVOKE' });
        const now = new Date().toISOString();
        // Authentication and mutation share one exact predicate; a late owner cannot revoke a newer binding.
        const revoked = options.db.db.prepare(`UPDATE device_delivery_tokens SET revoked_at=?,updated_at=?
          WHERE installation_id=? AND token=? AND member_id=? AND platform='ANDROID'
            AND binding_version=? AND owner_generation=? AND revoked_at IS NULL`).run(now,now,installationId.trim(),token.trim(),body.member_id.trim(),body.binding_version,body.owner_generation);
        return Number(revoked.changes) === 1 ? json(200, { revoked: true }) : json(403, { error: 'DEVICE_DELIVERY_REVOKED' });
      } catch (error) { return json(error instanceof Error && error.message === 'INVALID_JSON' ? 400 : 500, { error: error instanceof Error && error.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'DEVICE_REMINDER_ERROR' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/device/reminders/validate') {
      const installationId = request.headers['x-qingmu-installation-id'];
      const token = request.headers['x-qingmu-device-token'];
      if (!installationId || !token) return json(401, { error: 'DEVICE_DELIVERY_AUTH_REQUIRED' });
      try {
        const body = parseBody(request.body);
        if (typeof body.meeting_id !== 'string' || !body.meeting_id.trim() || typeof body.schedule_revision !== 'number' || !Number.isSafeInteger(body.schedule_revision) || body.schedule_revision < 1) return json(400, { error: 'INVALID_DEVICE_REMINDER_EVENT' });
        const snapshot = authorizeDeviceMeetingSnapshot(options.db.db, { installationId, token, meetingId: body.meeting_id });
        if (!snapshot) return json(403, { error: 'DEVICE_DELIVERY_REVOKED' });
        return json(200, { ...snapshot, valid: snapshot.status === 'SCHEDULED' && snapshot.scheduleRevision === body.schedule_revision });
      } catch (error) { return json(error instanceof Error && error.message === 'INVALID_JSON' ? 400 : 500, { error: error instanceof Error && error.message === 'INVALID_JSON' ? 'INVALID_JSON' : 'DEVICE_REMINDER_ERROR' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/session/apple/challenge' && options.productionAppleAuth) {
      for (const [nonce, expiry] of appleChallenges) if (expiry <= now().getTime()) appleChallenges.delete(nonce);
      if (appleChallenges.size >= 1000) return json(429, { error: 'TRY_LATER' });
      const nonce = randomBytes(32).toString('base64url');
      appleChallenges.set(nonce, now().getTime() + 300_000);
      return json(200, { nonce });
    }
    if (request.method === 'POST' && url.pathname === '/api/session/apple' && options.productionAppleAuth && options.sessionSecret) {
      const token = (request.headers.authorization ?? request.headers.Authorization)?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return json(401, { error: 'AUTH_REQUIRED' });
      let body: Record<string, unknown>;
      try { body = parseBody(request.body); } catch { return json(400, { error: 'INVALID_JSON' }); }
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      const expires = appleChallenges.get(nonce);
      appleChallenges.delete(nonce);
      if (!expires || expires <= now().getTime()) return json(401, { error: 'APPLE_NONCE_INVALID' });
      let identity: AppleIdentity;
      try { identity = await options.productionAppleAuth.verify(token, nonce); } catch { return json(401, { error: 'AUTH_INVALID' }); }
      let refreshToken: string | undefined;
      if (options.productionAppleAuth.exchangeCode) {
        if (typeof body.authorization_code !== 'string' || !body.authorization_code) return json(400, { error: 'APPLE_CODE_REQUIRED' });
        try { refreshToken = await options.productionAppleAuth.exchangeCode(body.authorization_code, identity.subject); }
        catch { return json(503, { error: 'APPLE_AUTH_UNAVAILABLE' }); }
      }
      const db = options.db.db;
      db.exec('BEGIN IMMEDIATE');
      try {
        let memberId = (db.prepare("SELECT member_id FROM identity_bindings WHERE provider='apple' AND subject=?").get(identity.subject) as { member_id: string } | undefined)?.member_id;
        if (!memberId) {
          memberId = randomUUID();
          const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 80) : '';
          db.prepare('INSERT INTO members(id,display_name,group_id) VALUES(?,?,?)').run(memberId, displayName || '竹科聖經會員', `unassigned:${memberId}`);
          db.prepare('INSERT INTO identity_bindings(provider,subject,member_id,created_at) VALUES(?,?,?,?)').run('apple', identity.subject, memberId, now().toISOString());
        }
        if (!isMemberEnabled(db, memberId)) { db.exec('ROLLBACK'); return json(403, { error: 'ACCOUNT_DISABLED' }); }
        if (refreshToken) db.prepare('INSERT INTO apple_refresh_tokens(member_id,encrypted_token) VALUES(?,?) ON CONFLICT(member_id) DO UPDATE SET encrypted_token=excluded.encrypted_token').run(memberId, sealAppleToken(refreshToken, options.sessionSecret));
        const result = createDeviceSession(db, memberId);
        db.exec('COMMIT');
        return json(200, result);
      } catch { db.exec('ROLLBACK'); return json(500, { error: 'INTERNAL_ERROR' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/session/google' && options.productionGoogleAuth && options.sessionSecret) {
      const authorization = request.headers.authorization ?? request.headers.Authorization;
      const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return json(401, { error: 'AUTH_REQUIRED' });
      let identity: Awaited<ReturnType<NonNullable<ApiHandlerOptions['productionGoogleAuth']>['verify']>>;
      try { identity = await options.productionGoogleAuth.verify(token); } catch { return json(401, { error: 'AUTH_INVALID' }); }
      let memberId = (options.db.db.prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as { member_id: string } | undefined)?.member_id ?? null;
      if (!memberId) memberId = await options.productionGoogleAuth.resolveMember(identity);
      let body: Record<string, unknown>;
      try { body = parseBody(request.body); } catch { return json(400, { error: 'INVALID_JSON' }); }
      if (!memberId && options.autoProvisionGoogleMembers) {
        memberId = randomUUID();
        try {
          options.db.db.exec('BEGIN IMMEDIATE');
          const existing = options.db.db.prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as { member_id: string } | undefined;
          if (existing) memberId = existing.member_id;
          else {
            // A Play pre-launch test device is created already turned off, so it never reads, votes or ranks
            // (server/testLabNetwork.ts). Only new identities: an existing member is never turned off here.
            const testDevice = body.firebase_test_lab === true || isTestLabAddress(request.headers['cf-connecting-ip']);
            options.db.db.prepare('INSERT INTO members(id, display_name, group_id, disabled_at) VALUES(?,?,?,?)').run(memberId, identity.displayName?.trim() || '竹科聖經會員', `unassigned:${memberId}`, testDevice ? Date.now() : null);
            console.log(`AUTO_PROVISION_MEMBER testDevice=${testDevice} clientAddress=${request.headers['cf-connecting-ip'] ? 'present' : 'missing'}`);
            options.db.db.prepare('INSERT INTO identity_bindings(provider, subject, member_id, created_at) VALUES(?,?,?,?)').run(identity.provider, identity.subject, memberId, Date.now());
          }
          options.db.db.exec('COMMIT');
        } catch (error) {
          try { options.db.db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
          throw error;
        }
      }
      if (!memberId) return json(403, { error: 'UNKNOWN_MEMBER' });
      if (!isMemberEnabled(options.db.db, memberId)) return json(403, { error: 'ACCOUNT_DISABLED' });
      if (body.session_type === 'device') return json(200, createDeviceSession(options.db.db, memberId));
      return json(200, {
        sessionToken: createSessionToken(memberId, options.sessionSecret),
        memberId,
        expiresInSeconds: 3600,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/onboarding/claim' && options.productionGoogleAuth && options.sessionSecret) {
      let body: Record<string, unknown>;
      try {
        body = parseBody(request.body);
        const authorization = request.headers.authorization ?? request.headers.Authorization;
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!token) return json(401, { error: 'AUTH_REQUIRED' });
        const identity = await options.productionGoogleAuth.verify(token);
        const claim = claimMemberInvite(options.db.db, { provider: identity.provider, subject: identity.subject, code: inviteCode(body) });
        if (!claim.ok) return json(claim.error === 'INVITE_INVALID' || claim.error === 'INVITE_EXPIRED' || claim.error === 'INVITE_USED' ? 403 : 409, { error: claim.error });
        if (!isMemberEnabled(options.db.db, claim.memberId)) return json(403, { error: 'ACCOUNT_DISABLED' });
        if (body.session_type === 'device') return json(200, { ...createDeviceSession(options.db.db, claim.memberId), alreadyBound: claim.alreadyBound });
        return json(200, {
          sessionToken: createSessionToken(claim.memberId, options.sessionSecret),
          memberId: claim.memberId,
          expiresInSeconds: 3600,
          alreadyBound: claim.alreadyBound,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
        if (message === 'INVALID_JSON' || message === 'INVALID_INVITE_CODE') return json(400, { error: message });
        if (message.startsWith('GOOGLE_')) return json(401, { error: 'AUTH_INVALID' });
        return json(500, { error: 'INTERNAL_ERROR' });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/session/revoke' && options.sessionSecret) {
      const token = (request.headers.authorization ?? request.headers.Authorization)?.match(/^Bearer\s+(.+)$/i)?.[1];
      return token && revokeSession(options.db.db, token, options.sessionSecret) ? json(200, { revoked: true }) : json(401, { error: 'AUTH_INVALID' });
    }
    // The owner's Apps Scripts (sign-up forms, and the prize sheet below) prove themselves the same way.
    const integrationAuthorized = async () => {
      const provided = request.headers['x-qingmu-registration-key'] ?? request.headers['X-Qingmu-Registration-Key'];
      const idToken = (request.headers.authorization ?? request.headers.Authorization)?.match(/^Bearer\s+(.+)$/i)?.[1];
      return (options.formRegistrationKey !== undefined && formRegistrationKeyMatches(typeof provided === 'string' ? provided : undefined, options.formRegistrationKey))
        || (options.formSyncIdentity !== undefined && idToken !== undefined && await formSyncIdentityMatches(options.db.db, options.formSyncIdentity, idToken, now()));
    };
    // 獎品與兌換 (維護者 2026-10-17): the Google Sheet sends its four tabs; see server/rewardSheet.ts.
    if (request.method === 'POST' && url.pathname === '/api/integrations/reward-sheet' && (options.formRegistrationKey || options.formSyncIdentity)) {
      if (!await integrationAuthorized()) return json(401, { error: 'AUTH_INVALID' });
      let push: ReturnType<typeof readRewardSheetPush>;
      try { push = readRewardSheetPush(parseBody(request.body)); } catch { return json(400, { error: 'INVALID_JSON' }); }
      if (!push) return json(400, { error: 'INVALID_REWARD_SHEET' });
      ensureCongregationSchema(options.db.db);
      const syncedAt = now();
      const result = applyRewardSheet(options.db.db, push, syncedAt.toISOString());
      return json(200, { ok: true, ...result, readingStats: rewardSheetReadingStats(options.db.db, syncedAt) });
    }
    if (request.method === 'POST' && url.pathname === '/api/integrations/form-registrations' && (options.formRegistrationKey || options.formSyncIdentity)) {
      if (!await integrationAuthorized()) return json(401, { error: 'AUTH_INVALID' });
      let push: ReturnType<typeof readFormRegistrationPush>;
      try { push = readFormRegistrationPush(parseBody(request.body)); } catch { return json(400, { error: 'INVALID_JSON' }); }
      if (!push) return json(400, { error: 'INVALID_REGISTRATIONS' });
      return json(200, { ok: true, events: replaceEventRegistrations(options.db.db, push, now()) });
    }
    const auth = options.productionGoogleAuth && options.sessionSecret
      ? await authenticateSessionOrGoogle(request.headers, options.productionGoogleAuth, options.sessionSecret, sessions)
      : authenticate(request.headers, options.fixtureToken ?? '', (id) => memberExists(options.db.db, id), options.fixtureDefaultMemberId);
    if ('status' in auth) return isGamificationPath(url.pathname) ? gamificationError({ status: auth.status, code: auth.error }) : json(auth.status, { error: auth.error });
    if (!memberExists(options.db.db, auth.memberId)) return isGamificationPath(url.pathname) ? gamificationError({ status: 401, code: 'AUTH_INVALID' }) : json(401, { error: 'AUTH_INVALID' });
    if (!isMemberEnabled(options.db.db, auth.memberId)) return isGamificationPath(url.pathname) ? gamificationError({ status: 401, code: 'AUTH_INVALID' }) : json(401, { error: 'ACCOUNT_DISABLED' });
    if (request.method === 'POST' && url.pathname === '/api/session/device' && options.productionGoogleAuth && options.sessionSecret) {
      return json(200, createDeviceSession(options.db.db, auth.memberId));
    }

    try {
      if (request.method === 'DELETE' && url.pathname === '/api/me') {
        const body = parseBody(request.body);
        if (body.confirmed !== true) return json(400, { error: 'CONFIRMATION_REQUIRED' });
        const stored = options.db.db.prepare('SELECT encrypted_token FROM apple_refresh_tokens WHERE member_id=?').get(auth.memberId) as { encrypted_token: string } | undefined;
        const isAppleMember = Boolean(stored || options.db.db.prepare("SELECT 1 FROM identity_bindings WHERE member_id=? AND provider='apple'").get(auth.memberId));
        const canRevoke = Boolean(options.productionAppleAuth?.revoke && options.sessionSecret);
        if (stored && options.productionAppleAuth?.revoke && options.sessionSecret) {
          try { await options.productionAppleAuth.revoke(openAppleToken(stored.encrypted_token, options.sessionSecret)); }
          catch { return json(503, { error: 'APPLE_REVOCATION_UNAVAILABLE' }); }
        }
        deleteMemberAccount(options.db.db, auth.memberId);
        // Missing private-key configuration must not prevent deletion of our data.
        // The audit event deliberately contains no token, subject, member ID or name.
        if (isAppleMember && (!canRevoke || !stored)) console.warn('Apple token 未撤銷', {
          reason: !canRevoke ? 'PRIVATE_KEY_NOT_CONFIGURED' : 'REFRESH_TOKEN_NOT_AVAILABLE',
        });
        return json(200, { deleted: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/reading-days') {
        const today = taipeiDate(now());
        const from = url.searchParams.get('from') ?? today;
        const to = url.searchParams.get('to') ?? today;
        if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) return gamificationError({ status: 400, code: 'INVALID_DATE_RANGE' });
        const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
        if (span > 62) return gamificationError({ status: 400, code: 'DATE_RANGE_TOO_LARGE' });
        return gamificationJson(200, { days: readReadingDays(options.db.db, from, to, today, auth.memberId), timezone: 'Asia/Taipei', today });
      }
      // Each congregation has its own prize list (維護者 2026-10-17); a member aims only at their own side's.
      if (request.method === 'GET' && url.pathname === '/api/rewards') {
        return gamificationJson(200, { rewards: listRewards(options.db.db, congregationOf(options.db.db, auth.memberId)) });
      }
      if (request.method === 'GET' && url.pathname === '/api/points/people') {
        const scope = url.searchParams.get('scope');
        if (scope !== 'friends' && scope !== 'all') return gamificationError({ status: 400, code: 'INVALID_SCOPE' });
        const people = getPeople(options.db.db, auth.memberId, scope, resolvedAdminMemberIds());
        return Array.isArray(people) ? gamificationJson(200, { scope, people }) : gamificationError(people);
      }
      const scoreProfileMatch = url.pathname.match(/^\/api\/points\/profiles\/([^/]+)$/);
      if (request.method === 'GET' && scoreProfileMatch) {
        const memberId = decodeURIComponent(scoreProfileMatch[1]);
        const scope = url.searchParams.get('scope') ?? (memberId === auth.memberId ? 'me' : 'friends');
        if (scope !== 'me' && scope !== 'friends' && scope !== 'all') return gamificationError({ status: 400, code: 'INVALID_SCOPE' });
        if (scope === 'me' && memberId !== auth.memberId) return gamificationError({ status: 404, code: 'MEMBER_NOT_ACCESSIBLE' });
        const adminMembers = resolvedAdminMemberIds();
        if (scope === 'all' && !adminMembers.includes(auth.memberId)) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        if (scope === 'friends' && !canViewMember(options.db.db, auth.memberId, memberId, [])) return gamificationError({ status: 404, code: 'MEMBER_NOT_ACCESSIBLE' });
        const anchorMonth = url.searchParams.get('anchorMonth') ?? taipeiDate(now()).slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchorMonth)) return gamificationError({ status: 400, code: 'INVALID_MONTH' });
        if (anchorMonth > taipeiDate(now()).slice(0, 7)) return gamificationError({ status: 400, code: 'FUTURE_MONTH_NOT_ALLOWED' });
        const rawChartRange = url.searchParams.get('chartRange') ?? 'month';
        if (!isScoreChartRange(rawChartRange)) return gamificationError({ status: 400, code: 'INVALID_CHART_RANGE' });
        const rawChartAnchor = url.searchParams.get('chartAnchor');
        if (rawChartRange === 'all' && rawChartAnchor !== null) return gamificationError({ status: 400, code: 'INVALID_CHART_ANCHOR' });
        const chartQuery: ScoreChartQuery = { range: rawChartRange, ...(rawChartAnchor !== null ? { anchor: rawChartAnchor } : {}) };
        let profile;
        try {
          profile = getScoreProfile(options.db.db, auth.memberId, memberId, anchorMonth, adminMembers, chartQuery, taipeiDate(now()));
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          if (code === 'INVALID_CHART_ANCHOR' || code === 'FUTURE_CHART_PERIOD') return gamificationError({ status: 400, code });
          throw error;
        }
        if (isGamificationError(profile)) return gamificationError(profile);
        if (scope !== 'me' && scope !== 'all') delete profile.private;
        if (scope === 'all' && !adminMembers.includes(auth.memberId)) delete profile.private;
        return gamificationJson(200, profile as unknown as Record<string, unknown>);
      }
      // The journal family takes no member parameter, by design: there is no shape of request
      // that names someone else, so there is no access rule to get wrong. See server/journal.ts.
      if (url.pathname === '/api/me/event-registrations' && request.method === 'GET') {
        const date = url.searchParams.get('date') ?? '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: 'INVALID_DATE' });
        return json(200, { ...getEventRegistrationView(options.db.db, auth.memberId, date) });
      }
      if (url.pathname === '/api/me/journal' && request.method === 'GET') {
        const entries = listJournalEntries(options.db.db, auth.memberId, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '');
        return isGamificationError(entries) ? gamificationError(entries) : gamificationJson(200, entries);
      }
      if (url.pathname.startsWith('/api/me/journal/')) {
        const taskDate = decodeURIComponent(url.pathname.slice('/api/me/journal/'.length));
        if (request.method === 'GET') {
          const entry = getJournalEntry(options.db.db, auth.memberId, taskDate);
          return isGamificationError(entry) ? gamificationError(entry) : gamificationJson(200, entry as unknown as Record<string, unknown>);
        }
        if (request.method === 'PUT') {
          // journal.md「決定」: journals stay on the phone. GET remains for 0.5.21 compatibility.
          return gamificationJson(405, { error: { code: 'JOURNAL_LOCAL_ONLY' } });
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/points/community') {
        return gamificationJson(200, getCommunityProgress(options.db.db, taipeiDate(now())) as unknown as Record<string, unknown>);
      }
      // 積分頁 團體 / 個人 and the 靈修 tab (維護者 2026-10-14). 靈修 earns no points and never
      // enters a group number; see server/devotionProgress.ts.
      if (request.method === 'GET' && url.pathname === '/api/points/group') {
        const today = taipeiDate(now());
        const view = getGroupReading(options.db.db, auth.memberId, url.searchParams.get('month') ?? today.slice(0, 7), today);
        return view ? gamificationJson(200, view as unknown as Record<string, unknown>) : gamificationError({ status: 400, code: 'INVALID_MONTH' });
      }
      // 青少/主堂 (維護者 2026-10-17): null until a new member chooses; see server/congregation.ts.
      if (url.pathname === '/api/me/congregation' && request.method === 'GET') {
        return gamificationJson(200, { congregation: chosenCongregation(options.db.db, auth.memberId) });
      }
      if (url.pathname === '/api/me/congregation' && request.method === 'PUT') {
        const value = parseBody(request.body).congregation;
        if (!isCongregation(value)) return gamificationError({ status: 400, code: 'INVALID_CONGREGATION' });
        return gamificationJson(200, { congregation: setCongregation(options.db.db, auth.memberId, value, now().toISOString()) });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/score-history') {
        return gamificationJson(200, getScoreHistory(options.db.db, auth.memberId, taipeiDate(now())) as unknown as Record<string, unknown>);
      }
      if (request.method === 'GET' && url.pathname === '/api/me/devotions') {
        const dates = listDevotionDates(options.db.db, auth.memberId, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '');
        return dates ? gamificationJson(200, { dates }) : gamificationError({ status: 400, code: 'INVALID_DATE' });
      }
      const devotionMatch = url.pathname.match(/^\/api\/me\/devotions\/([^/]+)$/);
      if (devotionMatch && (request.method === 'PUT' || request.method === 'DELETE')) {
        const result = setDevotion(options.db.db, auth.memberId, decodeURIComponent(devotionMatch[1]), request.method === 'PUT', taipeiDate(now()), now().getTime());
        return 'error' in result ? gamificationError({ status: 400, code: result.error }) : gamificationJson(200, result);
      }
      const audioMatch = url.pathname.match(/^\/api\/devotional\/([^/]+)\/audio\/([^/]+)$/);
      if (request.method === 'GET' && audioMatch) {
        const date = decodeURIComponent(audioMatch[1]);
        const voice = url.searchParams.get('voice') ?? DEFAULT_DEVOTION_VOICE;
        if (!isDevotionalDate(date) || !/^\d+$/.test(audioMatch[2]) || !isDevotionVoice(voice)) return gamificationError({ status: 400, code: 'INVALID_DEVOTIONAL_AUDIO' });
        if (!options.devotionalAudio) return gamificationError({ status: 404, code: 'DEVOTIONAL_AUDIO_UNAVAILABLE' });
        // How long the server took, so a paragraph that fell back to device speech can be placed on the
        // server, the network or the phone (2026-10-16). Counts only: never the text.
        const started = Date.now();
        const served = (status: number, source: 'cache' | 'azure' | 'none') =>
          console.log(`DEVOTIONAL_AUDIO_REQUEST date=${date} index=${audioMatch[2]} voice=${voice} status=${status} source=${source} ms=${Date.now() - started}`);
        // Audio never needs a song-title lookup or a request to YouTube.
        const post = await readDevotional(options.devotionalDir, date, async () => null);
        const index = Number(audioMatch[2]);
        const unit = post ? speechUnits(post)[index] : undefined;
        if (!unit?.text) { served(404, 'none'); return gamificationError({ status: 404, code: 'DEVOTIONAL_AUDIO_NOT_FOUND' }); }
        try {
          const { bytes: binaryBody, source } = await options.devotionalAudio.synthesize(date, index, voice, unit.text);
          served(200, source);
          return { status: 200, body: {}, binaryBody, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } };
        } catch { served(502, 'none'); return gamificationJson(502, { error: { code: 'DEVOTIONAL_AUDIO_UPSTREAM', retryable: true } }); }
      }
      // 公告「主堂」 (維護者 2026-10-17): the 週刊 pages, newest Sunday first; members only.
      if (request.method === 'GET' && url.pathname === '/api/bulletins') {
        return gamificationJson(200, { weeks: listBulletins(options.bulletinDir) });
      }
      const bulletinPage = url.pathname.match(/^\/api\/bulletins\/(\d{4}-\d{2}-\d{2})\/(\d{1,2})$/);
      if (request.method === 'GET' && bulletinPage) {
        const bytes = readBulletinPage(options.bulletinDir, bulletinPage[1], Number(bulletinPage[2]));
        return bytes ? { status: 200, body: {}, binaryBody: bytes, headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=604800' } }
          : gamificationError({ status: 404, code: 'BULLETIN_NOT_FOUND' });
      }
      const devotionalMatch = url.pathname.match(/^\/api\/devotional\/([^/]+)$/);
      if (request.method === 'GET' && devotionalMatch) {
        const date = decodeURIComponent(devotionalMatch[1]);
        if (!isDevotionalDate(date)) return gamificationError({ status: 400, code: 'INVALID_DATE' });
        const post = await readDevotional(options.devotionalDir, date, songTitle);
        return post ? gamificationJson(200, post as unknown as Record<string, unknown>) : gamificationError({ status: 404, code: 'DEVOTIONAL_NOT_FOUND' });
      }
      // Prize nominations were removed on 2026-10-17 (維護者: vote offline). Apps up to 0.5.32 still ask for the board on
      // the 積分 page; an idle board keeps them quiet instead of showing an error.
      if (url.pathname === '/api/rewards/nominations' && request.method === 'GET') {
        return gamificationJson(200, { round: null, nominations: [], votesLeft: 0, votesPerMember: 3 });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/redemptions') {
        // Projected, not filtered: see projectMemberRedemption for why the acting administrator
        // never appears in a member's own history.
        // In-app redemptions from before 2026-10-17, then the sheet's rows, newest first.
        const rows = [...getRedemptions(options.db.db, auth.memberId).map(projectMemberRedemption), ...sheetRedemptionsFor(options.db.db, auth.memberId)];
        return gamificationJson(200, { redemptions: rows.sort((left, right) => Number(right.confirmedAt ?? 0) - Number(left.confirmedAt ?? 0)) });
      }
      if (request.method === 'PUT' && url.pathname === '/api/me/reward-target') {
        const body = parseBody(request.body);
        if (typeof body.rewardId !== 'string' || !body.rewardId.trim()) return gamificationError({ status: 400, code: 'INVALID_REWARD' });
        if (!listRewards(options.db.db, congregationOf(options.db.db, auth.memberId)).some((reward) => reward.rewardId === body.rewardId)) return gamificationError({ status: 409, code: 'REWARD_NOT_AVAILABLE' });
        const result = setRewardTarget(options.db.db, auth.memberId, body.rewardId, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, result);
      }
      if (request.method === 'POST' && url.pathname === '/api/friends/qr') {
        const result = issueFriendToken(options.db.db, auth.memberId, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, result);
      }
      if (request.method === 'POST' && url.pathname === '/api/friends/claim') {
        const body = parseBody(request.body);
        if (typeof body.operationId !== 'string' || !body.operationId.trim() || typeof body.token !== 'string' || !body.token.trim()) return gamificationError({ status: 400, code: 'INVALID_FRIEND_CLAIM' });
        const replay = Boolean(options.db.db.prepare('SELECT 1 FROM mutation_receipts WHERE actor_member_id=? AND operation_id=?').get(auth.memberId, body.operationId));
        const result = claimFriend(options.db.db, auth.memberId, body.operationId, body.token, { now });
        if (isGamificationError(result)) return gamificationError(result);
        // Only the claim that made the friendship announces it; a replayed operation or a second scan
        // of an existing friend says nothing. Not awaited: the push never shapes this answer.
        if (!replay && result.friendshipCreated === true && typeof result.memberId === 'string' && (options.pushData || options.pushIos)) {
          void notifyFriendAdded(options.db.db, { android: options.pushData, ios: options.pushIos }, { ownerMemberId: result.memberId, friendMemberId: auth.memberId }).catch(() => { console.warn('FRIEND_PUSH_FAILED', 'NOTIFY_ERROR'); });
        }
        return gamificationJson(200, result);
      }
      const removeFriendMatch = url.pathname.match(/^\/api\/friends\/([^/]+)$/);
      if (request.method === 'DELETE' && removeFriendMatch) {
        const result = removeFriend(options.db.db, auth.memberId, decodeURIComponent(removeFriendMatch[1]), { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, { removed: result });
      }
      // 後台規則與文件 (維護者 2026-10-17): administrators only; the app also asks for the device unlock first.
      if (request.method === 'GET' && url.pathname === '/api/admin/documents') {
        if (!resolvedAdminMemberIds().includes(auth.memberId)) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        return gamificationJson(200, { links: readAdminLinks(options.adminLinksFile) });
      }
      if (url.pathname === '/api/me/reminders' || url.pathname === '/api/me/reminders/device-token' || url.pathname === '/api/me/reminders/device-token/revoke') {
        if (!options.db.db.prepare('SELECT id FROM members WHERE id = ?').get(auth.memberId)) return json(404, { error: 'PROFILE_NOT_FOUND' });
        if (request.method === 'GET' && url.pathname === '/api/me/reminders') {
          const snapshot = readReminderPreferences(options.db.db, auth.memberId, remoteStatus);
          return json(200, disableMeetingReminders ? { ...snapshot, meetingEnabled: false, meetings: [] } : snapshot);
        }
        if (request.method === 'PUT' && url.pathname === '/api/me/reminders') {
          const body = parseBody(request.body);
          if (typeof body.reading_enabled !== 'boolean' || typeof body.meeting_enabled !== 'boolean') return json(400, { error: 'INVALID_REMINDER_PREFERENCES' });
          const current = readReminderPreferences(options.db.db, auth.memberId, remoteStatus);
          const readingTime = body.reading_time === undefined ? current.readingTime : body.reading_time;
          const meetingAdvanceMinutes = body.meeting_advance_minutes === undefined ? current.meetingAdvanceMinutes : body.meeting_advance_minutes;
          const preferenceGeneration = body.preference_generation === undefined ? current.preferenceGeneration : body.preference_generation;
          if (typeof readingTime !== 'string' || typeof meetingAdvanceMinutes !== 'number' || typeof preferenceGeneration !== 'number') return json(400, { error: 'INVALID_REMINDER_PREFERENCES' });
          const saved = saveReminderPreferences(options.db.db, auth.memberId, { readingEnabled: body.reading_enabled, meetingEnabled: disableMeetingReminders ? false : body.meeting_enabled, readingTime, meetingAdvanceMinutes, preferenceGeneration }, remoteStatus);
          return json(200, disableMeetingReminders ? { ...saved, meetingEnabled: false, meetings: [] } : saved);
        }
        if (request.method === 'POST' && url.pathname === '/api/me/reminders/device-token') {
          const body = parseBody(request.body);
          const ownerGeneration = body.owner_generation === undefined ? 0 : body.owner_generation;
          if (typeof body.installation_id !== 'string' || !body.installation_id.trim() || typeof body.token !== 'string' || !body.token.trim() || (body.platform !== 'ANDROID' && body.platform !== 'IOS') || typeof ownerGeneration !== 'number' || !Number.isSafeInteger(ownerGeneration) || ownerGeneration < 0) return json(400, { error: 'INVALID_DEVICE_TOKEN' });
          return json(200, { ...registerDeviceDeliveryToken(options.db.db, { memberId: auth.memberId, installationId: body.installation_id.trim(), token: body.token.trim(), ownerGeneration, platform: body.platform as 'ANDROID' | 'IOS' }), remoteDeliveryStatus: remoteStatus });
        }
        if (request.method === 'POST' && url.pathname === '/api/me/reminders/device-token/revoke') {
          const body = parseBody(request.body);
          if (typeof body.installation_id !== 'string' || !body.installation_id.trim()) return json(400, { error: 'INVALID_DEVICE_TOKEN' });
          if ((body.binding_version !== undefined && (typeof body.binding_version !== 'number' || !Number.isSafeInteger(body.binding_version) || body.binding_version < 1)) || (body.owner_generation !== undefined && (typeof body.owner_generation !== 'number' || !Number.isSafeInteger(body.owner_generation) || body.owner_generation < 0))) return json(400, { error: 'INVALID_DEVICE_TOKEN' });
          return json(200, { revoked: revokeDeviceDeliveryToken(options.db.db, auth.memberId, body.installation_id.trim(), body.binding_version as number | undefined, body.owner_generation as number | undefined) });
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/content-capabilities') {
        if (url.searchParams.has('versionId') || url.searchParams.has('usfm')) {
          const parsed = parseCapabilityQuery({
            versionId: url.searchParams.get('versionId') ?? undefined,
            usfm: url.searchParams.get('usfm') ?? undefined,
          });
          if (!parsed.ok) return json(400, { error: parsed.error });
          return json(200, { ...await resolveChapterAudio(parsed.versionId, parsed.usfm) } as unknown as Record<string, unknown>);
        }
        const gate = options.contentGate ?? {
          status: 'C_PENDING_ACCESS' as const,
          reason: 'Content authorization is pending',
          evidenceRefs: [],
        };
        return json(200, gate);
      }
      if (request.method === 'GET' && url.pathname === '/api/me/profile') {
        const member = options.db.db
          .prepare('SELECT id, display_name, group_id FROM members WHERE id = ?')
          .get(auth.memberId) as { id: string; display_name: string; group_id: string } | undefined;
        if (!member) return json(404, { error: 'PROFILE_NOT_FOUND' });
        const group = options.db.db
          .prepare('SELECT group_name FROM member_group_profiles WHERE member_id = ? ORDER BY rpg_id LIMIT 1')
          .get(auth.memberId) as { group_name: string } | undefined;
        const capabilities = getViewerCapabilities(options.db.db, auth.memberId, resolvedAdminMemberIds());
        return gamificationJson(200, {
          memberId: member.id,
          displayName: member.display_name,
          avatarUrl: null,
          groupId: member.group_id,
          groupName: group?.group_name ?? null,
          capabilities,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/groups') {
        const profile = getMemberGroupProfile(options.db.db, auth.memberId);
        if (!profile) return json(404, { error: 'GROUP_PROFILE_PENDING' });
        // The group/RPG surface is retired in v1. Keep the old response shape
        // for installed clients, but remove every peer roster and social or
        // meeting link so this compatibility endpoint cannot expose retired
        // group data or reopen those entry points.
        const retired = profile as { rpgs?: Array<Record<string, unknown>> };
        return json(200, {
          ...profile,
          rpgs: (retired.rpgs ?? []).map((rpg) => ({
            ...rpg,
            openChatUrl: null,
            callUrl: null,
            callProvider: null,
            callScope: null,
            meeting: null,
            roster: null,
          })),
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/progress') {
        return handleProgress(
          options.db.db,
          auth.memberId,
          url.searchParams.get('date') ?? '',
          policy,
          options.weeklyDates,
          options.scheduleDates,
          url.searchParams.get('period_start') ?? undefined,
          url.searchParams.get('period_end') ?? undefined,
        );
      }
      const match = url.pathname.match(/^\/api\/me\/completions\/([^/]+)\/([^/]+)$/);
      if (request.method === 'PUT' && match) {
        const candidateBody = parseBody(request.body);
        const operationId = candidateBody.operation_id;
        // Every completion write uses the v1 entitlement/wallet transaction.
        // Older clients may still send opaque operation IDs, but that is only
        // an input compatibility detail; it never selects a second points
        // writer or bypasses the schedule/window checks.
        if (typeof operationId !== 'string' || !operationId.trim()) return gamificationError({ status: 400, code: 'INVALID_COMPLETION_COMMAND' });
        const desiredStatus = candidateBody.status;
        const expectedRevision = candidateBody.expected_revision;
        if (!isCompletionStatusForRoute(desiredStatus) || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) return gamificationError({ status: 400, code: 'INVALID_COMPLETION_COMMAND' });
        const result = mutateCompletion(options.db.db, {
          memberId: auth.memberId,
          planId: decodeURIComponent(match[1]),
          taskDate: decodeURIComponent(match[2]),
          operationId,
          expectedRevision,
          status: desiredStatus,
          policyAmount: GAMIFICATION_POINT_AMOUNT,
          policyVersion: GAMIFICATION_POLICY_VERSION,
          now: now(),
        });
        if ('code' in result) {
          const details = result.details ?? {};
          return gamificationJson(result.status, {
            error: { code: result.code, retryable: false, ...(Object.keys(details).length > 0 ? { details } : {}) },
            ...(typeof details.status === 'string' ? { status: details.status } : {}),
            ...(typeof details.revision === 'number' ? { revision: details.revision } : {}),
          });
        }
        return gamificationJson(200, result as unknown as Record<string, unknown>);
      }
      return json(404, { error: 'NOT_FOUND' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      if (message === 'INVALID_JSON' || message.startsWith('INVALID_')) return isGamificationPath(url.pathname) ? gamificationError({ status: 400, code: message }) : json(400, { error: message });
      return json(500, { error: 'INTERNAL_ERROR' });
    }
  };
}

function isCompletionStatusForRoute(value: unknown): value is 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED' {
  return value === 'UNREPORTED' || value === 'NOT_COMPLETED' || value === 'COMPLETED';
}
