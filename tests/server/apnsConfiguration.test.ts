import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteConfiguration } from '../../server/remoteConfiguration';

// iPhone pushes need only the APNs key trio; they do not depend on FCM being configured, and a missing key
// file leaves them off instead of failing the server.
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function keyFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qingmu-apns-')); dirs.push(dir);
  const path = join(dir, 'AuthKey_TEST.p8'); writeFileSync(path, 'not a real key; never read in this test'); return path;
}

describe('APNs configuration', () => {
  it('is off without the key trio', () => {
    expect(createRemoteConfiguration({}).pushIos).toBeNull();
  });
  it('is on with the key trio even when FCM is not configured', () => {
    const config = createRemoteConfiguration({ QINGMU_APNS_KEY_FILE: keyFile(), QINGMU_APNS_KEY_ID: 'KEYID', QINGMU_APNS_TEAM_ID: 'TEAMID' });
    expect(config.push).toBeNull();
    expect(typeof config.pushIos).toBe('function');
  });
  it('stays off when the key file is missing', () => {
    expect(createRemoteConfiguration({ QINGMU_APNS_KEY_FILE: join(tmpdir(), 'qingmu-apns-missing.p8'), QINGMU_APNS_KEY_ID: 'K', QINGMU_APNS_TEAM_ID: 'T' }).pushIos).toBeNull();
  });
});
