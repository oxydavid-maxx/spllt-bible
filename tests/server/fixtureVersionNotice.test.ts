import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { fixtureVersionNotice } from '../../server/fixtureVersionNotice';
import { createApiHandler } from '../../server/routes';
import { readPublishedIos, readPublishedVersion } from '../../src/services/updateCheck';

// The iOS CI flows run against the fixture backend, never against the published file beside the APK. To show
// the TestFlight prompt there, the fixture backend publishes a version one build ahead of the app under test.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const expo = JSON.parse(readFileSync('app.json', 'utf8')).expo as { version: string; android: { versionCode: number } };

describe('the fixture version file', () => {
  it('is one build ahead of app.json, for Android and TestFlight, in the published format', () => {
    const notice = fixtureVersionNotice(expo);
    expect(readPublishedVersion(notice)).toMatchObject({ versionCode: expo.android.versionCode + 1 });
    expect(readPublishedIos(notice).testflight).toMatchObject({ buildNumber: expo.android.versionCode + 1 });
    expect(readPublishedIos(notice).appStoreListed).toBe(false);
  });

  it('is served only by a fixture backend, without signing in', async () => {
    const db = createDatabase({ members: [] }); databases.push(db);
    const notice = fixtureVersionNotice(expo);
    const fixture = createApiHandler({ db, fixtureToken: 'fixture', fixtureAppVersion: notice });
    const served = await fixture({ method: 'GET', url: '/api/fixture/app-version.json', headers: {} });
    expect(served.status).toBe(200);
    expect(served.body).toEqual(notice);
    const production = createApiHandler({ db, fixtureToken: 'fixture' });
    expect((await production({ method: 'GET', url: '/api/fixture/app-version.json', headers: {} })).status).not.toBe(200);
  });

  it('is wired into the fixture roster only', () => {
    const http = readFileSync('server/http.ts', 'utf8');
    expect(http).toMatch(/fixtureRoster\s*\?\s*\{[^}]*fixtureAppVersion: fixtureVersionNotice\(/s);
  });
});
