/**
 * Stand-in for expo-application in the node test environment.
 *
 * The real module reaches expo-modules-core's native registry at import time, which does not exist
 * outside a device. The update banner reads one field from it — the installed versionCode — so a
 * component test that renders the reading tab drags the whole native registry in behind it and the
 * file fails to load before a single assertion runs.
 *
 * Deliberately null rather than a plausible number. The banner treats an unreadable version as "say
 * nothing", so a double that invented a version could make an update notice appear in a test and be
 * read as the feature working. The comparison itself is covered without any of this, against real
 * integers, in tests/updateCheck.test.ts.
 */
export const nativeBuildVersion: string | null = null;
export const nativeApplicationVersion: string | null = null;
export const applicationId: string | null = null;
export const applicationName: string | null = null;
