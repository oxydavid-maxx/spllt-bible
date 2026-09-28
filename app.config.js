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
  if (hasAndroidServices) nextConfig.android = { ...config.android, googleServicesFile: androidServices };
  if (hasIosServices) nextConfig.ios = { ...config.ios, googleServicesFile: iosServices };
  if (Object.keys(serviceOptions).length > 0) {
    plugins.push(['react-native-nitro-google-signin', serviceOptions]);
  } else if (iosUrlScheme) {
    plugins.push(['react-native-nitro-google-signin', { iosUrlScheme }]);
  }
  return { ...nextConfig, plugins };
};
