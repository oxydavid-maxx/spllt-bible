/**
 * Where this iPhone install came from (光佑 2026-10-21): only a TestFlight install may be offered a TestFlight
 * update, and an App Store install never sees a TestFlight link. No native module is added (the change ships
 * as an OTA update), so this reads what the installed modules can already see:
 *
 *   - The store receipt in the app's own container, beside Documents: StoreKit/receipt from the App Store,
 *     StoreKit/sandboxReceipt from TestFlight. An App Store receipt wins over a TestFlight one left behind.
 *   - expo-application's release type: a store-signed build (App Store or TestFlight; Apple strips the
 *     provisioning profile from both) against a simulator, development or ad-hoc build.
 *
 * A store-signed build with no receipt yet is 'store-unknown': it is offered TestFlight only while the version
 * file does not say the app is also on the App Store (updateCheck.fetchTestflightUpdateState).
 *
 * The CI simulator has neither receipt nor store signature, so a fixture build follows the launch argument
 * `qingmuInstallSource` (Maestro `launchApp: arguments`, read from NSUserDefaults through React Native's
 * Settings). A real build never reads it.
 *
 * Every native piece is imported when asked, not at load time: the Node tests and release scripts load the
 * modules that import this one.
 */
export type IosInstallSource = 'testflight' | 'app-store' | 'store-unknown' | 'other';

export interface InstallSourceProbe {
  fixture: boolean;
  forced: () => unknown;
  receipt: (name: 'receipt' | 'sandboxReceipt') => Promise<boolean>;
  releaseType: () => Promise<number>;
}

// expo-application ApplicationReleaseType.APP_STORE
const APP_STORE_RELEASE = 5;

export async function detectIosInstallSource(probe: InstallSourceProbe = nativeProbe()): Promise<IosInstallSource> {
  if (probe.fixture) {
    const forced = probe.forced();
    if (forced === 'testflight' || forced === 'app-store') return forced;
  }
  const has = async (name: 'receipt' | 'sandboxReceipt') => { try { return await probe.receipt(name); } catch { return false; } };
  if (await has('receipt')) return 'app-store';
  if (await has('sandboxReceipt')) return 'testflight';
  try { return (await probe.releaseType()) === APP_STORE_RELEASE ? 'store-unknown' : 'other'; } catch { return 'other'; }
}

function nativeProbe(): InstallSourceProbe {
  return {
    fixture: process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true',
    forced: () => {
      // Fixture builds only: the launch argument Maestro passes, through React Native's own NSUserDefaults reader.
      // A named property of require, never a wildcard or import() (AGENTS.md iOS note 1).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Settings } = require('react-native') as { Settings: { get(key: string): unknown } };
      return Settings.get('qingmuInstallSource');
    },
    receipt: async (name) => {
      const { File, Paths } = await import('expo-file-system');
      return new File(Paths.document.parentDirectory, 'StoreKit', name).exists;
    },
    releaseType: async () => {
      const Application = await import('expo-application');
      return Application.getIosApplicationReleaseTypeAsync();
    },
  };
}
