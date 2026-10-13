/**
 * Stand-in for expo-in-app-updates in the node test environment, where the native module does not
 * exist. Both calls fail, as on a phone without Play, so the update check falls through to the
 * published version file and no Play update can ever appear in a test by accident. The Play branch
 * itself is covered with injected answers in tests/services/appUpdate.test.ts.
 */
export async function checkForUpdate(): Promise<never> {
  throw new Error('expo-in-app-updates is not available in tests');
}

export async function startUpdate(): Promise<boolean> {
  throw new Error('expo-in-app-updates is not available in tests');
}
