#!/usr/bin/env bash
# scripts/ios/measure-footprint.sh <udid> <screen-name> — R3 memory of the page on screen, read like measure-idle.sh
# (vmmap's physical footprint, footprint(1) as a fallback), after 10 s to settle. No CPU window: the idle budgets are
# measured on 首頁 and 讀經器 by measure-idle.sh. A footprint that cannot be read is written as 0, which summary.ts FAILs.
set -uo pipefail
UDID=$1; SCREEN=$2; OUT=${OUT:-ci-out}
PID=$(xcrun simctl spawn "$UDID" launchctl list | awk '/UIKitApplication:org\.qingmu\.youth/ {print $1; exit}')
if [ -z "$PID" ] || [ "$PID" = "-" ]; then echo "no running app process"; echo '{"footprintMB":0}' > "$OUT/runtime-$SCREEN.json"; exit 0; fi
echo "pid $PID"
sleep 10
FOOT=$(vmmap --summary "$PID" 2>&1 | awk '/Physical footprint:/ {print $3; exit}')
if [ -z "$FOOT" ]; then
  echo "vmmap gave no footprint; trying footprint(1)"
  FOOT=$(footprint "$PID" 2>&1 | awk '/[Ff]ootprint:/ {print $2 $3; exit}')
fi
FOOT_MB=$(echo "${FOOT:-0}" | awk '/[Mm]B?$/ {gsub(/[MmB]/,""); print; next} /[Gg]B?$/ {gsub(/[GgB]/,""); print $1*1024; next} /[Kk]B?$/ {gsub(/[KkB]/,""); print $1/1024; next} {print 0}')
echo "footprint $FOOT (${FOOT_MB} MB)"
echo "{\"footprintMB\":${FOOT_MB:-0}}" > "$OUT/runtime-$SCREEN.json"
