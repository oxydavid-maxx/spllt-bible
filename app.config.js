const fs = require('node:fs');

module.exports = ({ config }) => {
  const plugins = Array.isArray(config.plugins)
    ? config.plugins.filter((plugin) => plugin !== 'react-native-nitro-google-signin' && !(Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin'))
    : [];
  // The private build config names it QINGMU_GOOGLE_ANDROID_SERVICES_FILE; a bare `expo prebuild`
  // that saw only that name used to drop the google-services Gradle lines (2026-09-28).
  const androidServices = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE || process.env.QINGMU_GOOGLE_ANDROID_SERVICES_FILE;
  const iosServices = process.env.EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE;
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();
  const hasAndroidServices = Boolean(androidServices && fs.existsSync(androidServices));
  const hasIosServices = Boolean(iosServices && fs.existsSync(iosServices));
  const serviceOptions = {
    ...(hasAndroidServices ? { androidGoogleServicesFile: androidServices } : {}),
    ...(hasIosServices ? { iosGoogleServicesFile: iosServices } : {}),
  };
  const nextConfig = { ...config };
  // Local Gradle does not consume eas.json. Embed its default channel too, so the official
  // request-header override API can switch this exact release build to preview without disabling recovery.
  const isolatedOtaCi = process.env.CI === 'true' && process.env.QINGMU_CI_DISABLE_OTA_CHECKS === '1'
    && !process.env.EAS_BUILD_PROFILE && process.env.EAS_BUILD !== 'true'
    && !process.env.QINGMU_RELEASE_SIGNING_PROPERTIES;
  nextConfig.runtimeVersion = { policy: 'appVersion' };
  nextConfig.updates = {
    ...config.updates,
    url: `https://u.expo.dev/${config.extra?.eas?.projectId ?? require('./app.json').expo.extra.eas.projectId}`,
    requestHeaders: { 'expo-channel-name': process.env.EAS_BUILD_PROFILE === 'preview' ? 'preview' : 'production' },
    enabled: true,
    // One JS check after rendering, never on the launch critical path or on a polling timer.
    checkAutomatically: isolatedOtaCi ? 'NEVER' : 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    useEmbeddedUpdate: true,
    disableAntiBrickingMeasures: false,
  };
  // CI can exercise the real native channel switch without contacting the real update service.
  // EAS profiles always force checks on, even when a CI environment variable is inherited.
  nextConfig.extra = { ...config.extra, otaCheckEnabled: !isolatedOtaCi };
  // Android-only Settings.System bridge; iOS has no Firebase Test Lab system setting.
  plugins.push('./plugins/withQingmuTestLab');
  // iOS builds carry the Android versionCode as their build number, so one bump in app.json releases both
  // platforms with the same number.
  // Native Sign in with Apple capability is iOS-only; the Android version/build remains unchanged.
  plugins.push('expo-apple-authentication');
  nextConfig.ios = { ...config.ios, usesAppleSignIn: true, buildNumber: String(config.android?.versionCode ?? 1) };
  if (hasAndroidServices) nextConfig.android = { ...config.android, googleServicesFile: androidServices };
  if (hasIosServices) nextConfig.ios = { ...nextConfig.ios, googleServicesFile: iosServices };
  if (Object.keys(serviceOptions).length > 0) {
    plugins.push(['react-native-nitro-google-signin', serviceOptions]);
    // The library's iosUrlScheme branch skips Android Firebase wiring. Keep that wiring intact
    // and register the iOS callback separately when using an OAuth client without a Firebase plist.
    if (iosUrlScheme && !hasIosServices) plugins.push(['./plugins/withGoogleIosUrlScheme', { iosUrlScheme }]);
  } else if (iosUrlScheme) {
    plugins.push(['react-native-nitro-google-signin', { iosUrlScheme }]);
  }
  return { ...nextConfig, plugins };
};
