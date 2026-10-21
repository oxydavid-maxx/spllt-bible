/**
 * The version file a fixture backend serves (GET /api/fixture/app-version.json, server/routes.ts), so the CI
 * simulator flows can show the update prompt without reading the real file beside the APK: one build ahead of
 * the app under test (app.json), for Android and for TestFlight, in the published format (docs/app-version.md).
 * The note says plainly that it is a test.
 */
export function fixtureVersionNotice(expo: { version: string; android: { versionCode: number } }): Record<string, unknown> {
  const [major, minor, patch] = expo.version.split('.').map(Number);
  const versionName = `${major}.${minor}.${patch + 1}`;
  const build = expo.android.versionCode + 1;
  const note = '測試用：比這支 App 新一版。';
  return {
    versionCode: build, versionName, url: 'https://home.luminexhealthbiohack.com/public/jhuke-bible/', mandatory: false, note,
    ios: { testflight: { buildNumber: build, versionName, note } },
  };
}
