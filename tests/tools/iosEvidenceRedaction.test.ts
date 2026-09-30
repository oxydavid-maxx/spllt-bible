import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { redactEvidence, sanitizeEvidenceDirectory } from '../../scripts/ios/sanitize-evidence';

const roots: string[] = [];
let proxy: ChildProcess | null = null;
let upstream: ReturnType<typeof createServer> | null = null;
afterEach(async () => {
  proxy?.kill(); proxy = null;
  if (upstream) await new Promise<void>(resolve => upstream!.close(() => resolve()));
  upstream = null;
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

describe('CI evidence keeps credentials out of logs and artifacts', () => {
  it('masks raw/encoded query credentials, bearer headers and supplied literal secrets', () => {
    const secret = 'dummy-app-key-123456';
    const input = `GET /stylesheet?app_key=${secret}&font=1\nGET /path%3Fapp_key%3Dother-key%26font%3D1\nAuthorization: Bearer dummy-token\nmessage ${secret}`;
    const output = redactEvidence(input, [secret]);
    for (const value of [secret, 'other-key', 'dummy-token']) expect(output).not.toContain(value);
    expect(output).toContain('font=1');
    expect(output).toContain('[REDACTED]');
  });

  it('sanitizes nested textual evidence without changing verdicts, metrics or screenshot bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'qm-ci-evidence-')); roots.push(root);
    mkdirSync(join(root, 'maestro'));
    const secret = 'dummy-app-key-123456';
    writeFileSync(join(root, 'ios-summary.json'), JSON.stringify({ status: 'FAIL', cpuAvg: 1.26, message: secret }));
    writeFileSync(join(root, 'maestro', 'backend.txt'), `200 /font?app_key=${secret}`);
    const png = Buffer.from([137, 80, 78, 71, 0, 1, 2]);
    writeFileSync(join(root, 'maestro', 'screen.png'), png);
    const result = sanitizeEvidenceDirectory(root, [secret]);
    expect(result.redactedFiles).toBe(2);
    expect(JSON.parse(readFileSync(join(root, 'ios-summary.json'), 'utf8'))).toEqual({ status: 'FAIL', cpuAvg: 1.26, message: '[REDACTED]' });
    expect(readFileSync(join(root, 'maestro', 'backend.txt'), 'utf8')).not.toContain(secret);
    expect(readFileSync(join(root, 'maestro', 'screen.png'))).toEqual(png);
  });

  it('forwards the original authenticated request and response while recording only a sanitized path and error code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qm-ci-proxy-')); roots.push(root);
    const log = join(root, 'requests.log');
    const secret = 'dummy-app-key-123456';
    let received = '';
    const responseBody = JSON.stringify({ error: { code: 'DENIED', message: secret } });
    upstream = createServer((request, response) => { received = request.url ?? ''; response.writeHead(403); response.end(responseBody); });
    await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', resolve));
    const targetPort = (upstream.address() as { port: number }).port;
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const proxyPort = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    proxy = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), process.env.QINGMU_CI_PROXY_SOURCE ?? 'scripts/ios/count-proxy.ts', String(proxyPort), String(targetPort), log], {
      cwd: process.cwd(), env: { ...process.env, EXPO_PUBLIC_YOUVERSION_APP_KEY: secret }, stdio: 'ignore',
    });
    const path = `/v1/fonts/1/stylesheet?app_key=${secret}&font=1`;
    let response: Response | null = null;
    const until = performance.now() + 3000;
    while (!response && performance.now() < until) {
      try { response = await fetch(`http://127.0.0.1:${proxyPort}${path}`); }
      catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe(responseBody);
    expect(received).toBe(path);
    const recorded = readFileSync(log, 'utf8');
    expect(recorded).not.toContain(secret);
    expect(recorded).toContain('app_key=[REDACTED]&font=1');
    expect(recorded).toContain('= 403');
    expect(recorded).toContain('DENIED');
  });
});
