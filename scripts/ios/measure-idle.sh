#!/usr/bin/env bash
# scripts/ios/measure-idle.sh <udid> <screen-name> — R1/R2 CPU, R3 footprint, R4 idle requests.
set -euo pipefail
UDID=$1; SCREEN=$2; OUT=${OUT:-ci-out}
PID=$(xcrun simctl spawn "$UDID" launchctl list | awk '/UIKitApplication:org\.qingmu\.youth/ {print $1; exit}')
sleep 15
START=$(($(date +%s) * 1000))
TOTAL=0
for i in $(seq 1 12); do CPU=$(ps -o %cpu= -p "$PID" | tr -d ' '); TOTAL=$(echo "$TOTAL + $CPU" | bc -l); sleep 5; done
END=$(($(date +%s) * 1000))
AVG=$(echo "scale=2; $TOTAL / 12" | bc -l)
FOOT=$(vmmap --summary "$PID" 2>/dev/null | awk '/Physical footprint:/ {print $3; exit}')
FOOT_MB=$(echo "$FOOT" | awk '/M$/ {sub("M",""); print; next} /G$/ {sub("G",""); print $1*1024; next} /K$/ {sub("K",""); print $1/1024}')
REQ=$(awk -v s="$START" -v e="$END" '$1>=s && $1<=e' "$OUT/requests.log" | wc -l | tr -d ' ')
echo "{\"cpuAvg\":$AVG,\"footprintMB\":${FOOT_MB:-0},\"idleRequests\":$REQ}" > "$OUT/runtime-$SCREEN.json"
