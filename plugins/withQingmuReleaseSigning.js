const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Inserts the owner-controlled release signing config during the Android DSL
 * phase. This keeps AGP from rejecting a late signing-config mutation while
 * leaving credentials in a private properties file outside the repository.
 */
module.exports = function withQingmuReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker = '// qingmu-owner-release-signing-v1';
    let contents = mod.modResults.contents;
    if (contents.includes(marker)) return mod;

    const releaseConfig = [
      '        release {',
      "            if (project.hasProperty('qingmuRelease') && project.property('qingmuRelease') == 'true') {",
      "                def propsPath = System.getenv('QINGMU_RELEASE_SIGNING_PROPERTIES')",
      "                if (!propsPath) throw new GradleException('QINGMU_RELEASE_SIGNING_PROPERTIES_REQUIRED')",
      '                def propsFile = new File(propsPath)',
      '                if (!propsFile.exists()) throw new GradleException("QINGMU_RELEASE_SIGNING_PROPERTIES_MISSING: ${propsPath}")',
      '                def p = new Properties()',
      '                propsFile.withInputStream { p.load(it) }',
      "                def keyStore = new File(p.getProperty('QINGMU_RELEASE_STORE_FILE'))",
      '                if (!keyStore.exists()) throw new GradleException("QINGMU_RELEASE_KEYSTORE_MISSING: ${keyStore}")',
      '                storeFile keyStore',
      "                storePassword p.getProperty('QINGMU_RELEASE_STORE_PASSWORD')",
      "                keyAlias p.getProperty('QINGMU_RELEASE_KEY_ALIAS')",
      "                keyPassword p.getProperty('QINGMU_RELEASE_KEY_PASSWORD')",
      '            }',
      '        }',
    ].join('\n');

    const signingStart = contents.indexOf('signingConfigs {');
    const buildTypesStart = contents.indexOf('buildTypes {', signingStart);
    if (signingStart >= 0 && buildTypesStart > signingStart) {
      const signingSection = contents.slice(signingStart, buildTypesStart);
      if (!/\n\s*release\s*\{/.test(signingSection)) {
        const signingClose = contents.lastIndexOf('\n    }', buildTypesStart);
        if (signingClose <= signingStart) throw new Error('QINGMU_SIGNING_CONFIG_BOUNDARY_NOT_FOUND');
        contents = `${contents.slice(0, signingClose)}\n${releaseConfig}${contents.slice(signingClose)}`;
      }
      const updatedBuildTypesStart = contents.indexOf('buildTypes {', signingStart);
      const releaseStart = contents.indexOf('\n        release {', updatedBuildTypesStart);
      const debugSigning = contents.indexOf('signingConfig signingConfigs.debug', releaseStart);
      if (releaseStart >= 0 && debugSigning > releaseStart && !contents.slice(releaseStart, debugSigning).includes('qingmuRelease')) {
        const selector = [
          "if (project.hasProperty('qingmuRelease') && project.property('qingmuRelease') == 'true') {",
          '                signingConfig signingConfigs.release',
          '            } else {',
          '                signingConfig signingConfigs.debug',
          '            }',
        ].join('\n            ');
        contents = `${contents.slice(0, debugSigning)}${selector}${contents.slice(debugSigning + 'signingConfig signingConfigs.debug'.length)}`;
      }
    }
    mod.modResults.contents = `${contents}\n${marker}\n`;
    return mod;
  });
};
