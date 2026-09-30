#!/usr/bin/env bash
# scripts/ios/run-flows.sh — fixture backend + counting proxy + simulator + Maestro (one flow per call).
set -uo pipefail
OUT=${OUT:-ci-out}; mkdir -p "$OUT/maestro"; : > "$OUT/requests.log"
QINGMU_DEV_TOKEN=ci-fixture-token QINGMU_FIXTURE_ROSTER=two-member-week QINGMU_FIXTURE_DEFAULT_MEMBER=fixture:self QINGMU_DB_PATH=:memory: QINGMU_SERVER_PORT=8787 \
  npx tsx server/http.ts > "$OUT/server.log" 2>&1 &
# The app talks to the backend over HTTPS, as in production: the reader takes its Bible content host only
# from an https API base. A throwaway CA, trusted only inside this simulator, signs a localhost certificate.
bash scripts/ios/make-ci-tls.sh "$OUT/tls"
npx tsx scripts/ios/count-proxy.ts 8788 8787 "$OUT/requests.log" "$OUT/tls/leaf.pem" "$OUT/tls/leaf.key" &
python3 scripts/ios/make-tone.py "$OUT/audio/jhn13.wav" 2>/dev/null && (cd "$OUT/audio" && python3 -m http.server 8790 --bind 127.0.0.1 > /dev/null 2>&1 &) || true
for i in $(seq 1 30); do curl -sf --cacert "$OUT/tls/ca.pem" https://localhost:8788/api/health > /dev/null && break; sleep 1; done
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
for flow in .maestro/ios/*.yaml; do
  run_flow "$flow"
  case "$(basename "$flow" .yaml)" in
    # The smoke flow ends on the 讀經 tab; its accessibility tree is what the reader flows are written against.
    00-smoke) bash scripts/ios/measure-idle.sh "$UDID" home > "$OUT/maestro/measure-home.txt" 2>&1; maestro --device "$UDID" hierarchy --no-reinstall-driver > "$OUT/hierarchy-home.json" 2>/dev/null || true ;;
    10-reader-open) bash scripts/ios/measure-idle.sh "$UDID" reader ;;
    # Narration must keep playing while the app is in the background: park it behind Settings for 20 s.
    20-audio-start) xcrun simctl launch "$UDID" com.apple.Preferences > /dev/null; sleep 20; xcrun simctl launch "$UDID" org.qingmu.youth > /dev/null ;;
    30-friend-push-open) npx tsx scripts/ios/make-friend-apns.ts "$OUT/friend.apns" && xcrun simctl push "$UDID" org.qingmu.youth "$OUT/friend.apns" ;;
  esac
done
# Maestro writes takeScreenshot files under its own test output folder, not where the flow names them;
# collect every PNG the flows produced so the artifact carries them.
find . "$HOME/.maestro" -name '*.png' -newer "$OUT/.flows-start" -not -path './node_modules/*' -not -path "./$OUT/maestro/*" -exec cp {} "$OUT/maestro/" \; 2>/dev/null || true
