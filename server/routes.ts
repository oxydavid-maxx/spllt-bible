import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { maskForViewer } from '../src/domain/masking';
import { calculateNetPoints, type PointEvent, type PointPolicy } from '../src/domain/points';
import type { ContentGateStatus } from '../src/domain/types';
import { authenticate, authenticateGoogle, authenticateSessionOrGoogle, type ProductionGoogleAuth } from './authBoundary';
import { claimMemberInvite } from './membership';
import { createSessionToken } from './session';
import { parseCapabilityQuery } from './contentCapabilities';
import { createChapterAudioResolver, prewarmChapterAudio } from './genericChapterAudio';
import { getMemberGroupProfile } from './groups';
import { readReminderPreferences, saveReminderPreferences, registerDeviceDeliveryToken, revokeDeviceDeliveryToken } from './reminderPreferences';
import { authorizeDeviceMeetingSnapshot } from './remoteReminders';
import { createDeviceSession, isLegacySessionRevoked, isMemberEnabled, resolveDeviceSession, revokeSession } from './mobileSessions';
import {
  GAMIFICATION_POLICY_VERSION,
  GAMIFICATION_POINT_AMOUNT,
  canViewMember,
  claimFriend,
  createReward,
  ensureGamificationSchema,
  getPeople,
  getRedemptions,
  getRewards,
  getScoreProfile,
  getViewerCapabilities,
  issueFriendToken,
  mutateCompletion,
  readReadingDays,
  removeFriend,
  redeemReward,
  reverseRedemption,
  setRewardTarget,
  updateReward,
  type GamificationError,
} from './gamification';
import { isScoreChartRange, isValidDateOnly, taipeiDate, type ScoreChartQuery } from '../src/domain/gamificationV1';

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
}

export interface ApiHandlerOptions {
  remoteReminderStatus?: 'REMOTE_PENDING' | 'REMOTE_READY';
  /** Warm the chapter-audio metadata cache for today's/tomorrow's assigned chapters at start and hourly. */
  prewarmChapterAudio?: boolean;
  prewarmVersionIds?: readonly number[];
  db: { db: DatabaseSync };
  instanceId?: string;
  authMode?: 'fixture' | 'google-only';
  fixtureToken?: string;
  productionGoogleAuth?: ProductionGoogleAuth;
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
  return pathname === '/api/me/profile' || pathname.startsWith('/api/me/reading-days') || pathname.startsWith('/api/me/completions/') || pathname.startsWith('/api/me/reward-target') || pathname.startsWith('/api/me/redemptions') || pathname.startsWith('/api/points/') || pathname === '/api/rewards' || pathname.startsWith('/api/friends/') || pathname.startsWith('/api/admin/');
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
  if (!/^2026-09-\d{2}$/.test(date)) return json(400, { error: 'INVALID_DATE' });
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
  if (options.scheduleDates && options.scheduleDates.length > 0) {
    // Existing tests and local deployments can narrow the aggregate period without
    // replacing the canonical reading-day source. Dates already present retain their
    // references; a new date is represented by its plan and an empty reference list
    // only when the caller has explicitly inserted it into reading_days.
  }
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
    unref(setTimeout(warm, 3_000));
    unref(setInterval(warm, 60 * 60 * 1000)); // well inside the cache window, so the first open of the day is warm
  }
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
  const now = options.now ?? (() => new Date());
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
    if (request.method === 'POST' && url.pathname === '/api/session/google' && options.productionGoogleAuth && options.sessionSecret) {
      const authorization = request.headers.authorization ?? request.headers.Authorization;
      const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return json(401, { error: 'AUTH_REQUIRED' });
      let identity: Awaited<ReturnType<NonNullable<ApiHandlerOptions['productionGoogleAuth']>['verify']>>;
      try { identity = await options.productionGoogleAuth.verify(token); } catch { return json(401, { error: 'AUTH_INVALID' }); }
      let memberId = (options.db.db.prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as { member_id: string } | undefined)?.member_id ?? null;
      if (!memberId) memberId = await options.productionGoogleAuth.resolveMember(identity);
      if (!memberId && options.autoProvisionGoogleMembers) {
        memberId = randomUUID();
        try {
          options.db.db.exec('BEGIN IMMEDIATE');
          const existing = options.db.db.prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as { member_id: string } | undefined;
          if (existing) memberId = existing.member_id;
          else {
            options.db.db.prepare('INSERT INTO members(id, display_name, group_id) VALUES(?,?,?)').run(memberId, identity.displayName?.trim() || '青牧會員', `unassigned:${memberId}`);
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
      let body: Record<string, unknown>;
      try { body = parseBody(request.body); } catch { return json(400, { error: 'INVALID_JSON' }); }
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
    const auth = options.productionGoogleAuth && options.sessionSecret
      ? await authenticateSessionOrGoogle(request.headers, options.productionGoogleAuth, options.sessionSecret, sessions)
      : authenticate(request.headers, options.fixtureToken ?? '', (id) => memberExists(options.db.db, id));
    if ('status' in auth) return isGamificationPath(url.pathname) ? gamificationError({ status: auth.status, code: auth.error }) : json(auth.status, { error: auth.error });
    if (memberExists(options.db.db, auth.memberId) && !isMemberEnabled(options.db.db, auth.memberId)) return isGamificationPath(url.pathname) ? gamificationError({ status: 401, code: 'AUTH_INVALID' }) : json(401, { error: 'ACCOUNT_DISABLED' });
    if (request.method === 'POST' && url.pathname === '/api/session/device' && options.productionGoogleAuth && options.sessionSecret) {
      return json(200, createDeviceSession(options.db.db, auth.memberId));
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/me/reading-days') {
        const today = taipeiDate(now());
        const from = url.searchParams.get('from') ?? today;
        const to = url.searchParams.get('to') ?? today;
        if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) return gamificationError({ status: 400, code: 'INVALID_DATE_RANGE' });
        const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
        if (span > 62) return gamificationError({ status: 400, code: 'DATE_RANGE_TOO_LARGE' });
        return gamificationJson(200, { days: readReadingDays(options.db.db, from, to, today, auth.memberId), timezone: 'Asia/Taipei', today });
      }
      if (request.method === 'GET' && url.pathname === '/api/rewards') {
        return gamificationJson(200, { rewards: getRewards(options.db.db) });
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
      if (request.method === 'GET' && url.pathname === '/api/me/redemptions') {
        return gamificationJson(200, { redemptions: getRedemptions(options.db.db, auth.memberId) });
      }
      if (request.method === 'PUT' && url.pathname === '/api/me/reward-target') {
        const body = parseBody(request.body);
        if (typeof body.rewardId !== 'string' || !body.rewardId.trim()) return gamificationError({ status: 400, code: 'INVALID_REWARD' });
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
        const result = claimFriend(options.db.db, auth.memberId, body.operationId, body.token, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, result);
      }
      const removeFriendMatch = url.pathname.match(/^\/api\/friends\/([^/]+)$/);
      if (request.method === 'DELETE' && removeFriendMatch) {
        const result = removeFriend(options.db.db, auth.memberId, decodeURIComponent(removeFriendMatch[1]), { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, { removed: result });
      }
      const admin = resolvedAdminMemberIds().includes(auth.memberId);
      if (request.method === 'POST' && url.pathname === '/api/admin/rewards') {
        if (!admin) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        const body = parseBody(request.body);
        if (typeof body.operationId !== 'string' || !body.operationId.trim() || typeof body.name !== 'string' || typeof body.costPoints !== 'number') return gamificationError({ status: 400, code: 'INVALID_REWARD' });
        const replay = Boolean(options.db.db.prepare('SELECT 1 FROM mutation_receipts WHERE actor_member_id=? AND operation_id=?').get(auth.memberId, body.operationId));
        const result = createReward(options.db.db, auth.memberId, body.operationId, body.name, body.costPoints, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(replay ? 200 : 201, result);
      }
      const adminRewardMatch = url.pathname.match(/^\/api\/admin\/rewards\/([^/]+)$/);
      if (request.method === 'PATCH' && adminRewardMatch) {
        if (!admin) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        const body = parseBody(request.body);
        if (typeof body.operationId !== 'string' || !body.operationId.trim() || typeof body.expectedRevision !== 'number') return gamificationError({ status: 400, code: 'INVALID_REWARD' });
        const result = updateReward(options.db.db, auth.memberId, body.operationId, decodeURIComponent(adminRewardMatch[1]), { name: typeof body.name === 'string' ? body.name : undefined, costPoints: typeof body.costPoints === 'number' ? body.costPoints : undefined, active: typeof body.active === 'boolean' ? body.active : undefined, expectedRevision: body.expectedRevision }, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, result);
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/redemptions') {
        if (!admin) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        const memberId = url.searchParams.get('memberId');
        const rows = memberId ? getRedemptions(options.db.db, memberId) : [...new Set((options.db.db.prepare('SELECT member_id FROM redemptions ORDER BY confirmed_at DESC').all() as Array<{ member_id: string }>).map((row) => row.member_id))].flatMap((id) => getRedemptions(options.db.db, id));
        return gamificationJson(200, { redemptions: rows });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/redemptions') {
        if (!admin) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        const body = parseBody(request.body);
        if (typeof body.operationId !== 'string' || !body.operationId.trim() || typeof body.memberId !== 'string' || typeof body.rewardId !== 'string' || typeof body.expectedRewardRevision !== 'number') return gamificationError({ status: 400, code: 'INVALID_REDEMPTION' });
        const replay = Boolean(options.db.db.prepare('SELECT 1 FROM mutation_receipts WHERE actor_member_id=? AND operation_id=?').get(auth.memberId, body.operationId));
        const result = redeemReward(options.db.db, auth.memberId, { operationId: body.operationId, memberId: body.memberId, rewardId: body.rewardId, expectedRewardRevision: body.expectedRewardRevision }, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(replay ? 200 : 201, result);
      }
      const redemptionReverseMatch = url.pathname.match(/^\/api\/admin\/redemptions\/([^/]+)\/reverse$/);
      if (request.method === 'POST' && redemptionReverseMatch) {
        if (!admin) return gamificationError({ status: 403, code: 'ADMIN_REQUIRED' });
        const body = parseBody(request.body);
        if (typeof body.operationId !== 'string' || !body.operationId.trim() || typeof body.reason !== 'string') return gamificationError({ status: 400, code: 'REVERSAL_REASON_REQUIRED' });
        const result = reverseRedemption(options.db.db, auth.memberId, decodeURIComponent(redemptionReverseMatch[1]), body.operationId, body.reason, { now });
        return isGamificationError(result) ? gamificationError(result) : gamificationJson(200, result);
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
          if (typeof body.installation_id !== 'string' || !body.installation_id.trim() || typeof body.token !== 'string' || !body.token.trim() || body.platform !== 'ANDROID' || typeof ownerGeneration !== 'number' || !Number.isSafeInteger(ownerGeneration) || ownerGeneration < 0) return json(400, { error: 'INVALID_DEVICE_TOKEN' });
          return json(200, { ...registerDeviceDeliveryToken(options.db.db, { memberId: auth.memberId, installationId: body.installation_id.trim(), token: body.token.trim(), ownerGeneration }), remoteDeliveryStatus: remoteStatus });
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
