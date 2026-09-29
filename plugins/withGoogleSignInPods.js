// Why not the library alone: react-native-nitro-google-signin's pod is linked into every iOS build, but its
// config plugin adds the modular headers AppCheckCore needs only together with a Google client config
// (plugin/withNitroGoogleSignIn.js, withNitroGoogleSignInRoot). An iOS build without that config — the CI
// fixture, or any build before the iOS client exists — then fails in pod install ("The Swift pod
// `AppCheckCore` depends upon `GoogleUtilities` and `RecaptchaInterop`, which do not define modules").
// Same tag and same lines as the library, through the same mergeContents, so when both run the Podfile
// still gets exactly one block. iOS only: Android's native project is untouched.
const { withPodfile } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const GOOGLE_SIGN_IN_PODS_TAG = 'react-native-nitro-google-signin-google-pods';
const GOOGLE_SIGN_IN_PODS = `  pod 'AppCheckCore', :modular_headers => true
  pod 'GoogleUtilities', :modular_headers => true
  pod 'RecaptchaInterop', :modular_headers => true`;

function addGoogleSignInPods(src) {
  return mergeContents({ tag: GOOGLE_SIGN_IN_PODS_TAG, src, newSrc: GOOGLE_SIGN_IN_PODS, anchor: /use_native_modules/, offset: 0, comment: '#' });
}

const withGoogleSignInPods = (config) => withPodfile(config, (podfile) => {
  const result = addGoogleSignInPods(podfile.modResults.contents);
  if (result.didMerge || result.didClear) podfile.modResults.contents = result.contents;
  return podfile;
});

module.exports = withGoogleSignInPods;
module.exports.addGoogleSignInPods = addGoogleSignInPods;
module.exports.GOOGLE_SIGN_IN_PODS_TAG = GOOGLE_SIGN_IN_PODS_TAG;
module.exports.GOOGLE_SIGN_IN_PODS = GOOGLE_SIGN_IN_PODS;
