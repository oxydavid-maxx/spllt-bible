// The YouVersion reader SDK's sheets import @gorhom/bottom-sheet, which needs react-native-reanimated.
// On React Native 0.85 reanimated + react-native-worklets cost this app ~155 MB of native memory and an
// idle UI-thread frame loop (docs/design/lean-reader-sheets.md), so Gorhom is served by the app's own
// sheet and reanimated / worklets resolve to a module that throws like an uninstalled package, which
// the optional `try { require(...) }` in react-native-gesture-handler already handles.
const path = require('node:path');

const NOT_BUNDLED = /^react-native-(reanimated|worklets)(\/|$)/;

function withLeanReaderSheets(config, projectRoot) {
  const upstream = config.resolver.resolveRequest;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        if (moduleName === '@gorhom/bottom-sheet') return { type: 'sourceFile', filePath: path.join(projectRoot, 'src/ui/sheet/bottomSheet.tsx') };
        if (NOT_BUNDLED.test(moduleName)) return { type: 'sourceFile', filePath: path.join(projectRoot, 'src/ui/sheet/notBundled.js') };
        return (upstream ?? context.resolveRequest)(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withLeanReaderSheets };
