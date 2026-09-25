import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runtimeConfig } from '../src/config/runtime';
import { createDatabase, type ServerDatabase } from './db';
import { createApiHandler } from './routes';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifyGoogleIdToken } from './googleVerifier';
import { canonicalSeptemberPlan } from '../src/domain/calendar';
import { seedMemberInvite, type MemberInviteSeed } from './membership';
import type { PointPolicy } from '../src/domain/points';
import { seedMemberGroupProfile, type MemberGroupProfileSeed } from './groups';
import { createRemoteConfiguration } from './remoteConfiguration';
import { createReminderWorker, type ReminderWorkerTimer } from './reminderWorker';
import { createClaudeCli } from './claudeCli';
import { createNominationAssistWorker } from './nominationAssist';
import type { MeetingSender } from './remoteReminders';
import { createOfficialBibleAdapter } from './officialBibleAdapter';
import { deriveFormRegistrationKey } from './eventRegistrations';

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function createHttpServer(options: { fixtureToken?: string; database?: ServerDatabase; reminderDelivery?: { enabled: boolean; send: MeetingSender }; reminderWorker?: { autostart?: boolean; now?: () => Date; intervalMs?: number; timer?: ReminderWorkerTimer } } = {}) {
  const config = runtimeConfig();
  const fixtureRoster = process.env.QINGMU_FIXTURE_ROSTER === 'two-member-week';
  const databaseFilename = process.env.QINGMU_DB_PATH;
  if (!options.database && databaseFilename && databaseFilename !== ':memory:') mkdirSync(dirname(resolve(databaseFilename)), { recursive: true });
  const database = options.database ?? createDatabase({
    filename: databaseFilename,
    members: fixtureRoster
      ? [
          { id: 'fixture:self', displayName: '測試成員甲', groupId: 'G01' },
          { id: 'fixture:other', displayName: '測試成員乙', groupId: 'G01' },
        ]
      : options.fixtureToken
        ? [{ id: 'fixture:self', displayName: 'Fixture', groupId: 'A' }]
        : [],
  });
  if (fixtureRoster) {
    seedMemberGroupProfile(database.db, {
      memberId: 'fixture:self',
      groupId: 'G01',
      groupName: '測試小組A',
      rpgId: 'G01-RPG1',
      rpgName: 'G01-RPG1',
      callUrl: 'https://meet.google.com/nyv-basx-ivu',
      callProvider: 'meet',
      callScope: 'TEST_ONLY',
      linkStatus: 'READY',
    });
    seedMemberGroupProfile(database.db, {
      memberId: 'fixture:other',
      groupId: 'G01',
      groupName: '測試小組A',
      rpgId: 'G01-RPG1',
      rpgName: 'G01-RPG1',
      callUrl: 'https://meet.google.com/nyv-basx-ivu',
      callProvider: 'meet',
      callScope: 'TEST_ONLY',
      linkStatus: 'READY',
    });
  }
  const inviteSeedFile = process.env.QINGMU_INVITE_SEED_FILE;
  if (inviteSeedFile) {
    const seeds = JSON.parse(readFileSync(resolve(inviteSeedFile), 'utf8')) as MemberInviteSeed[];
    for (const seed of seeds) seedMemberInvite(database.db, seed);
  }
  const groupProfileFile = process.env.QINGMU_GROUP_PROFILE_FILE;
  if (groupProfileFile) {
    const profiles = JSON.parse(readFileSync(resolve(groupProfileFile), 'utf8')) as MemberGroupProfileSeed[];
    for (const profile of profiles) seedMemberGroupProfile(database.db, profile);
  }
  const googleAudience = config.googleServerClientId;
  const sessionSecret = process.env.QINGMU_SESSION_SECRET;
  if ((googleAudience && !sessionSecret) || (!googleAudience && sessionSecret)) {
    throw new Error('GOOGLE_SERVER_AUTH_CONFIG_INCOMPLETE');
  }
  if (!fixtureRoster && !options.fixtureToken && !googleAudience) {
    throw new Error('PRODUCTION_GOOGLE_CONFIG_REQUIRED');
  }
  const pointPolicy: PointPolicy = fixtureRoster
    ? { version: 'fixture-week-v1', status: 'ACTIVE', pointsPerCompletion: 1, sharedGoalTarget: 3 }
    : {
        version: process.env.QINGMU_POINT_POLICY_VERSION?.trim() || 'unconfigured',
        status: process.env.QINGMU_POINT_POLICY_STATUS === 'ACTIVE' ? 'ACTIVE' : 'UNCONFIGURED',
        pointsPerCompletion: Math.max(0, Number(process.env.QINGMU_POINTS_PER_COMPLETION ?? 0) || 0),
        ...(Number.isInteger(Number(process.env.QINGMU_WEEKLY_GOAL_TARGET)) ? { sharedGoalTarget: Math.max(0, Number(process.env.QINGMU_WEEKLY_GOAL_TARGET)) } : {}),
      };
  const remoteConfig = createRemoteConfiguration();
  const reminderDelivery = options.reminderDelivery ?? remoteConfig.delivery;
  const disableMeetingReminders = process.env.QINGMU_DISABLE_MEETING_REMINDERS === 'true' || !options.fixtureToken;
  const autostart = disableMeetingReminders ? false : options.reminderWorker?.autostart ?? process.env.QINGMU_REMINDER_WORKER_AUTOSTART === 'true';
  const remoteStatus = reminderDelivery?.enabled && autostart ? 'REMOTE_READY' as const : 'REMOTE_PENDING' as const;
  const worker = reminderDelivery?.enabled ? createReminderWorker({ db: database.db, send: reminderDelivery.send, now: options.reminderWorker?.now, intervalMs: options.reminderWorker?.intervalMs, timer: options.reminderWorker?.timer }) : null;
  // Estimating what a suggested prize costs runs off the machine's own Claude CLI, and only when a
  // path to it is configured. No path, no worker, and nominations behave exactly as they did before
  // any of this was built — which is also what every test sees, since none of them set it.
  const claudePath = process.env.QINGMU_CLAUDE_CLI_PATH?.trim();
  const assistWorker = claudePath
    ? createNominationAssistWorker({ db: database.db, cli: createClaudeCli({ executable: claudePath }) })
    : null;

  const handle = createApiHandler({
    remoteReminderStatus: remoteStatus,
    prewarmChapterAudio: true,
    db: database,
    instanceId: process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured',
    authMode: googleAudience ? 'google-only' : 'fixture',
    scheduleDates: canonicalSeptemberPlan.dates,
    pointPolicy,
    autoProvisionGoogleMembers: Boolean(googleAudience && !options.fixtureToken),
    disableMeetingReminders,
    adminMemberIds: process.env.QINGMU_ADMIN_MEMBER_IDS?.split(',').map((value) => value.trim()).filter(Boolean),
    adminGoogleSubjects: process.env.QINGMU_ADMIN_GOOGLE_SUBJECTS?.split(',').map((value) => value.trim()).filter(Boolean),
    ...(fixtureRoster
      ? {
          weeklyDates: ['2026-09-07', '2026-09-08'],
        }
      : {}),
    ...(googleAudience && !options.fixtureToken
      ? {
          productionGoogleAuth: {
            verify: async (idToken: string) => verifyGoogleIdToken(idToken, { audience: googleAudience }),
            resolveMember: async (identity: { subject: string; provider: 'google' }) => {
              const row = database.db.prepare('SELECT member_id FROM identity_bindings WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as { member_id: string } | undefined;
              return row?.member_id ?? null;
            },
          },
          sessionSecret,
          // The owner's Apps Script pushes sign-up names with this key; derived, so no new secret to configure.
          formRegistrationKey: process.env.QINGMU_FORM_REGISTRATION_KEY?.trim() || (sessionSecret ? deriveFormRegistrationKey(sessionSecret) : undefined),
        }
      : { fixtureToken: options.fixtureToken ?? process.env.QINGMU_DEV_TOKEN ?? 'dev-fixture-token' }),
  });
  const officialBible = createOfficialBibleAdapter();
  const server = createServer(async (request, response) => {
    // Public, identity-checked Bible content is separate from private member APIs.
    const official = await officialBible({ method: request.method ?? 'GET', url: request.url ?? '/',
      headers: Object.fromEntries(Object.entries(request.headers).map(([key,value]) => [key,Array.isArray(value)?value[0]:value])) });
    if (official) {
      response.statusCode = official.status;
      for (const [key,value] of Object.entries(official.headers)) response.setHeader(key,value);
      response.setHeader('x-qingmu-instance-id', process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured');
      response.end(official.status === 204 ? '' : official.raw ? String(official.body) : JSON.stringify(official.body));
      return;
    }
    const result = await handle({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
      ),
      body: request.method === 'PUT' || request.method === 'POST' || request.method === 'PATCH' ? await readBody(request) : undefined,
    });
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-qingmu-instance-id', process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured');
    response.end(JSON.stringify(result.body));
  });
  if (worker && autostart) worker.start();
  if (assistWorker) assistWorker.start();
  let databaseClosing: Promise<void> | null = null;
  const closeDatabase = () => {
    databaseClosing ??= Promise.allSettled([assistWorker?.stop(), worker?.stop()]).then(() => { database.close(); });
    return databaseClosing;
  };
  server.on('close', () => {
    void closeDatabase().catch(() => { console.error('BACKEND_SHUTDOWN_FAILED'); });
  });
  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= new Promise<void>((resolveStop, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') { reject(error); return; }
        void closeDatabase().then(resolveStop, reject);
      });
    });
    return stopping;
  };
  return { server, config, database, worker, assistWorker, stop, remoteStatus, senderConfigured: Boolean(reminderDelivery?.enabled) };
}

const isDirectServerEntry = process.argv.some((argument) => /(?:^|[\\/])server[\\/]http\.ts$/.test(argument));
if (isDirectServerEntry) {
  const { server, stop } = createHttpServer();
  const port = Number(process.env.QINGMU_SERVER_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('QINGMU_SERVER_PORT_INVALID');
  server.listen(port, '127.0.0.1', () => console.log(`qingmu-youth server listening on 127.0.0.1:${port}`));
  const shutdown = () => { void stop().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (process.platform === 'win32') process.once('SIGBREAK', shutdown);
}
