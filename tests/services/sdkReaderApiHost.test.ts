import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the installed production SDK bridge, not a mock Reader or hookOverride.
const path = 'node_modules/@youversion/platform-react-native-expo-ui/build/lib/web-yv-provider.js';
function render(props: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8').replace(/^import .*;\r?$/gm, '').replace('export function YouVersionProvider', 'function YouVersionProvider');
  return runInNewContext(source + '\nYouVersionProvider(props)', {
    props,
    ensureDomLocalStorage() {}, ensureDomContentCache() {},
    BaseYouVersionProvider: 'ActualWebProvider',
    YouVersionPlatformConfiguration: { apiHost: 'api.luminexhealthbiohack.com' },
    mergeSdkHeaders: (headers: unknown) => headers,
    createElement: (_component: unknown, received: unknown) => received,
  });
}
describe('SDK native-to-DOM content host propagation', () => {
  it('uses the host installed by applySDKConfig rather than reverting the DOM provider to api.youversion.com', () => {
    expect(render({ appKey: 'synthetic-client-key', permittedVersionIds: [46,40,111,406,114] })).toMatchObject({
      apiHost: 'api.luminexhealthbiohack.com', permittedVersionIds: [46,40,111,406,114],
    });
  });
  it('keeps an explicit provider host authoritative and never forwards account bearer data', () => {
    const result = render({ appKey: 'synthetic-client-key', apiHost: 'another-owned-host.test' });
    expect(result.apiHost).toBe('another-owned-host.test');
    expect(result.accessToken).toBeUndefined();
  });
});
