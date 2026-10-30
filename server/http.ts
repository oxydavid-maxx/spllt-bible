import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runtimeConfig } from '../src/config/runtime';
import { createDatabase, type ServerDatabase } from './db';
import { createApiHandler } from './routes';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { verifyGoogleIdToken, verifyGoogleIdTokenAnyAudience } from './googleVerifier';
import { verifyAppleIdToken } from './appleVerifier';
import { createAppleTokenClient } from './appleTokens';
import { canonicalReadingPlan } from '../src/domain/calendar';
import { seedMemberInvite, type MemberInviteSeed } from './membership';
import type { PointPolicy } from '../src/domain/points';
import { seedMemberGroupProfile, type MemberGroupProfileSeed } from './groups';
import { createRemoteConfiguration } from './remoteConfiguration';
import { createReminderWorker, type ReminderWorkerTimer } from './reminderWorker';
import type { PushDataSender } from './friendPush';
import type { ApnsAlertSender } from './apnsSender';
import type { MeetingSender } from './remoteReminders';
import { createOfficialBibleAdapter } from './officialBibleAdapter';
import { taipeiDate } from '../src/domain/gamificationV1';
import { createDevotionalAudio, latestDevotionalDate, readAzureSpeechConfig, warmDevotionalAudio } from './devotionalAudio';
import { devotionalPlayerResponse } from './devotional';
import { createLineWebhook, LINE_WEBHOOK_BODY_LIMIT, LINE_WEBHOOK_PATH, readLineChannelSecret } from './lineWebhook';
import { createBulletinCollector, type LineImage } from './bulletins';
import { createLineClient, readLineChannelIdFile } from './lineContent';
import { createLineGroupDirectory } from './lineGroups';
import { installNat64Fallback } from './nat64Fallback';
import { deriveFormRegistrationKey } from './eventRegistrations';
import { fixtureVersionNotice } from './fixtureVersionNotice';

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** The exact bytes, for routes that check a signature over them; null once past the limit. */
function readRawBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      if (size > limit) return;
      size += chunk.length;
      if (size > limit) { chunks.length = 0; resolve(null); } else chunks.push(chunk);
    });
    request.on('end', () => { if (size <= limit) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
  });
}

export function createHttpServer(options: { fixtureToken?: string; database?: ServerDatabase; reminderDelivery?: { enabled: boolean; send: MeetingSender }; pushData?: PushDataSender; pushIos?: ApnsAlertSender; reminderWorker?: { autostart?: boolean; now?: () => Date; intervalMs?: number; timer?: ReminderWorkerTimer } } = {}) {
  const config = runtimeConfig();
  const azureSpeech = readAzureSpeechConfig(process.env.QINGMU_AZURE_SPEECH_FILE);
  const devotionalDir = process.env.QINGMU_DEVOTIONAL_DIR?.trim();
  const devotionalAudio = azureSpeech && devotionalDir ? createDevotionalAudio({ config: azureSpeech, cacheDir: join(devotionalDir, '.audio') }) : undefined;
  // The newest post is prepared at start too: it may have arrived before this version (or Azure) was running.
  if (devotionalAudio && devotionalDir) {
    const latest = latestDevotionalDate(devotionalDir, taipeiDate(new Date()));
    if (latest) void warmDevotionalAudio(devotionalAudio, devotionalDir, latest);
  }
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
  const adminGoogleSubjects = process.env.QINGMU_ADMIN_GOOGLE_SUBJECTS?.split(',').map((value) => value.trim()).filter(Boolean);
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
  // Friend pushes need a configured sender and nothing else; the meeting dispatcher stays off.
  const pushData = options.pushData ?? remoteConfig.push ?? undefined;
  const pushIos = options.pushIos ?? remoteConfig.pushIos ?? undefined;
  const disableMeetingReminders = process.env.QINGMU_DISABLE_MEETING_REMINDERS === 'true' || !options.fixtureToken;
  const autostart = disableMeetingReminders ? false : options.reminderWorker?.autostart ?? process.env.QINGMU_REMINDER_WORKER_AUTOSTART === 'true';
  const remoteStatus = reminderDelivery?.enabled && autostart ? 'REMOTE_READY' as const : 'REMOTE_PENDING' as const;
  const worker = reminderDelivery?.enabled ? createReminderWorker({ db: database.db, send: reminderDelivery.send, now: options.reminderWorker?.now, intervalMs: options.reminderWorker?.intervalMs, timer: options.reminderWorker?.timer }) : null;

  const appleKeyFile = process.env.QINGMU_APPLE_SIGNIN_KEY_FILE;
  const appleKeyId = process.env.QINGMU_APPLE_SIGNIN_KEY_ID;
  const appleTeamId = process.env.QINGMU_APPLE_SIGNIN_TEAM_ID;
  const appleTokens = appleKeyFile && appleKeyId && appleTeamId
    ? createAppleTokenClient({ privateKey: readFileSync(appleKeyFile, 'utf8'), keyId: appleKeyId, teamId: appleTeamId }) : null;
  const handle = createApiHandler({
    remoteReminderStatus: remoteStatus,
    prewarmChapterAudio: true,
    db: database,
    instanceId: process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured',
    authMode: googleAudience ? 'google-only' : 'fixture',
    scheduleDates: canonicalReadingPlan.dates,
    pointPolicy,
    autoProvisionGoogleMembers: Boolean(googleAudience && !options.fixtureToken),
    disableMeetingReminders,
    ...(pushData ? { pushData } : {}),
    ...(pushIos ? { pushIos } : {}),
    adminMemberIds: process.env.QINGMU_ADMIN_MEMBER_IDS?.split(',').map((value) => value.trim()).filter(Boolean),
    adminGoogleSubjects,
    ...(devotionalDir ? { devotionalDir } : {}),
    ...(process.env.QINGMU_BULLETIN_DIR?.trim() ? { bulletinDir: process.env.QINGMU_BULLETIN_DIR.trim() } : {}),
    ...(process.env.QINGMU_ADMIN_LINKS_FILE?.trim() ? { adminLinksFile: process.env.QINGMU_ADMIN_LINKS_FILE.trim() } : {}),
    ...(devotionalAudio ? { devotionalAudio } : {}),
    ...(fixtureRoster
      ? {
          weeklyDates: ['2026-09-07', '2026-09-08'],
          // The simulator flows' version file, one build ahead of the app under test (.maestro/ios/42-testflight-update.yaml).
          fixtureAppVersion: fixtureVersionNotice(JSON.parse(readFileSync(resolve('app.json'), 'utf8')).expo),
        }
      : {}),
    ...(googleAudience && !options.fixtureToken
      ? {
          // Identity verification uses Apple's public JWKS; the private key is only
          // needed for authorization-code exchange and token revocation.
          productionAppleAuth: {
            verify: (token: string, nonce: string) => verifyAppleIdToken(token, { nonce }), ...appleTokens,
          },
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
          // Or it sends its Google identity token: accepted for an admin's account, from one script project.
          ...(adminGoogleSubjects?.length
            ? {
                formSyncIdentity: {
                  verify: (idToken: string) => verifyGoogleIdTokenAnyAudience(idToken),
                  ownerSubjects: adminGoogleSubjects,
                  ...(process.env.QINGMU_FORM_SYNC_AUDIENCE?.trim() ? { audience: process.env.QINGMU_FORM_SYNC_AUDIENCE.trim() } : {}),
                },
              }
            : {}),
        }
      // A fixture backend takes the prize sheet only when CI names a key (scripts/ios/run-flows.sh, 2026-10-23: 選擇目標獎品
      // opens only with prizes on the shelf).
      : { ...(fixtureRoster ? { productionAppleAuth: { verify: async () => { throw new Error('FIXTURE_APPLE_IDENTITY_REFUSED'); } } } : {}), fixtureToken: options.fixtureToken ?? process.env.QINGMU_DEV_TOKEN ?? 'dev-fixture-token', ...(process.env.QINGMU_FIXTURE_DEFAULT_MEMBER?.trim() ? { fixtureDefaultMemberId: process.env.QINGMU_FIXTURE_DEFAULT_MEMBER.trim() } : {}), ...(process.env.QINGMU_FORM_REGISTRATION_KEY?.trim() ? { formRegistrationKey: process.env.QINGMU_FORM_REGISTRATION_KEY.trim() } : {}) }),
  });
  const officialBible = createOfficialBibleAdapter();
  const lineChannelSecret = readLineChannelSecret(process.env.QINGMU_LINE_SECRET_FILE);
  // 主堂週刊: off unless the channel ID sits beside the secret and a folder is configured (server/bulletins.ts).
  const lineChannelId = readLineChannelIdFile(process.env.QINGMU_LINE_SECRET_FILE);
  // One short-lived token downloads the 週刊 photos and asks each group's name (server/lineContent.ts).
  const lineApi = lineChannelSecret && lineChannelId ? createLineClient({ channelId: lineChannelId, channelSecret: lineChannelSecret }) : null;
  const bulletins = lineApi && process.env.QINGMU_BULLETIN_DIR?.trim()
    ? createBulletinCollector({ dir: process.env.QINGMU_BULLETIN_DIR.trim(), fetchContent: lineApi.fetchContent })
    : null;
  const lineGroupsFile = process.env.QINGMU_LINE_GROUPS_FILE?.trim();
  const lineWebhook = lineChannelSecret && process.env.QINGMU_DEVOTIONAL_DIR?.trim()
    ? createLineWebhook({ channelSecret: lineChannelSecret, devotionalDir: process.env.QINGMU_DEVOTIONAL_DIR.trim(),
      // Only the 公布欄 group's 靈修 and 週刊 are taken (server/lineGroups.ts). Without the channel ID LINE cannot be
      // asked a group's name, so only the groups already in the file are known.
      groups: createLineGroupDirectory({
        ...(lineGroupsFile ? { file: lineGroupsFile } : {}),
        lookup: lineApi ? lineApi.groupSummary : async () => { throw new Error('LINE_CHANNEL_ID_MISSING'); },
      }),
      ...(devotionalAudio ? { onSaved: (date: string) => { void warmDevotionalAudio(devotionalAudio, devotionalDir, date); } } : {}),
      ...(bulletins ? { onImage: (image: LineImage) => bulletins.receive(image) } : {}) })
    : null;
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
    // The 靈修 song player is a page, not JSON, and carries nothing private: only the video id it is given.
    const player = devotionalPlayerResponse(request.method ?? 'GET', request.url ?? '/');
    if (player) {
      response.statusCode = player.status;
      response.setHeader('content-type', player.contentType);
      response.setHeader('cache-control', 'public, max-age=86400');
      response.end(player.body);
      return;
    }
    // LINE's delivery of the groups' messages; only the 公布欄's 靈修 and 週刊 are kept (server/lineWebhook.ts).
    if (request.method === 'POST' && (request.url ?? '').split('?')[0] === LINE_WEBHOOK_PATH) {
      const raw = lineWebhook ? await readRawBody(request, LINE_WEBHOOK_BODY_LIMIT) : null;
      const reply = !lineWebhook ? { status: 404, body: { error: 'NOT_FOUND' } }
        : raw === null ? { status: 413, body: { error: 'BODY_TOO_LARGE' } }
        : await lineWebhook({ rawBody: raw, signature: request.headers['x-line-signature'] as string | undefined });
      response.statusCode = reply.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      // A body past the limit is left unread; close the connection rather than keep reading it.
      if (raw === null && lineWebhook) response.setHeader('connection', 'close');
      response.end(JSON.stringify(reply.body));
      return;
    }
    const result = await handle({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
      ),
      body: request.method === 'PUT' || request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE' ? await readBody(request) : undefined,
    });
    response.statusCode = result.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-qingmu-instance-id', process.env.QINGMU_INSTANCE_ID?.trim() || 'unconfigured');
    for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
    response.end(result.binaryBody ?? JSON.stringify(result.body));
  });
  if (worker && autostart) worker.start();
  let databaseClosing: Promise<void> | null = null;
  const closeDatabase = () => {
    databaseClosing ??= Promise.allSettled([worker?.stop()]).then(() => { database.close(); });
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
  return { server, config, database, worker, stop, remoteStatus, senderConfigured: Boolean(reminderDelivery?.enabled) };
}

const isDirectServerEntry = process.argv.some((argument) => /(?:^|[\\/])server[\\/]http\.ts$/.test(argument));
if (isDirectServerEntry) {
  // IPv4-only upstreams (LINE, Azure Speech) keep working while the home line has IPv6 only (server/nat64Fallback.ts).
  if (process.env.QINGMU_NAT64_FALLBACK?.trim() !== '0') installNat64Fallback();
  const { server, stop } = createHttpServer();
  const port = Number(process.env.QINGMU_SERVER_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('QINGMU_SERVER_PORT_INVALID');
  server.listen(port, '127.0.0.1', () => console.log(`qingmu-youth server listening on 127.0.0.1:${port}`));
  const shutdown = () => { void stop().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (process.platform === 'win32') process.once('SIGBREAK', shutdown);
}
