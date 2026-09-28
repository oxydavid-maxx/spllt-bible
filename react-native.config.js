// react-native-reanimated and react-native-worklets arrive only as peer dependencies of the YouVersion
// reader SDK. The app serves its own bottom sheet instead and never bundles them (metro.leanSheets.js),
// so their native libraries are not linked either (docs/design/lean-reader-sheets.md).
module.exports = {
  dependencies: {
    'react-native-reanimated': { platforms: { android: null, ios: null } },
    'react-native-worklets': { platforms: { android: null, ios: null } },
  },
};
