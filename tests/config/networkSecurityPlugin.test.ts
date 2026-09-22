import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('qingmu-network-policy-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Android build-type network policy', () => {
  it('keeps release deny-all bytes and gives debug only exact local development endpoints', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'qingmu-network-policy-')); roots.push(root);
    const android = path.join(root, 'android'); mkdirSync(android);
    let manifestMod!: (config: any) => any;
    let resourceMod!: (config: any) => Promise<any>;
    const module = { exports: {} as (config: any) => any };
    const require = (name: string) => {
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return path;
      if (name === '@expo/config-plugins') return {
        withAndroidManifest(config: any, action: typeof manifestMod) { manifestMod = action; return config; },
        withDangerousMod(config: any, [_platform, action]: [string, typeof resourceMod]) { resourceMod = action; return config; },
      };
      throw new Error('UNEXPECTED_PLUGIN_DEPENDENCY');
    };
    new Function('require', 'module', readFileSync('plugins/withQingmuNetworkSecurity.js', 'utf8'))(require, module);
    module.exports({});
    const manifest = manifestMod({ modResults: { manifest: { application: [{ $: {} }] } } });
    expect(manifest.modResults.manifest.application[0].$['android:networkSecurityConfig']).toBe('@xml/network_security_config');
    await resourceMod({ modRequest: { platformProjectRoot: android } });
    const release = readFileSync(path.join(android, 'app/src/main/res/xml/network_security_config.xml'), 'utf8');
    expect(release).toBe('<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <base-config cleartextTrafficPermitted="false" />\n</network-security-config>\n');
    const debug = readFileSync(path.join(android, 'app/src/debug/res/xml/network_security_config.xml'), 'utf8');
    expect(debug).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(debug).toContain('<domain-config cleartextTrafficPermitted="true">');
    const domains = [...debug.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map(match => match[1]);
    expect(domains.sort()).toEqual(['10.0.2.2', '127.0.0.1', 'localhost']);
    expect(debug.match(/<domain\s/g)).toHaveLength(3);
    expect(debug).not.toContain('includeSubdomains="true"');
  });
});

