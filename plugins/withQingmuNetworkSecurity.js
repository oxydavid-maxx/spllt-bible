const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

// Android's networkSecurityConfig overrides usesCleartextTraffic in the debug manifest.
// Keep the release/main policy unchanged; only local Metro and isolated QA APIs need HTTP.
const DEBUG_NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;

module.exports = function withQingmuNetworkSecurity(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application = mod.modResults.manifest.application ?? [{}];
    mod.modResults.manifest.application[0].$ = {
      ...(mod.modResults.manifest.application[0].$ ?? {}),
      'android:networkSecurityConfig': '@xml/network_security_config',
    };
    return mod;
  });
  return withDangerousMod(config, ['android', (mod) => {
    const resources = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'network_security_config.xml'), NETWORK_SECURITY_XML, 'utf8');
    const debugResources = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'res', 'xml');
    fs.mkdirSync(debugResources, { recursive: true });
    fs.writeFileSync(path.join(debugResources, 'network_security_config.xml'), DEBUG_NETWORK_SECURITY_XML, 'utf8');
    return mod;
  }]);
};
