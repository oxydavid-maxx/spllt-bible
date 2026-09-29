import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Every iOS build links react-native-nitro-google-signin's pod, whose AppCheckCore dependency cannot be
// integrated as a static library without these modular headers. The library's own config plugin only adds
// them together with a Google client config, so a build without one (the CI fixture) failed in pod install.
const require = createRequire(import.meta.url);
const plugin = require('../../plugins/withGoogleSignInPods') as {
  addGoogleSignInPods: (src: string) => { contents: string; didMerge: boolean };
  GOOGLE_SIGN_IN_PODS_TAG: string;
  GOOGLE_SIGN_IN_PODS: string;
};
const podfile = "target 'app' do\n  config = use_native_modules!(config_command)\n  use_react_native!(:path => config[:reactNativePath])\nend\n";

describe('Google Sign-In pods on every iOS build', () => {
  it('adds the three modular-header pods before use_native_modules', () => {
    const { contents, didMerge } = plugin.addGoogleSignInPods(podfile);
    expect(didMerge).toBe(true);
    for (const pod of ['AppCheckCore', 'GoogleUtilities', 'RecaptchaInterop']) expect(contents).toContain(`pod '${pod}', :modular_headers => true`);
    expect(contents.indexOf("pod 'AppCheckCore'")).toBeLessThan(contents.indexOf('use_native_modules!'));
  });

  it('is a no-op when the block is already there, so it never duplicates the pods', () => {
    const once = plugin.addGoogleSignInPods(podfile).contents;
    const twice = plugin.addGoogleSignInPods(once);
    expect(twice.didMerge).toBe(false);
    expect(twice.contents).toBe(once);
  });

  it('writes the same tag and lines as the library, so the two plugins produce one block when both run', () => {
    const source = readFileSync('node_modules/react-native-nitro-google-signin/plugin/withNitroGoogleSignIn.js', 'utf8');
    expect(source).toContain(`const GOOGLE_SIGN_IN_PODFILE_TAG = '${plugin.GOOGLE_SIGN_IN_PODS_TAG}'`);
    expect(source).toContain(`const GOOGLE_SIGN_IN_PODFILE_PODS = \`${plugin.GOOGLE_SIGN_IN_PODS}\``);
  });

  it('is registered in app.json', () => {
    const plugins = JSON.parse(readFileSync('app.json', 'utf8')).expo.plugins as unknown[];
    expect(plugins).toContain('./plugins/withGoogleSignInPods');
  });
});
