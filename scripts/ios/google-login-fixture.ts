// Explicit synthetic values: this cloud proof checks wiring, never a real account or OAuth client.
export const googleLoginFixture = {
  webClientId: '123456789012-obviously-fake-web-client.apps.googleusercontent.com',
  iosClientId: '123456789012-obviously-fake-ios-client.apps.googleusercontent.com',
  iosUrlScheme: 'com.googleusercontent.apps.123456789012-obviously-fake-ios-client',
  iosBundleId: 'org.qingmu.youth',
  apiBaseUrl: 'https://qingmu-ci.invalid',
  youVersionAppKey: 'obviously-fake-youversion-key-no-reader-access',
} as const;
