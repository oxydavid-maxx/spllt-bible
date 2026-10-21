import { setClientInfo } from './clientInfo';

/**
 * Fills in src/services/clientInfo.ts once at startup (app/_layout.tsx). The installation id is random (expo-crypto),
 * made once and kept in this phone's SecureStore; it is not a hardware, Google, Apple or advertising id. The
 * update id is the downloaded OTA update that is running, and nothing for the store build's own copy.
 *
 * Every native module is loaded when asked, so this file also loads in the Node tests.
 */
export const CLIENT_INSTALL_KEY = 'qingmu.client.installId';

export interface ClientInfoSources {
  platform: string;
  version: string | null;
  build: string | null;
  update: { isEmbeddedLaunch: boolean; updateId: string | null };
  store: { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };
  newId: () => string;
}

export async function startClientInfo(sources?: ClientInfoSources): Promise<void> {
  setClientInfo(null);
  let from: ClientInfoSources;
  try { from = sources ?? await nativeSources(); } catch { return; }
  if (from.platform !== 'android' && from.platform !== 'ios') return;
  const version = from.version?.trim();
  if (!version) return;
  let installId: string;
  try {
    const stored = await from.store.getItemAsync(CLIENT_INSTALL_KEY);
    installId = stored ?? from.newId();
    if (!stored) await from.store.setItemAsync(CLIENT_INSTALL_KEY, installId).catch(() => undefined);
  } catch {
    return; // Without a lasting id every launch would look like a new phone; say nothing instead.
  }
  setClientInfo({
    installId, platform: from.platform, version, build: from.build?.trim() || null,
    updateId: from.update.isEmbeddedLaunch ? null : from.update.updateId,
  });
}

async function nativeSources(): Promise<ClientInfoSources> {
  const [Application, Updates, SecureStore, Crypto] = await Promise.all([
    import('expo-application'), import('expo-updates'), import('expo-secure-store'), import('expo-crypto'),
  ]);
  // A named property of require, never a wildcard or import() (AGENTS.md iOS note 1).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require('react-native') as { Platform: { OS: string } };
  return {
    platform: Platform.OS, version: Application.nativeApplicationVersion, build: Application.nativeBuildVersion,
    update: { isEmbeddedLaunch: Updates.isEmbeddedLaunch, updateId: Updates.updateId },
    store: SecureStore, newId: Crypto.randomUUID,
  };
}
