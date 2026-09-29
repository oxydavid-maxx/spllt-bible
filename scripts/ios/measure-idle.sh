#!/usr/bin/env bash
# scripts/ios/measure-idle.sh <udid> <screen-name> — R1/R2 CPU, R3 footprint, R4 idle requests.
# No `set -e`: a tool that fails must say so in the output (captured as ci-out/maestro/measure-<screen>.txt),
# not end the script silently and leave the budget unmeasured.
set -uo pipefail
UDID=$1; SCREEN=$2; OUT=${OUT:-ci-out}
PID=$(xcrun simctl spawn "$UDID" launchctl list | awk '/UIKitApplication:org\.qingmu\.youth/ {print $1; exit}')
if [ -z "$PID" ] || [ "$PID" = "-" ]; then echo "no running app process"; exit 0; fi
echo "pid $PID"
sleep 15
START=$(($(date +%s) * 1000))
TOTAL=0
for i in $(seq 1 12); do CPU=$(ps -o %cpu= -p "$PID" | tr -d ' '); TOTAL=$(echo "$TOTAL + ${CPU:-0}" | bc -l); sleep 5; done
END=$(($(date +%s) * 1000))
AVG=$(echo "scale=2; $TOTAL / 12" | bc -l)
FOOT=$(vmmap --summary "$PID" 2>&1 | awk '/Physical footprint:/ {print $3; exit}')
if [ -z "$FOOT" ]; then
  echo "vmmap gave no footprint; trying footprint(1)"
  FOOT=$(footprint "$PID" 2>&1 | awk '/[Ff]ootprint:/ {print $2 $3; exit}')
fi
FOOT_MB=$(echo "${FOOT:-0}" | awk '/[Mm]B?$/ {gsub(/[MmB]/,""); print; next} /[Gg]B?$/ {gsub(/[GgB]/,""); print $1*1024; next} /[Kk]B?$/ {gsub(/[KkB]/,""); print $1/1024; next} {print 0}')
# Request lines only ("<ms> <METHOD> <path>"); count-proxy's "<ms> = <status>" answer lines are not requests.
REQ=$(awk -v s="$START" -v e="$END" '$1>=s && $1<=e && $2 != "="' "$OUT/requests.log" | wc -l | tr -d ' ')
echo "cpuAvg $AVG footprint $FOOT (${FOOT_MB} MB) idleRequests $REQ"
echo "{\"cpuAvg\":$AVG,\"footprintMB\":${FOOT_MB:-0},\"idleRequests\":$REQ}" > "$OUT/runtime-$SCREEN.json"
