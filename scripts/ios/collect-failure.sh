#!/usr/bin/env bash
# scripts/ios/collect-failure.sh <udid> <flow-name> — small, readable evidence for a failed flow:
# the Maestro log tail, the app's own error lines, and the crash report's exception + crashed-thread frames.
UDID=$1; NAME=$2; OUT=${OUT:-ci-out}; DIR="$OUT/maestro"; mkdir -p "$DIR"
# Capture the actual simulator frame before slow diagnostics or another driver session changes it.
# A Maestro failure PNG can be black/blank while the later accessibility tree looks normal.
xcrun simctl io "$UDID" screenshot "$DIR/$NAME-native-screen.png" > "$DIR/$NAME-native-screen-capture.txt" 2>&1 || true
APP=$(cat "$OUT/app-path.txt")
EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")
# Ordinary pause/binding events are not errors and disappear from the generic error-only tail.
xcrun simctl spawn "$UDID" log show --last 5m --info --debug --style compact --predicate "process == \"$EXE\"" 2>/dev/null \
  | grep -Ei '\[chapter-audio\]|AVAudioSession|AVPlayer|playbackStatus|timeControlStatus' | tail -n 120 > "$DIR/$NAME-audio.txt" || true
tail -n 40 "$DIR/$NAME.log" > "$DIR/$NAME-maestro-tail.txt" 2>/dev/null || true
# The whole fatal JS error: message plus every stack frame (the filtered lines below keep only its first line).
xcrun simctl spawn "$UDID" log show --last 5m --style compact --predicate "process == \"$EXE\"" 2>/dev/null   | awk '/Unhandled JS Exception|Terminating app due to uncaught exception/ {grab=90} grab > 0 {print; grab--}' | head -n 120 > "$DIR/$NAME-js-fatal.txt" || true
xcrun simctl spawn "$UDID" log show --last 5m --style compact --predicate "process == \"$EXE\"" 2>/dev/null \
  | grep -Ei 'error|exception|fatal|terminat|crash|unhandled|invariant|not bundled|red ?box' | tail -n 60 > "$DIR/$NAME-app-log.txt" || true
# Network evidence: what ATS / URL loading said, whether the fixture backend is up, and what reached it.
xcrun simctl spawn "$UDID" log show --last 5m --style compact --predicate "process == \"$EXE\"" 2>/dev/null   | grep -Ei 'Transport Security|cleartext|NSURLError|kCFErrorDomain|Task <|nw_connection|127\.0\.0\.1|8788' | tail -n 40 > "$DIR/$NAME-network.txt" || true
{ echo "== server.log (tail)"; tail -n 30 "$OUT/server.log" 2>/dev/null; echo "== requests.log: answers with 4xx/5xx"; grep " = [45][0-9][0-9] " "$OUT/requests.log" 2>/dev/null | tail -n 20; echo "== requests.log (tail)"; tail -n 16 "$OUT/requests.log" 2>/dev/null; echo "== health now"; curl -s -o /dev/null -w '%{http_code}
' --cacert "$OUT/tls/ca.pem" https://localhost:8788/api/health; } > "$DIR/$NAME-backend.txt" 2>&1
# When the app never came up there is no app log. What Maestro itself recorded (its reason is not always on
# the console), the junit failure text, and what the system said about launching or ending the app.
grep -o '<failure[^>]*>[^<]*' "$DIR/$NAME.xml" > "$DIR/$NAME-junit.txt" 2>/dev/null || true
DEBUG=$(ls -td "$HOME"/.maestro/tests/*/ 2>/dev/null | head -1)
[ -n "$DEBUG" ] && tail -n 80 "$DEBUG/maestro.log" > "$DIR/$NAME-maestro-debug.txt" 2>/dev/null
{ echo "== launchctl"; xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -F org.qingmu.youth; echo "== system (launch, termination)";
  xcrun simctl spawn "$UDID" log show --last 5m --style compact --predicate 'eventMessage CONTAINS "org.qingmu.youth"' 2>/dev/null \
  | grep -Ei 'launch|terminat|exit|kill|jetsam|watchdog|crash|denied|fail' | tail -n 40; } > "$DIR/$NAME-system.txt" 2>&1
# The screen the flow stopped on, as the labels Maestro can match: one line per element that has any text.
maestro --device "$UDID" hierarchy --no-reinstall-driver 2>/dev/null | python3 -c '
import json, sys
def walk(node):
    a = node.get("attributes", {})
    words = [a.get(k) for k in ("accessibilityText", "text", "value", "hintText") if a.get(k)]
    if words: print(a.get("bounds", ""), " | ".join(dict.fromkeys(words)))
    for child in node.get("children", []): walk(child)
walk(json.load(sys.stdin))' > "$DIR/$NAME-screen.txt" 2>/dev/null || true
REPORT=$(ls -t "$HOME/Library/Logs/DiagnosticReports/" 2>/dev/null | grep -F "$EXE" | head -1)
if [ -n "$REPORT" ]; then
  python3 - "$HOME/Library/Logs/DiagnosticReports/$REPORT" > "$DIR/$NAME-crash.txt" <<'PY'
import json, sys
text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
header, _, body = text.partition('\n')
try:
    report = json.loads(body)
except ValueError:
    print(text[:4000]); sys.exit(0)
print('exception:', json.dumps(report.get('exception')))
print('termination:', json.dumps(report.get('termination'))[:600])
print('asi:', json.dumps(report.get('asi'))[:1500])
images = report.get('usedImages', [])
for thread in report.get('threads', []):
    if thread.get('triggered'):
        for frame in thread.get('frames', [])[:25]:
            image = images[frame.get('imageIndex', 0)].get('name', '?') if images else '?'
            print(f"  {image}  {frame.get('symbol', '?')}")
PY
fi
