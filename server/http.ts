import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runtimeConfig } from '../src/config/runtime';
import { createDatabase } from './db';
import { createApiHandler } from './routes';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifyGoogleIdToken } from './googleVerifier';
import { canonicalSeptemberPlan } from '../src/domain/calendar';
import { seedMemberInvite, type MemberInviteSeed } from './membership';
import type { PointPolicy } from '../src/domain/points';
import { seedMemberGroupProfile, type MemberGroupProfileSeed } from './groups';
import { createFcmSender } from '../src/services/reminderDelivery';
import { createServiceAccountAccessTokenProvider, resolveFcmCredentialFile } from './fcmAuth';
import { createReminderWorker, type ReminderWorkerTimer } from './reminderWorker';
import type { ApiHandlerOptions } from './routes';

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function createHttpServer(options: {
  fixtureToken?: string;
  reminderDelivery?: NonNullable<ApiHandlerOptions['reminderDelivery']>;
  reminderWorker?: { autostart?: boolean; now?: () => Date; intervalMs?: number; timer?: ReminderWorkerTimer };
} = {}) {
  const config = runtimeConfig();
  const fixtureRoster = process.env.QINGMU_FIXTURE_ROSTER === 'two-member-week';
  const databaseFilename = process.env.QINGMU_DB_PATH;
  if (databaseFilename && databaseFilename !== ':memory:') mkdirSync(dirname(resolve(databaseFilename)), { recursive: true });
  const database = createDatabase({
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
  if (fixtureRoster && !process.env.QINGMU_GROUP_PROFILE_FILE) {
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
  if ((googleAudience && !sessionSecret) || (!googleAudience && sessionSecret && !fixtureRoster && !options.fixtureToken)) {
    throw new Error('GOOGLE_SERVER_AUTH_CONFIG_INCOMPLETE');
  }
  if (!fixtureRoster && !options.fixtureToken && !googleAudience) {
    throw new Error('PRODUCTION_GOOGLE_CONFIG_REQUIRED');
  }
  const fcmProjectId = process.env.QINGMU_FCM_PROJECT_ID?.trim();
  const reminderWorkerToken = process.env.QINGMU_REMINDER_WORKER_TOKEN?.trim();
  const fcmCredentialFile = resolveFcmCredentialFile();
  const fcmAccessTokenProvider = fcmCredentialFile
    ? createServiceAccountAccessTokenProvider({ credentialFilePath: fcmCredentialFile })
    : null;
  const fcmSender = fcmProjectId && fcmAccessTokenProvider && reminderWorkerToken
    ? createFcmSender({ projectId: fcmProjectId, enabled: true, getAccessToken: fcmAccessTokenProvider.getAccessToken })
    : null;
  const reminderDelivery = options.reminderDelivery ?? (fcmSender && reminderWorkerToken
    ? {
        workerToken: reminderWorkerToken,
        enabled: true,
            // The provider result MUST be returned. sendDueMeetingEvent reads messageId from
            // it to fill reminder_deliveries.provider_message_id, which is the only
            // server-side handle for reconciling a delivery against FCM. Discarding it made
            // every successful send record a NULL id, so a real send and an unacknowledged
            // one were indistinguishable in the data. Observed in run 5.
            send: async (token: string, payload: { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number }) => {
          return await fcmSender.send(token, payload, { ttlSeconds: 300 });
        },
      }
    : undefined);
  const pointPolicy: PointPolicy = fixtureRoster
    ? { version: 'fixture-week-v1', status: 'ACTIVE', pointsPerCompletion: 1, sharedGoalTarget: 3 }
    : {
        version: process.env.QINGMU_POINT_POLICY_VERSION?.trim() || 'unconfigured',
        status: process.env.QINGMU_POINT_POLICY_STATUS === 'ACTIVE' ? 'ACTIVE' : 'UNCONFIGURED',
        pointsPerCompletion: Math.max(0, Number(process.env.QINGMU_POINTS_PER_COMPLETION ?? 0) || 0),
        ...(Number.isInteger(Number(process.env.QINGMU_WEEKLY_GOAL_TARGET)) ? { sharedGoalTarget: Math.max(0, Number(process.env.QINGMU_WEEKLY_GOAL_TARGET)) } : {}),
      };
  const handle = createApiHandler({
    db: database,
    instanceId: process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured',
    authMode: googleAudience ? 'google-only' : 'fixture',
    scheduleDates: canonicalSeptemberPlan.dates,
    pointPolicy,
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
      }
      : { fixtureToken: options.fixtureToken ?? process.env.QINGMU_DEV_TOKEN ?? 'dev-fixture-token' }),
    ...(reminderDelivery ? { reminderDelivery } : {}),
  });
  const worker = reminderDelivery?.enabled
    ? createReminderWorker({ db: database.db, send: reminderDelivery.send, now: options.reminderWorker?.now, intervalMs: options.reminderWorker?.intervalMs, timer: options.reminderWorker?.timer })
    : null;
  const autostart = options.reminderWorker?.autostart ?? process.env.QINGMU_REMINDER_WORKER_AUTOSTART === 'true';
  if (worker && autostart) worker.start();
  const server = createServer(async (request, response) => {
    const result = await handle({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
      ),
      body: request.method === 'PUT' || request.method === 'POST' ? await readBody(request) : undefined,
    });
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-qingmu-instance-id', process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured');
    response.end(JSON.stringify(result.body));
  });
  server.on('close', () => { worker?.stop(); database.close(); });
  return { server, config, worker, database };
}

const isDirectServerEntry = process.argv.some((argument) => /(?:^|[\\/])server[\\/]http\.ts$/.test(argument));
if (isDirectServerEntry) {
  const { server } = createHttpServer();
  const port = Number(process.env.QINGMU_SERVER_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('QINGMU_SERVER_PORT_INVALID');
  server.listen(port, '127.0.0.1', () => console.log(`qingmu-youth server listening on 127.0.0.1:${port}`));
}
