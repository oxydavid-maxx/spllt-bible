import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileModsAsync } from '@expo/config-plugins';
import { describe, expect, it } from 'vitest';

const plugin = require('../../plugins/withQingmuTestLab');

describe('Test Lab Android native config plugin', () => {
  it('registers the bridge on the installed Expo template and preserves it across prebuilds', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'qingmu-testlab-'));
    try {
      // Use the actual installed template, so a changed Expo package-list hook fails this guard.
      const template = execFileSync('tar', ['-xOf', path.join(process.cwd(), 'node_modules/expo/template.tgz'), 'package/android/app/src/main/java/com/helloworld/MainApplication.kt'], { encoding: 'utf8' });
      const directory = path.join(root, 'android/app/src/main/java/com/helloworld');
      mkdirSync(directory, { recursive: true });
      const main = path.join(directory, 'MainApplication.kt');
      writeFileSync(main, template, 'utf8');
      for (let pass = 0; pass < 2; pass++) {
        const config = plugin({ name: 'synthetic', slug: 'synthetic', android: { package: 'com.helloworld' } });
        await compileModsAsync(config, { projectRoot: root, platforms: ['android'] });
      }
      expect(readFileSync(main, 'utf8').match(/add\(QingmuTestLabPackage\(\)\)/g)).toHaveLength(1);
      const bridge = readFileSync(path.join(directory, 'QingmuTestLabPackage.kt'), 'utf8');
      expect(bridge).toContain('Settings.System.getString(reactApplicationContext.contentResolver, "firebase.test.lab")');
      expect(bridge).toContain('promise.resolve("true" == setting)');
      expect(bridge).toContain('override fun getName() = "QingmuTestLab"');
      expect(bridge).toContain('@ReactMethod');
      expect(bridge).not.toContain('Settings.System.put');
      expect(configPlugins()).toContain('./plugins/withQingmuTestLab');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('does not add an iOS native mod', () => {
    const config = plugin({ name: 'synthetic', slug: 'synthetic' });
    expect(config.mods.ios).toBeUndefined();
  });
});

function configPlugins() {
  const config = require('../../app.config.js')({ config: require('../../app.json').expo });
  return config.plugins;
}
