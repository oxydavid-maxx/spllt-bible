import type { CompletionCommand } from '../domain/completion';
import type { CompletionStatus } from '../domain/types';
import type { SyncResult } from '../storage/outbox';
import { notifyAuthExpired } from './authState';
import { isDeviceSessionCredential } from './authCredential';

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  memberId: string;
  fetchImpl?: typeof fetch;
}

export interface SessionResult {
  sessionToken: string;
  memberId: string;
  expiresInSeconds: number | null;
  sessionKind?: 'device';
}

function parseSessionResult(body: unknown): SessionResult | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (typeof value.sessionToken !== 'string' || !value.sessionToken || typeof value.memberId !== 'string' || !value.memberId) return null;
  if (value.sessionKind === 'device') {
    return value.expiresInSeconds === null && isDeviceSessionCredential(value.sessionToken)
      ? { sessionToken: value.sessionToken, memberId: value.memberId, expiresInSeconds: null, sessionKind: 'device' } : null;
  }
  const expiry = Number(value.expiresInSeconds ?? 0);
  return Number.isFinite(expiry) && expiry >= 0 ? { sessionToken: value.sessionToken, memberId: value.memberId, expiresInSeconds: expiry } : null;
}

export interface SessionFailure {
  status: number;
  error: string;
}

export interface ProgressSnapshot {
  date: string;
  members: Array<{ id: string; label: string; isSelf: boolean; status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED' }>;
  completed: number;
  totalMembers: number;
  personal: { status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED'; revision: number; points: number } | null;
  weekly?: ProgressPeriodSnapshot;
  monthly?: ProgressPeriodSnapshot;
  pointsPolicy?: { status: 'ACTIVE' | 'UNCONFIGURED'; version: string; pointsPerCompletion: number };
}

export interface ProgressPeriodSnapshot {
  periodStart: string;
  periodEnd: string;
  completed: number;
  target: number;
  personalCompleted: number;
  points: number;
  personalPoints: number;
  policyStatus: 'ACTIVE' | 'UNCONFIGURED';
  policyVersion: string;
  pointsPerCompletion: number;
  goalTarget?: number;
  goalAchieved?: boolean;
}

export interface GroupProfileSnapshot {
  groupId: string;
  groupName: string;
  rpgs: Array<{
    rpgId: string;
    rpgName: string;
    openChatUrl: string | null;
    callUrl: string | null;
    callProvider: 'meet' | 'zoom' | null;
    callScope: 'TEST_ONLY' | 'APPROVED' | null;
    linkStatus: 'READY' | 'PENDING_UI_VERIFICATION';
    linkRevision: number;
    standingRoom: boolean;
    meeting: { meetingId: string; title: string; startsAt: string | null; endsAt: string | null; timeZone: string; organizerLabel: string | null; revision: number; status: 'SCHEDULED' | 'CANCELLED'; lastUpdatedAt: string | null } | null;
    roster: Array<{ id: string; label: string; isSelf: boolean }> | null;
    lastUpdatedAt: string | null;
  }>;
}

export interface ReminderMeetingSnapshot {
  reminderId: string;
  meetingId: string;
  title: string;
  startsAt: string | null;
  timeZone: string;
  scheduleRevision: number;
  status: 'SCHEDULED' | 'CANCELLED';
  triggerAt: string | null;
  route: string;
}

export interface ReminderSnapshot {
  memberId: string;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  readingTime: string;
  meetingAdvanceMinutes: number;
  preferenceGeneration?: number;
  remoteDeliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
  meetings: ReminderMeetingSnapshot[];
}

export interface MemberProfileSnapshot {
  memberId: string;
  displayName: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface ReadingDaySnapshot {
  taskDate: string;
  planId: string;
  references: string[];
  sourceRevision: number;
  sourceDigest: string;
  status: CompletionStatus;
  revision: number;
  canComplete: boolean;
}

const COMPLETION_STATUSES: readonly CompletionStatus[] = ['UNREPORTED', 'NOT_COMPLETED', 'COMPLETED'];

function isCompletionStatus(value: unknown): value is CompletionStatus {
  return typeof value === 'string' && COMPLETION_STATUSES.includes(value as CompletionStatus);
}

function responseObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const handleAuthStatus = (response: Response): void => { if (response.status === 401 && options.token) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token }); };
  const sessionRequest = async (path: string): Promise<Response> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    try { return await fetchImpl(`${options.baseUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' }, body: '{}', signal: abort.signal }); }
    finally { clearTimeout(timer); }
  };
  return {
    async establishSession(idToken: string, sessionOptions: { persistentDevice?: boolean } = {}): Promise<SessionResult | SessionFailure | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/session/google`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
        ...(sessionOptions.persistentDevice ? { body: JSON.stringify({ session_type: 'device' }) } : {}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { status: response.status, error: String(body.error ?? 'SESSION_ERROR') };
      }
      return parseSessionResult(await response.json());
    },
    async claimInvite(idToken: string, inviteCode: string, sessionOptions: { persistentDevice?: boolean } = {}): Promise<SessionResult | SessionFailure | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/onboarding/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode, ...(sessionOptions.persistentDevice ? { session_type: 'device' } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { sessionToken?: string; memberId?: string; expiresInSeconds?: number; error?: string };
      if (!response.ok) return { status: response.status, error: String(body.error ?? 'INVITE_ERROR') };
      return parseSessionResult(body);
    },
    async upgradeSession(): Promise<SessionResult | SessionFailure | null> {
      const response = await sessionRequest('/api/session/device');
      const body = await response.json().catch(() => null);
      return response.ok ? parseSessionResult(body) : { status: response.status, error: String(body?.error ?? 'SESSION_ERROR') };
    },
    async revokeSession(): Promise<boolean> {
      // This credential may already belong to a logged-out/old account. Its 401
      // is terminal for the revoke queue and must never expire the current owner.
      const response = await sessionRequest('/api/session/revoke');
      return response.ok || response.status === 401 || response.status === 403;
    },
    async saveCompletion(command: CompletionCommand): Promise<SyncResult> {
      const response = await fetchImpl(
        `${options.baseUrl}/api/me/completions/${encodeURIComponent(command.planId)}/${encodeURIComponent(command.taskDate)}`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${options.token}`,
            'content-type': 'application/json',
            'x-qingmu-member-id': command.memberId,
          },
          body: JSON.stringify({
            operation_id: command.operationId,
            expected_revision: command.expectedRevision,
            status: command.desiredStatus,
          }),
        },
      );
      handleAuthStatus(response);
      const body = responseObject(await response.json().catch(() => null));
      const responseError = typeof body?.error === 'string' ? body.error : body?.error && typeof body.error === 'object' && !Array.isArray(body.error) && typeof (body.error as Record<string, unknown>).code === 'string' ? String((body.error as Record<string, unknown>).code) : undefined;
      if (!body) return { ok: false, error: 'INVALID_API_RESPONSE' };
      if (response.status === 409) {
        const conflictRevision = body?.revision;
        if ((responseError !== 'REVISION_CONFLICT' && responseError !== 'OPERATION_REPLAY_STALE') || typeof conflictRevision !== 'number' || !Number.isInteger(conflictRevision) || conflictRevision < 0 || !isCompletionStatus(body.status)) {
          return { ok: false, error: 'INVALID_API_RESPONSE' };
        }
        return {
          ok: false,
          conflict: true,
          error: responseError as 'REVISION_CONFLICT' | 'OPERATION_REPLAY_STALE',
          revision: conflictRevision,
          status: body.status,
        };
      }
      if (!response.ok) return { ok: false, error: responseError ?? 'API_ERROR' };
      if (
        body.memberId !== command.memberId ||
        body.planId !== command.planId ||
        body.taskDate !== command.taskDate ||
        body.operationId !== command.operationId ||
        !isCompletionStatus(body.status) ||
        body.status !== command.desiredStatus ||
        typeof body.revision !== 'number' ||
        !Number.isInteger(body.revision) ||
        body.revision < command.expectedRevision
      ) {
        return { ok: false, error: 'INVALID_API_RESPONSE' };
      }
      const optionalSafeInteger = (value: unknown, allowNegative = false): number | undefined | null => {
        if (value === undefined) return undefined;
        return typeof value === 'number'
          && Number.isSafeInteger(value)
          && (allowNegative || value >= 0)
          ? value
          : null;
      };
      const pointsDelta = optionalSafeInteger(body.pointsDelta, true);
      const earnedTotal = optionalSafeInteger(body.earnedTotal);
      const redeemableBalance = optionalSafeInteger(body.redeemableBalance);
      if (pointsDelta === null || earnedTotal === null || redeemableBalance === null) return { ok: false, error: 'INVALID_API_RESPONSE' };
      return {
        ok: true,
        operationId: command.operationId,
        revision: body.revision,
        status: body.status,
        ...(pointsDelta === undefined ? {} : { pointsDelta }),
        ...(earnedTotal === undefined ? {} : { earnedTotal }),
        ...(redeemableBalance === undefined ? {} : { redeemableBalance }),
      };
    },
    async getProgress(date: string, period?: { start: string; end: string }): Promise<ProgressSnapshot | null> {
      const periodQuery = period ? `&period_start=${encodeURIComponent(period.start)}&period_end=${encodeURIComponent(period.end)}` : '';
      const response = await fetchImpl(`${options.baseUrl}/api/progress?date=${encodeURIComponent(date)}${periodQuery}`, {
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-qingmu-member-id': options.memberId,
        },
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      return (await response.json()) as ProgressSnapshot;
    },
    async getReadingDays(from: string, to: string): Promise<{ today: string; timezone: string; days: ReadingDaySnapshot[] } | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/reading-days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-qingmu-member-id': options.memberId,
        },
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      const body = responseObject(await response.json().catch(() => null));
      if (!body || typeof body.today !== 'string' || body.timezone !== 'Asia/Taipei' || !Array.isArray(body.days)) return null;
      const days = body.days.flatMap((value) => {
        const item = responseObject(value);
        if (!item || typeof item.taskDate !== 'string' || typeof item.planId !== 'string' || !Array.isArray(item.references) || item.references.some((reference) => typeof reference !== 'string') || typeof item.sourceRevision !== 'number' || typeof item.sourceDigest !== 'string' || !isCompletionStatus(item.status) || typeof item.revision !== 'number' || typeof item.canComplete !== 'boolean') return [];
        return [{ taskDate: item.taskDate, planId: item.planId, references: item.references as string[], sourceRevision: item.sourceRevision, sourceDigest: item.sourceDigest, status: item.status, revision: item.revision, canComplete: item.canComplete }];
      });
      return days.length === body.days.length ? { today: body.today, timezone: body.timezone, days } : null;
    },
    async getGroups(): Promise<GroupProfileSnapshot | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/groups`, {
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-qingmu-member-id': options.memberId,
        },
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      return (await response.json()) as GroupProfileSnapshot;
    },
    async getProfile(): Promise<MemberProfileSnapshot | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/profile`, {
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-qingmu-member-id': options.memberId,
        },
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      return (await response.json()) as MemberProfileSnapshot;
    },
    async getReminderSnapshot(): Promise<ReminderSnapshot | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/reminders`, {
        headers: {
          authorization: `Bearer ${options.token}`,
          'x-qingmu-member-id': options.memberId,
        },
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      return (await response.json()) as ReminderSnapshot;
    },
    async saveReminderPreferences(preferences: { readingEnabled: boolean; meetingEnabled: boolean; readingTime?: string; meetingAdvanceMinutes?: number; preferenceGeneration?: number }): Promise<ReminderSnapshot | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/reminders`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          'x-qingmu-member-id': options.memberId,
        },
        body: JSON.stringify({ reading_enabled: preferences.readingEnabled, meeting_enabled: preferences.meetingEnabled, reading_time: preferences.readingTime, meeting_advance_minutes: preferences.meetingAdvanceMinutes, preference_generation: preferences.preferenceGeneration }),
      });
      handleAuthStatus(response);
      if (!response.ok) return null;
      return (await response.json()) as ReminderSnapshot;
    },
    async registerReminderDeviceToken(input: { installationId: string; token: string; platform?: 'ANDROID'; ownerGeneration?: number }): Promise<boolean | { registered: boolean; bindingVersion?: number; ownerGeneration?: number }> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/reminders/device-token`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          'x-qingmu-member-id': options.memberId,
        },
        body: JSON.stringify({ installation_id: input.installationId, token: input.token, platform: input.platform ?? 'ANDROID', owner_generation: input.ownerGeneration }),
      });
      handleAuthStatus(response);
      const body = (await response.json().catch(() => ({}))) as { registered?: boolean; bindingVersion?: number; ownerGeneration?: number };
      if (!response.ok) return false;
      if (body.bindingVersion !== undefined || body.ownerGeneration !== undefined) return { registered: body.registered === true, bindingVersion: body.bindingVersion, ownerGeneration: body.ownerGeneration };
      return body.registered === true;
    },
    async revokeReminderDeviceToken(installationId: string, bindingVersion?: number, ownerGeneration?: number): Promise<boolean> {
      const response = await fetchImpl(`${options.baseUrl}/api/me/reminders/device-token/revoke`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
          'x-qingmu-member-id': options.memberId,
        },
        body: JSON.stringify({ installation_id: installationId, binding_version: bindingVersion, owner_generation: ownerGeneration }),
      });
      handleAuthStatus(response);
      return response.ok;
    },
  };
}
