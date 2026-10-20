#!/usr/bin/env bash
# scripts/ios/run-flows.sh — fixture backend + counting proxy + simulator + Maestro (one flow per call).
set -uo pipefail
OUT=${OUT:-ci-out}; mkdir -p "$OUT/maestro"; : > "$OUT/requests.log"
QINGMU_DEV_TOKEN=ci-fixture-token QINGMU_FIXTURE_ROSTER=two-member-week QINGMU_FIXTURE_DEFAULT_MEMBER=fixture:self QINGMU_ADMIN_MEMBER_IDS=fixture:self QINGMU_DB_PATH=:memory: QINGMU_SERVER_PORT=8787 \
  npx tsx server/http.ts > "$OUT/server.log" 2>&1 &
# The app talks to the backend over HTTPS, as in production: the reader takes its Bible content host only
# from an https API base. A throwaway CA, trusted only inside this simulator, signs a loopback certificate.
bash scripts/ios/make-ci-tls.sh "$OUT/tls"
npx tsx scripts/ios/count-proxy.ts 8788 8787 "$OUT/requests.log" "$OUT/tls/leaf.pem" "$OUT/tls/leaf.key" &
for i in $(seq 1 30); do curl -sf --cacert "$OUT/tls/ca.pem" https://127.0.0.1:8788/api/health > /dev/null && break; sleep 1; done
# The proxy binds IPv4 only. Read the actual listener/SAN/HTTPS response before launching the simulator;
# localhost let CFNetwork choose a refused address and stall fixture profile requests (run 38538827467).
[ "${EXPO_PUBLIC_QINGMU_API_BASE_URL:-}" = 'https://127.0.0.1:8788' ] || { echo 'CI App origin does not match the fixture listener'; exit 1; }
lsof -nP -iTCP:8788 -sTCP:LISTEN > "$OUT/fixture-listener.txt"
grep -q '127.0.0.1:8788' "$OUT/fixture-listener.txt" || { echo 'IPv4 fixture listener not observed'; exit 1; }
openssl x509 -in "$OUT/tls/leaf.pem" -noout -ext subjectAltName > "$OUT/fixture-san.txt"
grep -q 'IP Address:127.0.0.1' "$OUT/fixture-san.txt" || { echo 'Fixture certificate does not cover the client IP'; exit 1; }
curl -fsS --cacert "$OUT/tls/ca.pem" https://127.0.0.1:8788/api/health > "$OUT/fixture-health.json" || exit 1
node - "$OUT" <<'JS'
const fs = require('node:fs'), crypto = require('node:crypto'), cp = require('node:child_process');
const out = process.argv[2];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const names = Object.keys(process.env).filter(k => k.startsWith('EXPO_PUBLIC_')).sort();
const vars = Object.fromEntries(names.map(k => [k, process.env[k]]));
const receipt = {
  sourceCommit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: cp.execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  observedAt: new Date().toISOString(), nodeVersion: process.version,
  packageLockSha256: sha(fs.readFileSync('package-lock.json')),
  podsLockSha256: sha(fs.readFileSync('ios/Podfile.lock')),
  environmentNames: names, environmentInputDigest: sha(JSON.stringify(vars)),
  fixtureClientOrigin: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL,
  observedListenerSha256: sha(fs.readFileSync(out + '/fixture-listener.txt')),
  observedSanSha256: sha(fs.readFileSync(out + '/fixture-san.txt')),
  observedHealthSha256: sha(fs.readFileSync(out + '/fixture-health.json')),
};
fs.writeFileSync(out + '/fixture-transport.json', JSON.stringify(receipt, null, 2));
JS
UDID=$(xcrun simctl create qm-ci "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-4)
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b
xcrun simctl keychain "$UDID" add-root-cert "$OUT/tls/ca.pem"
xcrun simctl install "$UDID" "$(cat "$OUT/app-path.txt")"
# The app asks for notifications at sign-in when reading reminders are on. Grant it here, once, before the
# Maestro driver starts; the flows then launch without clearState (a reinstall would drop the grant).
# Maestro ships a pinned applesimutils and unpacks it to ~/.maestro/deps on every start (maestro-cli App.kt,
# Dependencies.install), so no third-party Homebrew tap is needed. With Maestro granting per launch instead
# (clearState reinstalls the app), some runs still showed the system prompt and lost the driver.
maestro --version > /dev/null 2>&1
"$HOME/.maestro/deps/applesimutils" --byId "$UDID" --bundle org.qingmu.youth --setPermissions notifications=YES
# Start the Maestro driver once, with a long window, and keep it for every flow (--no-reinstall-driver; by
# default each call reinstalls it). On a slow runner the first boot took 6 min and the driver then missed
# two 180 s windows; later starts are quick.
MAESTRO_DRIVER_STARTUP_TIMEOUT=600000 maestro --device "$UDID" hierarchy --no-reinstall-driver > /dev/null 2>&1 || echo "maestro driver warm-up failed"
echo "$UDID" > "$OUT/udid.txt"
# PROOF BRANCH ONLY: keep UIKit and touch-routing debug lines in the simulator log.
for sub in com.apple.UIKit com.apple.backboard com.apple.SpringBoard com.apple.FrontBoard; do xcrun simctl spawn "$UDID" log config --mode 'level:debug,persist:debug' --subsystem $sub > /dev/null 2>&1 || echo "log config $sub failed"; done
export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000
echo '{}' > "$OUT/flows.json"
: > "$OUT/.flows-start"
record() { python3 -c "import json,sys;p='$OUT/flows.json';d=json.load(open(p));d[sys.argv[1]]=sys.argv[2];json.dump(d,open(p,'w'))" "$1" "$2"; }
run_flow() {
  local flow=$1 name; name=$(basename "$flow" .yaml)
  if [ -n "${REQUIRES_KEY_PATTERN:-}" ] && [[ "$name" =~ $REQUIRES_KEY_PATTERN ]] && [ -z "${EXPO_PUBLIC_YOUVERSION_APP_KEY:-}" ]; then record "$name" SKIP; return; fi
  for attempt in 1 2; do
    maestro --device "$UDID" test --no-reinstall-driver "$flow" --format junit --output "$OUT/maestro/$name.xml" > "$OUT/maestro/$name.log" 2>&1 && { record "$name" "$([ $attempt = 1 ] && echo PASS || echo RERUN-PASS)"; return; }
    # Retry only when the driver never started (no test case in the report); an assertion failure is final.
    grep -q '<testcase' "$OUT/maestro/$name.xml" 2>/dev/null && break
  done
  record "$name" FAIL
  bash scripts/ios/collect-failure.sh "$UDID" "$name"
}
# PROOF BRANCH ONLY: keep every flow-21 Maestro debug log, pass or fail, to line up with CI_DIAG app lines.
# PROOF BRANCH ONLY: eight more 20 -> 20 s background -> 21 cycles right after 21 (flow 45 later deletes the account).
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$(cat "$OUT/app-path.txt")/Info.plist")
cycles() {
  mkdir -p "$OUT/cycles"
  for i in 2 3 4 5 6 7 8 9; do
    cp .maestro/ios/20-audio-start.yaml "$OUT/cycles/20-audio-start-c$i.yaml"
    cp .maestro/ios/21-audio-after-background.yaml "$OUT/cycles/21-audio-after-background-c$i.yaml"
    run_flow "$OUT/cycles/20-audio-start-c$i.yaml"
    xcrun simctl launch "$UDID" com.apple.Preferences > /dev/null; sleep 20; xcrun simctl launch "$UDID" org.qingmu.youth > /dev/null
    run_flow "$OUT/cycles/21-audio-after-background-c$i.yaml"
    keep_debug "21-audio-after-background-c$i"
  done
}
keep_debug() {
  local d; d=$(ls -td "$HOME"/.maestro/tests/*/ 2>/dev/null | head -1); [ -n "$d" ] && tail -n 120 "$d/maestro.log" > "$OUT/maestro/$1-maestro-debug-all.txt" 2>/dev/null
  # Every process: who cancels a touch (UIKit gesture gates, backboardd, SpringBoard), not just the app's own lines.
  xcrun simctl spawn "$UDID" log show --last 150s --style compact --info --debug 2>/dev/null | grep -Ei 'cancel|gesture|gate|touch|HIDEvent|defer|breadcrumb|resign|deactivat|CI_DIAG' | grep -v 'Replying to query' | tail -n 1500 > "$OUT/maestro/$1-sys.txt" || true
}
for flow in .maestro/ios/*.yaml; do
  run_flow "$flow"
  case "$(basename "$flow" .yaml)" in 21-*) keep_debug 21-audio-after-background; cycles ;; esac
  case "$(basename "$flow" .yaml)" in
    # The smoke flow ends on the 讀經 tab; its accessibility tree is what the reader flows are written against.
    00-smoke) bash scripts/ios/measure-idle.sh "$UDID" home > "$OUT/maestro/measure-home.txt" 2>&1; maestro --device "$UDID" hierarchy --no-reinstall-driver > "$OUT/hierarchy-home.json" 2>/dev/null || true ;;
    10-reader-open) bash scripts/ios/measure-idle.sh "$UDID" reader ;;
    # Narration must keep playing while the app is in the background: park it behind Settings for 20 s.
    20-audio-start) xcrun simctl launch "$UDID" com.apple.Preferences > /dev/null; sleep 20; xcrun simctl launch "$UDID" org.qingmu.youth > /dev/null ;;
    45-account-deletion) maestro --device "$UDID" hierarchy --no-reinstall-driver > "$OUT/maestro/45-account-screen.txt" 2>/dev/null || true ;;
    46-apple-login) maestro --device "$UDID" hierarchy --no-reinstall-driver > "$OUT/maestro/46-apple-authorization-screen.txt" 2>/dev/null || true; xcrun simctl io "$UDID" screenshot "$OUT/maestro/46-apple-native.png" ;;
    30-friend-push-open) npx tsx scripts/ios/make-friend-apns.ts "$OUT/friend.apns" && xcrun simctl push "$UDID" org.qingmu.youth "$OUT/friend.apns" ;;
  esac
done
# Maestro writes takeScreenshot files under its own test output folder, not where the flow names them;
# collect every PNG the flows produced so the artifact carries them.
find . "$HOME/.maestro" -name '*.png' -newer "$OUT/.flows-start" -not -path './node_modules/*' -not -path "./$OUT/maestro/*" -exec cp {} "$OUT/maestro/" \; 2>/dev/null || true

xcrun simctl spawn "$UDID" log show --last 120m --style compact --predicate "process == \"$EXE\"" 2>/dev/null | grep -F 'CI_DIAG' > "$OUT/maestro/ci-diag-log.txt" || true
