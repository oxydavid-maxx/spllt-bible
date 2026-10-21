// scripts/ios/ota-seed-entry.js — CI only (.github/workflows/ios-ota-verify.yml). Copied into the store build's
// checkout and used as the embedded bundle's entry (ENTRY_FILE) of the simulator app; it never ships anywhere.
// The update under test only runs signed in (src/ui/AppStack.tsx puts every screen behind sign-in), so before the
// app starts this stores the synthetic fixture administrator's session exactly as a real sign-in does
// (persistAuthSession). Cold start 2 then restores it, and the update talks to the local fixture backend that
// scripts/ios/ota-sim-run.sh puts under the API host name. No real account, no request to the real backend.
require('expo-router/entry');
const { persistAuthSession } = require('./src/services/authSession');

const token = process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN;
if (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' && token) {
  persistAuthSession({ memberId: 'fixture:self', sessionToken: token }, 7 * 24 * 3600).catch(() => undefined);
}
