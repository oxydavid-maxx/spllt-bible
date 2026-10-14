import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveReaderContentApiHost } from '../../src/ui/youVersionReaderConfig';

const root = new URL('../../', import.meta.url);
const workflow = parse(readFileSync(new URL('.github/workflows/ios.yml', root), 'utf8'));

describe('isolated iOS fixture transport matches its IPv4 TLS identity', () => {
  it('uses the proxy listener address rather than an ambiguous localhost name', () => {
    const url = new URL(workflow.jobs.simulator.env.EXPO_PUBLIC_QINGMU_API_BASE_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('8788');
    expect(resolveReaderContentApiHost(url.href)).toBe('127.0.0.1:8788');
    const proxy = readFileSync(new URL('scripts/ios/count-proxy.ts', root), 'utf8');
    expect(proxy).toContain("server.listen(Number(listen), '127.0.0.1')");
  });

  // The real Unix Bash/OpenSSL generator is exercised by Linux CI. No Windows tool root is required.
  it.skipIf(process.platform === 'win32')('generates a real leaf certificate covering the configured IP', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ios-tls-'));
    execFileSync('bash', [new URL('scripts/ios/make-ci-tls.sh', root).pathname, dir], { stdio: 'pipe' });
    const san = execFileSync('openssl', ['x509', '-in', join(dir, 'leaf.pem'), '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' });
    expect(san).toContain('IP Address:127.0.0.1');
  });
});
