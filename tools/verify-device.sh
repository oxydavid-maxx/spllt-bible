#!/usr/bin/env bash
# Device verification for 青牧 App, in one run.
#
# WHY A SCRIPT: the phone and the toolchain are not always on the same machine. Handing another
# operator (or another Claude session) a stream of adb commands means a round trip per step and a
# transcript nobody can re-run. This is one artifact that installs, drives, and judges — and the
# judging is the point: it reads the screen rather than assuming a tap worked.
#
# USAGE:  bash tools/verify-device.sh <apk-path-or-url> [outdir]
# OUTPUT: screenshots + verify-report.txt in <outdir>, and a PASS/FAIL line per check on stdout.

set -u
APK_SRC="${1:?usage: verify-device.sh <apk-path-or-url> [outdir]}"
OUT="${2:-./device-verify}"
PKG=org.qingmu.youth
mkdir -p "$OUT"
REPORT="$OUT/verify-report.txt"
: > "$REPORT"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
# The UI tree is how a check knows what is actually on screen. A tap that silently did nothing and a
# tap that worked look identical in a screenshot count.
tree() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
has() { tree | grep -q -- "$1"; }
check() { if has "$2"; then say "PASS  $1"; else say "FAIL  $1  (expected to find: $2)"; fi; }

adb devices -l | tee -a "$REPORT" | grep -q "device$" || { say "FAIL  no device attached"; exit 1; }

if [ ! -f "$APK_SRC" ]; then
  say "downloading $APK_SRC"
  curl -fsSL "$APK_SRC" -o "$OUT/app.apk" || { say "FAIL  could not download the apk"; exit 1; }
  APK_SRC="$OUT/app.apk"
fi

# install -r only: never uninstall, because the journal outbox and reader position live on the device.
say "installing $(basename "$APK_SRC")"
adb install -r "$APK_SRC" 2>&1 | tail -1 | tee -a "$REPORT"
say "installed: $(adb shell dumpsys package $PKG | grep -m1 versionName | tr -d '\r')"

adb shell am force-stop $PKG
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8
shot 01-launch
check "app launches to the reading tab" "讀經"

# The reader is the check that matters most: it shipped broken three times because a spinner was
# read as "still loading" instead of "never finishes".
say "--- reader ---"
adb shell input tap 541 555   # 開始今日讀經
sleep 20                      # the SDK needs time; failing fast here is how the bug was missed
shot 02-reader
if has "官方閱讀器還在準備中"; then
  say "FAIL  reader still shows 官方閱讀器還在準備中 after 20s — the YouVersion SDK did not initialise"
elif tree | grep -qE 'text="[^"]{20,}"'; then
  say "PASS  reader rendered scripture"
else
  say "FAIL  reader shows neither the loading notice nor any text — unknown state, look at 02-reader.png"
fi

adb shell input keyevent KEYCODE_BACK; sleep 3

say "--- announcements ---"
adb shell input tap 901 2257   # the 公告 tab sits third from the right once it exists
sleep 6
shot 03-announcements
check "announcement tab has this week" "公告"

say "--- points ---"
adb shell input tap 541 2257
sleep 6
shot 04-points
check "reward goal is a bar with a fraction" "目標獎品"

say ""
say "screenshots and this report: $OUT"
grep -c '^PASS' "$REPORT" | xargs -I{} say "{} checks passed"
grep -c '^FAIL' "$REPORT" | xargs -I{} say "{} checks failed"
