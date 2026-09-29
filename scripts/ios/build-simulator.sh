#!/usr/bin/env bash
# scripts/ios/build-simulator.sh — Release, simulator, unsigned. The JS bundle is embedded (no Metro).
set -euo pipefail
OUT=${OUT:-ci-out}; mkdir -p "$OUT"
WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO build > "$OUT/xcodebuild.log" 2>&1; then
  grep -E 'error:|\*\* BUILD FAILED' "$OUT/xcodebuild.log" | head -40 > "$OUT/xcodebuild-errors.txt"
  echo '| I1 編得過 | FAIL | 見 xcodebuild-errors.txt |' >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi
ls -d build/ios/Build/Products/Release-iphonesimulator/*.app | head -1 > "$OUT/app-path.txt"
echo '| I1 編得過 | PASS | |' >> "$GITHUB_STEP_SUMMARY"
