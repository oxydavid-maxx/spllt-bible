#!/usr/bin/env bash
# scripts/ios/ota-sim-run.sh — two cold starts of the store-equivalent simulator app against the real EAS Update
# service (.github/workflows/ios-ota-verify.yml). Records evidence only; `ota-verify.ts verdict` decides.
#   Cold start 1 runs the embedded JS (scripts/ios/ota-seed-entry.js) as the synthetic administrator of the local
#   fixture backend: the app's own startup check (src/ui/admin/OtaUpdates.tsx) keeps its channel and downloads in
#   the background, and the administrator's session is stored the way a real sign-in stores it.
#   Cold start 2 must run the downloaded update. Its API host name is pointed at the same local fixture backend on
#   this runner (hosts file + a certificate from this run's throwaway CA, trusted only in this simulator), so the
#   update runs signed in and nothing reaches the real backend. The flows only read (reader, account page).
# env: OUT (absolute evidence dir), APP (built .app), OTA_API_HOST (the API host name the update was exported with)
set -uo pipefail
OUT=${OUT:?}; APP=${APP:?}; API_HOST=${OTA_API_HOST:?}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BUNDLE=org.qingmu.youth
TSX="$ROOT/node_modules/.bin/tsx"
VERIFY="$HERE/ota-verify.ts"
mkdir -p "$OUT/maestro"; : > "$OUT/requests.log"; : > "$OUT/requests-api.log"; echo '{}' > "$OUT/flows.json"
RUN_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# The fixture backend of this checkout (backward compatible with older apps; synthetic administrator fixture:self).
( cd "$ROOT" && QINGMU_DEV_TOKEN=ci-fixture-token QINGMU_FIXTURE_ROSTER=two-member-week QINGMU_FIXTURE_DEFAULT_MEMBER=fixture:self \
  QINGMU_ADMIN_MEMBER_IDS=fixture:self QINGMU_DB_PATH=:memory: QINGMU_SERVER_PORT=8787 exec "$TSX" server/http.ts ) > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
bash "$HERE/make-ci-tls.sh" "$OUT/tls"
# Embedded JS (cold start 1): https://127.0.0.1:8788, as in the ios workflow.
"$TSX" "$HERE/count-proxy.ts" 8788 8787 "$OUT/requests.log" "$OUT/tls/leaf.pem" "$OUT/tls/leaf.key" &
PROXY_PID=$!
# The update under test (cold start 2): its own API host, on both loopback families, signed by the same CA.
( cd "$OUT/tls" && openssl genrsa -out api.key 2048 2>/dev/null && openssl req -new -key api.key -subj "/CN=$API_HOST" -out api.csr \
  && printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s\n' "$API_HOST" > api.ext \
  && openssl x509 -req -in api.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -sha256 -extfile api.ext -out api.pem 2>/dev/null )
# Port 443 is what the update's URL uses; sudo resets PATH, so hand the runner's node over explicitly.
sudo -E env "PATH=$PATH" "$TSX" "$VERIFY" api-proxy 443 8787 "$OUT/requests-api.log" "$OUT/tls/api.pem" "$OUT/tls/api.key" > "$OUT/api-proxy.txt" 2>&1 &
API_PROXY_PID=$!
cp /etc/hosts "$OUT/hosts.before"
printf '127.0.0.1 %s\n::1 %s\n' "$API_HOST" "$API_HOST" | sudo tee -a /etc/hosts > /dev/null
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder 2>/dev/null || true
cleanup() {
  kill "$SERVER_PID" "$PROXY_PID" 2>/dev/null; sudo pkill -f "ota-verify.ts api-proxy" 2>/dev/null
  sudo cp "$OUT/hosts.before" /etc/hosts; sudo dscacheutil -flushcache
  [ -n "${UDID:-}" ] && xcrun simctl shutdown "$UDID" > /dev/null 2>&1
}
trap cleanup EXIT
for i in $(seq 1 30); do curl -sf --cacert "$OUT/tls/ca.pem" https://127.0.0.1:8788/api/health > /dev/null && break; sleep 1; done
curl -fsS --cacert "$OUT/tls/ca.pem" https://127.0.0.1:8788/api/health > "$OUT/fixture-health.json" || echo 'fixture backend did not answer' >&2
# Trusting only this run's CA, the real backend could never complete this handshake: an answer proves the redirect.
answered=false
for family in -4 -6; do
  for i in $(seq 1 15); do curl "$family" -sf --cacert "$OUT/tls/ca.pem" "https://$API_HOST/api/health" > "$OUT/api-redirect-health$family.json" && break; sleep 1; done
done
[ -s "$OUT/api-redirect-health-4.json" ] && [ -s "$OUT/api-redirect-health-6.json" ] && answered=true
echo "{\"answered\": $answered}" > "$OUT/api-redirect.json"

record() { python3 -c "import json,sys;p='$OUT/flows.json';d=json.load(open(p));d[sys.argv[1]]=sys.argv[2];json.dump(d,open(p,'w'))" "$1" "$2"; }
# The time zone of the phones this app serves: the account page prints the update's date in local time.
cold_start() {
  xcrun simctl terminate "$UDID" "$BUNDLE" > /dev/null 2>&1; sleep 2
  SIMCTL_CHILD_TZ=Asia/Taipei xcrun simctl launch "$UDID" "$BUNDLE" > "$OUT/launch-$1.txt" 2>&1
}
run_flow() {
  local name=$1
  for attempt in 1 2; do
    if maestro --device "$UDID" test --no-reinstall-driver "$ROOT/.maestro/ios-ota/$name.yaml" --format junit --output "$OUT/maestro/$name.xml" > "$OUT/maestro/$name.log" 2>&1; then
      record "$name" "$([ $attempt = 1 ] && echo PASS || echo RERUN-PASS)"; break
    fi
    record "$name" FAIL
    # Retry only when the driver never started (no test case in the report); an assertion failure is final.
    grep -q '<testcase' "$OUT/maestro/$name.xml" 2>/dev/null && break
  done
  maestro --device "$UDID" hierarchy --no-reinstall-driver > "$OUT/hierarchy-$name.json" 2>/dev/null || rm -f "$OUT/hierarchy-$name.json"
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png" > /dev/null 2>&1 || true
}

UDID=$(xcrun simctl create qm-ota "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-4)
echo "$UDID" > "$OUT/udid.txt"
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b > /dev/null
xcrun simctl keychain "$UDID" add-root-cert "$OUT/tls/ca.pem"
xcrun simctl install "$UDID" "$APP"
# Granted once before any launch (scripts/ios/run-flows.sh): a signed-in member's reminders ask for it.
maestro --version > /dev/null 2>&1
"$HOME/.maestro/deps/applesimutils" --byId "$UDID" --bundle "$BUNDLE" --setPermissions notifications=YES
MAESTRO_DRIVER_STARTUP_TIMEOUT=600000 maestro --device "$UDID" hierarchy --no-reinstall-driver > /dev/null 2>&1 || echo "maestro driver warm-up failed"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000

# Cold start 1: the embedded update decides, as on a freshly installed phone, and downloads in the background.
cold_start 1
"$TSX" "$VERIFY" wait-download "$UDID" "$OUT" 300
"$TSX" "$VERIFY" db "$UDID" "$OUT/db-launch1.json"
"$TSX" "$VERIFY" api-host "$UDID" "$OUT" "$API_HOST"
xcrun simctl io "$UDID" screenshot "$OUT/0-embedded.png" > /dev/null 2>&1 || true
cp "$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Library/Application Support/dev.expo.modules.core.logging.expo-updates.txt" "$OUT/expo-updates-log-launch1.txt" 2>/dev/null || true

# Cold start 2: whatever expo-updates launches now is what a phone runs after its second open.
cp "$OUT/requests-api.log" "$OUT/requests-api-before.log"; : > "$OUT/requests-api.log"
cold_start 2
run_flow 1-reader-today
TZ=Asia/Taipei date +%Y-%m-%d > "$OUT/reader-day.txt"
run_flow 2-account-version
sleep 3
"$TSX" "$VERIFY" db "$UDID" "$OUT/db-launch2.json"
"$TSX" "$VERIFY" collect "$UDID" "$OUT" "$RUN_START"
