import type { CompletionCommand } from '../domain/completion';
import type { CompletionStatus } from '../domain/types';
import type { SyncResult } from '../storage/outbox';
import { notifyAuthExpired } from './authState';

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  memberId: string;
  fetchImpl?: typeof fetch;
}

export interface SessionResult {
  sessionToken: string;
  memberId: string;
  expiresInSeconds: number;
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

const COMPLETION_STATUSES: readonly CompletionStatus[] = ['UNREPORTED', 'NOT_COMPLETED', 'COMPLETED'];

function isCompletionStatus(value: unknown): value is CompletionStatus {
  return typeof value === 'string' && COMPLETION_STATUSES.includes(value as CompletionStatus);
}

function responseObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const handleAuthStatus = (response: Response): void => { if (response.status === 401 && options.token) notifyAuthExpired(); };
  return {
    async establishSession(idToken: string): Promise<SessionResult | SessionFailure | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/session/google`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { status: response.status, error: String(body.error ?? 'SESSION_ERROR') };
      }
      const body = (await response.json()) as { sessionToken?: string; memberId?: string; expiresInSeconds?: number };
      return body.sessionToken && body.memberId ? { sessionToken: body.sessionToken, memberId: body.memberId, expiresInSeconds: Number(body.expiresInSeconds ?? 0) } : null;
    },
    async claimInvite(idToken: string, inviteCode: string): Promise<SessionResult | SessionFailure | null> {
      const response = await fetchImpl(`${options.baseUrl}/api/onboarding/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCode }),
      });
      const body = (await response.json().catch(() => ({}))) as { sessionToken?: string; memberId?: string; expiresInSeconds?: number; error?: string };
      if (!response.ok) return { status: response.status, error: String(body.error ?? 'INVITE_ERROR') };
      return body.sessionToken && body.memberId ? { sessionToken: body.sessionToken, memberId: body.memberId, expiresInSeconds: Number(body.expiresInSeconds ?? 0) } : null;
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
      if (response.status === 409) {
        const conflictRevision = body?.revision;
        if ((body?.error !== 'REVISION_CONFLICT' && body?.error !== 'OPERATION_REPLAY_STALE') || typeof conflictRevision !== 'number' || !Number.isInteger(conflictRevision) || conflictRevision < 0 || !isCompletionStatus(body.status)) {
          return { ok: false, error: 'INVALID_API_RESPONSE' };
        }
        return {
          ok: false,
          conflict: true,
          error: body.error as 'REVISION_CONFLICT' | 'OPERATION_REPLAY_STALE',
          revision: conflictRevision,
          status: body.status,
        };
      }
      if (!response.ok) return { ok: false, error: String(body?.error ?? 'API_ERROR') };
      if (
        !body ||
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
      return {
        ok: true,
        revision: body.revision,
        status: body.status,
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
