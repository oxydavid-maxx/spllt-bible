const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Removes two permissions the app does not use and Play reads as warning signs.
 *
 * SYSTEM_ALERT_WINDOW lets an app draw over other apps. It arrives transitively from a development
 * dependency, never from anything this app does, and on a store listing aimed at a youth group it
 * is the permission that makes a parent close the page.
 *
 * WRITE_EXTERNAL_STORAGE has been unnecessary since Android 10 scoped storage, and the one place
 * this app writes outside itself — the journal folder mirror — goes through the Storage Access
 * Framework, where the grant is the folder the member picked and nothing else.
 *
 * A config plugin rather than a manifest edit because android/ is generated and untracked: an edit
 * there lasts until the next prebuild and then quietly comes back.
 */

const REMOVED = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

module.exports = function withQingmuPermissionFloor(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const declared = manifest['uses-permission'] ?? [];

    // tools:node="remove" rather than deleting the entry: a library merging the permission back in
    // during manifest merging would otherwise reinstate it, and the removal has to outrank that.
    manifest.$ = manifest.$ ?? {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';

    manifest['uses-permission'] = declared.filter((entry) => !REMOVED.includes(entry.$?.['android:name']));
    for (const name of REMOVED) {
      manifest['uses-permission'].push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return mod;
  });
};
