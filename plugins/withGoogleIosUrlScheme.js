const { IOSConfig, withInfoPlist } = require('@expo/config-plugins');

// iOS-only mod: combining the library's URL-scheme option with Android Firebase makes
// that library skip its Android Gradle mods. This preserves both platform configurations.
module.exports = (config, { iosUrlScheme }) => withInfoPlist(config, (mod) => {
  if (!IOSConfig.Scheme.hasScheme(iosUrlScheme, mod.modResults)) {
    mod.modResults = IOSConfig.Scheme.appendScheme(iosUrlScheme, mod.modResults);
  }
  return mod;
});
