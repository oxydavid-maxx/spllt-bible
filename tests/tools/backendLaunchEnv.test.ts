import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The production launcher passes the backend an allowlist of variables and nothing else, so a server
// feature whose folder or switch is not on that list stays off without any error (2026-10-14: the
// 靈修 tab would have read 「這一天的靈修還沒有上傳」 every day).
describe('the production backend launch environment', () => {
  const launcher = readFileSync('ops/deployment_support.py', 'utf8');

  it('hands the server the private 靈修 folder', () => {
    expect(readFileSync('server/http.ts', 'utf8')).toContain('process.env.QINGMU_DEVOTIONAL_DIR');
    expect(launcher).toMatch(/'QINGMU_DEVOTIONAL_DIR': str\(PILOT \/ 'devotionals'\)/);
  });

  it('hands the server the LINE channel secret file, so the 靈修 webhook is on', () => {
    expect(readFileSync('server/http.ts', 'utf8')).toContain('process.env.QINGMU_LINE_SECRET_FILE');
    expect(launcher).toMatch(/read_line_environment\(PILOT \/ 'line-runtime-config\.json'\)/);
  });
  it('passes the optional Azure Speech file without exposing its key', () => {
    expect(readFileSync('server/http.ts', 'utf8')).toContain('process.env.QINGMU_AZURE_SPEECH_FILE');
    expect(launcher).toContain("read_azure_speech_environment(PILOT / 'azure-speech-runtime-config.json')");
  });
  // 2026-10-17: Sign in with Apple revokes on account deletion, and iPhone friend pushes need APNs; one key does both.
  it('passes the optional Apple key to Sign in with Apple and APNs without exposing it', () => {
    const reader = readFileSync('ops/apple_config.py', 'utf8');
    const server = readFileSync('server/http.ts', 'utf8') + readFileSync('server/remoteConfiguration.ts', 'utf8');
    for (const name of ['QINGMU_APPLE_SIGNIN_KEY_FILE', 'QINGMU_APPLE_SIGNIN_KEY_ID', 'QINGMU_APPLE_SIGNIN_TEAM_ID', 'QINGMU_APNS_KEY_FILE', 'QINGMU_APNS_KEY_ID', 'QINGMU_APNS_TEAM_ID']) {
      expect(server).toContain(name);
      expect(reader).toContain(`'${name}'`);
    }
    expect(launcher).toContain("read_apple_environment(PILOT / 'apple-runtime-config.json')");
    expect(reader).not.toMatch(/read_text\(\)|print\(/);
  });
});
