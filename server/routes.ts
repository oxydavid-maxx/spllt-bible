import type { DatabaseSync } from 'node:sqlite';
import { maskForViewer } from '../src/domain/masking';
import { calculateNetPoints, type PointEvent, type PointPolicy } from '../src/domain/points';
import type { ContentGateStatus } from '../src/domain/types';
import { authenticate, authenticateGoogle, authenticateSessionOrGoogle, type ProductionGoogleAuth } from './authBoundary';
import { claimMemberInvite } from './membership';
import { createSessionToken } from './session';
import { getMemberGroupProfile } from './groups';
import { buildCompletionOperationFingerprint } from './operationFingerprint';
import {
  readReminderPreferences,
  registerDeviceDeliveryToken,
  revokeDeviceDeliveryToken,
  saveReminderPreferences,
  sendDueMeetingEvent,
  authorizeDeviceMeetingSnapshot,
  type RemoteDeliveryStatus,
} from './reminders';
import { discoverDueMeetingEvents } from './reminderWorker';
import { evaluateContentCapability, parseCapabilityQuery } from './contentCapabilities';

export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ApiHandlerOptions {
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
  reminderDelivery?: {
    workerToken: string;
    enabled: boolean;
    send: (token: string, payload: { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number }) => Promise<void | { messageId?: string | null }>;
  };
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

function parseStatus(value: unknown): 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED' {
  if (value === 'UNREPORTED' || value === 'NOT_COMPLETED' || value === 'COMPLETED') return value;
  throw new Error('INVALID_STATUS');
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

function completionResponse(
  db: DatabaseSync,
  memberId: string,
  planId: string,
  taskDate: string,
  status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED',
  revision: number,
  operationId: string,
  policy: PointPolicy,
): Record<string, unknown> {
  const events = db
    .prepare('SELECT event_id, completion_key, status FROM point_events WHERE member_id = ? AND policy_version = ?')
    .all(memberId, policy.version)
    .map((row) => ({
      eventId: String((row as Record<string, unknown>).event_id),
      completionKey: String((row as Record<string, unknown>).completion_key),
      status: String((row as Record<string, unknown>).status) as PointEvent['status'],
    }));
  const pointResult = calculateNetPoints(events, policy);
  return {
    memberId,
    planId,
    taskDate,
    status,
    revision,
    syncStatus: 'CONFIRMED',
    operationId,
    points: pointResult.points,
    pointStatus: policy.status,
  };
}

function handleCompletion(
  db: DatabaseSync,
  memberId: string,
  planId: string,
  taskDate: string,
  body: Record<string, unknown>,
  policy: PointPolicy,
): ApiResponse {
  if (planId !== PLAN_ID || !/^2026-09-\d{2}$/.test(taskDate)) return json(404, { error: 'UNKNOWN_TASK' });
  const operationId = body.operation_id;
  const expectedRevision = body.expected_revision;
  if (typeof operationId !== 'string' || !operationId.trim() || !Number.isInteger(expectedRevision)) {
    return json(400, { error: 'INVALID_COMPLETION_COMMAND' });
  }
  const status = parseStatus(body.status);
  const fingerprint = buildCompletionOperationFingerprint({ memberId, planId, taskDate, status });
  const existingOperation = db.prepare('SELECT response_json, command_fingerprint FROM operations WHERE operation_id = ?').get(operationId) as
    | { response_json: string; command_fingerprint: string | null }
    | undefined;
  if (existingOperation) {
    if (!existingOperation.command_fingerprint) return json(409, { error: 'OPERATION_REPLAY_UNVERIFIED' });
    if (existingOperation.command_fingerprint !== fingerprint) return json(409, { error: 'OPERATION_ID_REUSED' });
    const cached = JSON.parse(existingOperation.response_json) as Record<string, unknown>;
    const cachedMemberId = typeof cached.memberId === 'string' ? cached.memberId : null;
    const cachedPlanId = typeof cached.planId === 'string' ? cached.planId : null;
    const cachedTaskDate = typeof cached.taskDate === 'string' ? cached.taskDate : null;
    const cachedStatus = parseStatus(cached.status);
    const cachedRevision = Number(cached.revision);
    const current = cachedMemberId && cachedPlanId && cachedTaskDate
      ? db.prepare('SELECT status, revision FROM completions WHERE member_id = ? AND plan_id = ? AND task_date = ?').get(cachedMemberId, cachedPlanId, cachedTaskDate) as { status: string; revision: number } | undefined
      : undefined;
    if (!current || current.status !== cachedStatus || current.revision !== cachedRevision) {
      return json(409, {
        error: 'OPERATION_REPLAY_STALE',
        status: current?.status ?? 'UNREPORTED',
        revision: current?.revision ?? 0,
      });
    }
    return json(200, cached);
  }

  const current = db
    .prepare('SELECT status, revision FROM completions WHERE member_id = ? AND plan_id = ? AND task_date = ?')
    .get(memberId, planId, taskDate) as { status: string; revision: number } | undefined;
  const currentRevision = current?.revision ?? 0;
  if (expectedRevision !== currentRevision) {
    return json(409, {
      error: 'REVISION_CONFLICT',
      status: current?.status ?? 'UNREPORTED',
      revision: currentRevision,
    });
  }

  const revision = currentRevision + 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (current) {
      db.prepare(
        'UPDATE completions SET status = ?, revision = ?, sync_status = ?, last_operation_id = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
      ).run(status, revision, 'CONFIRMED', operationId, memberId, planId, taskDate);
    } else {
      db.prepare(
        'INSERT INTO completions (member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(memberId, planId, taskDate, status, revision, 'CONFIRMED', operationId);
    }
    if (policy.status === 'ACTIVE') {
      db.prepare(
        'INSERT OR IGNORE INTO point_events (event_id, member_id, completion_key, status, policy_version) VALUES (?, ?, ?, ?, ?)',
      ).run(operationId, memberId, `${memberId}:${planId}:${taskDate}`, status, policy.version);
    }
    const response = completionResponse(db, memberId, planId, taskDate, status, revision, operationId, policy);
    db.prepare('INSERT INTO operations (operation_id, response_json, command_fingerprint) VALUES (?, ?, ?)').run(operationId, JSON.stringify(response), fingerprint);
    db.exec('COMMIT');
    return json(200, response);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
  const rows = db.prepare(`SELECT member_id, task_date, status FROM completions WHERE plan_id = ? AND task_date IN (${placeholders})`).all(PLAN_ID, ...periodDates) as Array<{ member_id: string; task_date: string; status: string }>;
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
  const points = calculateNetPoints(events, policy).points;
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

function handleProgress(db: DatabaseSync, viewerId: string, date: string, policy: PointPolicy, weeklyDates?: string[], scheduleDates?: string[], periodStart?: string, periodEnd?: string): ApiResponse {
  if (!/^2026-09-\d{2}$/.test(date)) return json(400, { error: 'INVALID_DATE' });
  const viewer = db.prepare('SELECT group_id FROM members WHERE id = ?').get(viewerId) as { group_id: string } | undefined;
  if (!viewer) return json(403, { error: 'UNKNOWN_MEMBER' });
  const members = db
    .prepare('SELECT id, display_name, group_id FROM members WHERE group_id = ? ORDER BY id')
    .all(viewer.group_id)
    .map((row) => row as { id: string; display_name: string; group_id: string });
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
  const pointEvents = db
    .prepare('SELECT event_id, completion_key, status FROM point_events WHERE member_id = ? AND policy_version = ?')
    .all(viewerId, policy.version)
    .map((row) => {
      const item = row as { event_id: string; completion_key: string; status: PointEvent['status'] };
      return { eventId: item.event_id, completionKey: item.completion_key, status: item.status };
    });
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
          points: calculateNetPoints(pointEvents, policy).points,
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
  const policy = options.pointPolicy ?? DEFAULT_POLICY;
  const remoteDeliveryStatus: RemoteDeliveryStatus = options.reminderDelivery?.enabled ? 'REMOTE_READY' : 'REMOTE_PENDING';
  return async function handle(request: ApiRequest): Promise<ApiResponse> {
    const url = parsePath(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(200, {
        status: 'ok',
        instanceId: options.instanceId ?? 'unconfigured',
        authMode: options.authMode ?? (options.productionGoogleAuth ? 'google-only' : 'fixture'),
      });
    }
    if (request.method === 'POST' && url.pathname === '/internal/reminders/due') {
      const workerToken = request.headers['x-qingmu-reminder-worker'] ?? request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!options.reminderDelivery?.enabled || !workerToken || workerToken !== options.reminderDelivery.workerToken) {
        return json(401, { error: 'REMINDER_WORKER_UNAUTHORIZED' });
      }
      try {
        const body = parseBody(request.body);
        if (typeof body.meeting_id !== 'string' || !body.meeting_id.trim()) return json(400, { error: 'INVALID_REMINDER_EVENT' });
        const requestedRevision = body.schedule_revision === undefined ? null : Number(body.schedule_revision);
        const requestedMember = body.member_id === undefined ? null : String(body.member_id);
        const candidates = discoverDueMeetingEvents(options.db.db, new Date()).filter((candidate) => candidate.meetingId === body.meeting_id && (requestedRevision === null || candidate.scheduleRevision === requestedRevision) && (requestedMember === null || candidate.memberId === requestedMember));
        if (candidates.length === 0) {
          const current = options.db.db.prepare('SELECT schedule_revision, schedule_status FROM member_group_profiles WHERE meeting_id = ? ORDER BY COALESCE(schedule_revision, 0) DESC LIMIT 1').get(body.meeting_id) as { schedule_revision: number | null; schedule_status: string | null } | undefined;
          return json(200, { decision: current?.schedule_status === 'CANCELLED' ? 'DROP_CANCELLED' : 'DROP_UNKNOWN', meetingId: body.meeting_id, latestRevision: current?.schedule_revision, latestStatus: current?.schedule_status });
        }
        const results = [];
        for (const candidate of candidates) results.push(await sendDueMeetingEvent(options.db.db, candidate, options.reminderDelivery.send));
        const first = results[0];
        return json(200, { decision: results.some((result) => result.decision === 'SEND') ? 'SEND' : first.decision, reminderId: first.reminderId, meetingId: first.meetingId, scheduleRevision: first.scheduleRevision, latestRevision: first.latestRevision, latestStatus: first.latestStatus, recipients: results.map((result) => ({ memberId: candidates.find((candidate) => candidate.reminderId === result.reminderId)?.memberId, decision: result.decision })) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
        if (message === 'INVALID_JSON') return json(400, { error: message });
        return json(500, { error: 'REMINDER_DELIVERY_ERROR' });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/device/reminders/validate') {
      const deviceToken = request.headers['x-qingmu-device-token'];
      const installationId = request.headers['x-qingmu-installation-id'];
      if (!deviceToken || !installationId) return json(401, { error: 'DEVICE_DELIVERY_AUTH_REQUIRED' });
      try {
        const body = parseBody(request.body);
        if (typeof body.meeting_id !== 'string' || typeof body.schedule_revision !== 'number' || !Number.isInteger(body.schedule_revision)) return json(400, { error: 'INVALID_DEVICE_REMINDER_EVENT' });
        const snapshot = authorizeDeviceMeetingSnapshot(options.db.db, { installationId, token: deviceToken, meetingId: body.meeting_id });
        if (!snapshot) return json(403, { error: 'DEVICE_DELIVERY_REVOKED' });
        return json(200, {
          valid: snapshot.status === 'SCHEDULED' && snapshot.scheduleRevision === body.schedule_revision,
          meetingId: snapshot.meetingId,
          scheduleRevision: snapshot.scheduleRevision,
          status: snapshot.status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
        if (message === 'INVALID_JSON') return json(400, { error: message });
        return json(500, { error: 'DEVICE_REMINDER_ERROR' });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/session/google' && options.productionGoogleAuth && options.sessionSecret) {
      const auth = await authenticateGoogle(request.headers, options.productionGoogleAuth);
      if ('status' in auth) return json(auth.status, { error: auth.error });
      return json(200, {
        sessionToken: createSessionToken(auth.memberId, options.sessionSecret),
        memberId: auth.memberId,
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
    const auth = options.productionGoogleAuth && options.sessionSecret
      ? await authenticateSessionOrGoogle(request.headers, options.productionGoogleAuth, options.sessionSecret)
      : authenticate(request.headers, options.fixtureToken ?? '', (id) => memberExists(options.db.db, id));
    if ('status' in auth) return json(auth.status, { error: auth.error });

    try {
      if (request.method === 'GET' && url.pathname === '/api/content-capabilities') {
        // Per-chapter audio capability (parent spec line 160). Backward compatible on purpose: the
        // existing callers ask with NO query and still get the content gate they expect, so this
        // extension cannot break them. Asking about a specific chapter is opt-in via the query.
        const hasChapterQuery =
          url.searchParams.has('versionId') || url.searchParams.has('usfm');
        if (hasChapterQuery) {
          const parsed = parseCapabilityQuery({
            versionId: url.searchParams.get('versionId') ?? undefined,
            usfm: url.searchParams.get('usfm') ?? undefined,
          });
          if (!parsed.ok) return json(400, { error: parsed.error });
          const capability = evaluateContentCapability(parsed.versionId, parsed.usfm);
          return json(200, { ...capability } as unknown as Record<string, unknown>);
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
        return json(200, {
          memberId: member.id,
          displayName: member.display_name,
          avatarUrl: null,
          groupId: member.group_id,
          groupName: group?.group_name ?? null,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/groups') {
        const profile = getMemberGroupProfile(options.db.db, auth.memberId);
        return profile ? json(200, profile) : json(404, { error: 'GROUP_PROFILE_PENDING' });
      }
      if (request.method === 'GET' && url.pathname === '/api/me/reminders') {
        return json(200, readReminderPreferences(options.db.db, auth.memberId, remoteDeliveryStatus) as unknown as Record<string, unknown>);
      }
      if (request.method === 'PUT' && url.pathname === '/api/me/reminders') {
        const body = parseBody(request.body);
        if (typeof body.reading_enabled !== 'boolean' || typeof body.meeting_enabled !== 'boolean') return json(400, { error: 'INVALID_REMINDER_PREFERENCES' });
        const current = readReminderPreferences(options.db.db, auth.memberId, remoteDeliveryStatus);
        const readingTime = body.reading_time === undefined ? current.readingTime : body.reading_time;
        const meetingAdvanceMinutes = body.meeting_advance_minutes === undefined ? current.meetingAdvanceMinutes : body.meeting_advance_minutes;
        const preferenceGeneration = body.preference_generation === undefined ? current.preferenceGeneration : body.preference_generation;
        if (typeof readingTime !== 'string' || typeof meetingAdvanceMinutes !== 'number' || !Number.isInteger(meetingAdvanceMinutes) || typeof preferenceGeneration !== 'number' || !Number.isInteger(preferenceGeneration)) return json(400, { error: 'INVALID_REMINDER_PREFERENCES' });
        return json(200, saveReminderPreferences(options.db.db, auth.memberId, { readingEnabled: body.reading_enabled, meetingEnabled: body.meeting_enabled, readingTime, meetingAdvanceMinutes, preferenceGeneration }, undefined) as unknown as Record<string, unknown>);
      }
      if (request.method === 'POST' && url.pathname === '/api/me/reminders/device-token') {
        const body = parseBody(request.body);
        if (typeof body.installation_id !== 'string' || !body.installation_id.trim() || typeof body.token !== 'string' || !body.token.trim() || body.platform !== 'ANDROID') return json(400, { error: 'INVALID_DEVICE_TOKEN' });
        const binding = registerDeviceDeliveryToken(options.db.db, { memberId: auth.memberId, installationId: body.installation_id.trim(), platform: 'ANDROID', token: body.token.trim(), ownerGeneration: typeof body.owner_generation === 'number' && Number.isInteger(body.owner_generation) ? body.owner_generation : 0 });
        return json(200, { registered: binding.accepted, remoteDeliveryStatus, bindingVersion: binding.bindingVersion, ownerGeneration: binding.ownerGeneration });
      }
      if (request.method === 'POST' && url.pathname === '/api/me/reminders/device-token/revoke') {
        const body = parseBody(request.body);
        if (typeof body.installation_id !== 'string' || !body.installation_id.trim()) return json(400, { error: 'INVALID_DEVICE_TOKEN' });
        return json(200, { revoked: revokeDeviceDeliveryToken(options.db.db, auth.memberId, body.installation_id.trim(), typeof body.binding_version === 'number' && Number.isInteger(body.binding_version) ? body.binding_version : undefined, typeof body.owner_generation === 'number' && Number.isInteger(body.owner_generation) ? body.owner_generation : undefined) });
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
        return handleCompletion(
          options.db.db,
          auth.memberId,
          decodeURIComponent(match[1]),
          decodeURIComponent(match[2]),
          parseBody(request.body),
          policy,
        );
      }
      return json(404, { error: 'NOT_FOUND' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      if (message === 'INVALID_JSON' || message.startsWith('INVALID_')) return json(400, { error: message });
      return json(500, { error: 'INTERNAL_ERROR' });
    }
  };
}
