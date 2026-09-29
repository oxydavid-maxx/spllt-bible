# 竹科聖經 iOS 同等移植 Phase 1（M0–M5，不需 Apple 帳號）Implementation Plan

> **Execution:** The current native owner implements the complete release candidate, owns every FOCUS loop, and produces the exact candidate for RC. The plan does not mandate delegation or a separate reviewer. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 同一份程式碼在 iOS 模擬器上做到跟 Android 0.5.19 同等的功能；兩個平台的每個 PR 都在雲端自動驗證；App 執行時不能變成資源黑洞；Android 完全不退步。

**Architecture：** 延續 Expo continuous native generation：`ios/`、`android/` 都由 prebuild 產生、不進 git，平台差異只放在 `app.json`、`app.config.js`、config plugin 與 `Platform.OS` 分支。GitHub Actions 開三個 job：`unit`（vitest）、`android`（prebuild 加測試 APK 守門）、`ios`（模擬器建置、守門、Maestro、執行資源量測）。推播沿用同一套 API：同一個函式產生通知內容，Android 走 FCM、iPhone 走 APNs（用 `@parse/node-apn`，不自己寫 HTTP/2）。

**Tech Stack：** Expo SDK 56、React Native 0.85.3、expo-audio / expo-notifications / expo-sharing（已在用）、vitest 3、GitHub Actions（`ubuntu-latest`、`macos-26`）、Xcode 26.4.1、iOS Simulator 26.4（iPhone 17）、Maestro CLI 2.10.0、`@parse/node-apn` 8.1.0（伺服器端）。

**上層計畫：** `docs/superpowers/plans/2026-09-29-ios-parity.md`（功能對照、驗證設計、CI 設計、決定事項）。本檔只寫「怎麼做」。

## Global Constraints

- 基準：main `b2fc416`（0.5.19，`android.versionCode` 40）。Expo SDK 維持 56，不升級。
- `ios/`、`android/` 不進 git。每一個 `Platform.OS` 分支都要附一行註解說明為什麼兩個平台不同。
- **兩個平台一起改**：新行為預設兩個平台都跑；只有作業系統本身不同的地方才分平台。
- **執行資源（光佑 2026-09-29）**：App 執行時不能是資源黑洞，要通過 §「執行資源預算」的 R1–R5，每個 iOS PR 都自動量。
- **不重造輪子**：只用 §「沿用的現成元件」列出的元件。要新增自製模組，必須在該檔開頭寫一行「為什麼不用現成的」。
- **Android 不退步**：vitest 維持 1859 通過、2 略過、0 失敗；APK 守門（ABI、≤ 90 MB、無 source map、Firebase、背景播放 manifest、無 reanimated/worklets）照舊；發版腳本不改；不碰 `C:\w\q`。
- 兩個平台都不得帶回 react-native-reanimated / react-native-worklets。
- **Secrets**：Phase 1 唯一可能用到的是 `YOUVERSION_APP_KEY`，要等光佑對 Q1 明確說「同意」才新增。不印、不寫進 repo、log、網頁。用 secret 建出來的 `.app` 不上傳 artifact。
- **lockfile 只在 Task 9 改**（加 `@parse/node-apn`）。合併前先告知光佑：下次 Android 打包會重裝依賴。
- 合併、部署、發布、新增 secret 都要光佑逐項同意。`gh pr merge` 被擋時照實說明，不繞路。
- **驗證輸出只准**：PASS/FAIL 表加一行 JSON 摘要。不貼 log，只下載失敗那幾張截圖。
- **CI 釘版**：`macos-26`、`/Applications/Xcode_26.4.1.app`、`iPhone 17` / `iOS 26.4`、Maestro `2.10.0`、Node 24、JDK 17（Android）、NDK `27.1.12297006`（AGP 自動安裝）。
- **測試建置固定**：`EXPO_PUBLIC_QINGMU_TEST_DATE=2026-09-02`（當天第一章是約 13，也是 QA 音檔唯一允許的章），`EXPO_PUBLIC_QINGMU_FIXTURE=true`，`EXPO_PUBLIC_QINGMU_DEV_TOKEN=ci-fixture-token`。

## 執行資源預算（每個 iOS PR 自動量；模擬器數字只當相對守門）

| ID | 量什麼 | 怎麼量 | PASS |
|---|---|---|---|
| R1 | 讀經分頁閒置 CPU | 啟動、停在讀經分頁 15 秒後，每 5 秒 `ps -o %cpu= -p <pid>` 取樣共 12 次，取平均 | ≤ 3.0%（單核） |
| R2 | 讀經器打開、沒在播放時的閒置 CPU | 同上，畫面停在讀經器 | ≤ 5.0% |
| R3 | 記憶體 | `vmmap --summary <pid>` 的 Physical footprint | ≤ 350 MB，而且 ≤ main 基準 × 1.10 |
| R4 | 閒置時的網路請求 | 本機計數轉送器記錄 60 秒閒置期間 App 打後端的次數 | = 0 |
| R5 | App 大小 | `.app` 目錄總大小，不得含 `.map` | ≤ main 基準 × 1.05 |

- 預算依據：Android 實機的閒置主執行緒是 4.6–5.6%，YouVersion 約 0%；0.5.19 PSS 是 319 MB。
- 模擬器跑在 Mac 上，數字不等於手機，所以 R3、R5 用「跟 main 比」當主要守門。
- 已知嫌疑：讀經器有播放來源時，`src/ui/ChapterAudioControls.tsx:503` 每 0.5 秒輪詢一次進度（即使暫停）。R2 超標時的修法是改用 expo-audio 內建的播放狀態事件，兩個平台一起改，另開 PR。
- Android 的執行資源沿用既有的實機腳本（`C:\dev\machine\tmp\qm-0519\perf_check`、`diag_idle`），在 RC 跑一次；手機只用 `adb install -r`。

## 沿用的現成元件（不重造輪子）

| 需要 | 用現成的 | 不做的事 |
|---|---|---|
| 雲端建置與驗證 | GitHub Actions（public repo 免費） | 自架建置機 |
| 自動點畫面 | Maestro CLI | 自寫點擊腳本 |
| 背景朗讀、鎖定畫面卡 | expo-audio（已在用；iOS 原生已實作 Now Playing） | 自寫 AVAudioSession 原生碼 |
| 推播 token、顯示、點擊 | expo-notifications（已在用） | — |
| 伺服器送 Apple 推播 | `@parse/node-apn`（npm 每週約 45 萬次下載，2026-04 仍有更新） | 自寫 HTTP/2 加 JWT |
| iOS 更新 | App Store 自動更新 | 自製 iOS 更新提示 |
| 日記匯出 | expo-sharing 系統分享面板（已在用） | 自製 iOS 資料夾選擇器 |
| iOS 建置守門 | 重用 `src/config/apkBudget.ts` 的 `checkLeanReaderSheets` | 另寫一套 reanimated 偵測 |
| 測試用請求計數 | `scripts/ios/count-proxy.ts`（約 30 行 node:http，只給 CI 用） | 為了測試去改正式伺服器的程式 |

## File Structure

| 檔案 | 責任 | Task |
|---|---|---|
| `.github/workflows/unit.yml` | 每個 PR 跑 vitest 全套，輸出摘要 | 1 |
| `scripts/ci/vitest-summary.ts` | 把 vitest JSON 變成 PASS/FAIL 表和一行 JSON | 1 |
| `.github/workflows/android.yml` | prebuild、native diff、測試 APK、APK 守門、大小比對 | 2 |
| `scripts/ci/android-apk-check.ts` | 重用 apkBudget 的檢查（Firebase 那項略過），輸出摘要 JSON | 2 |
| `scripts/ci/compare-baseline.ts` | 跟 main 最近一次成功的摘要比大小／記憶體 | 2、4 |
| `.github/workflows/ios.yml` | iOS 模擬器建置、守門、流程、資源量測 | 3、4 |
| `src/config/iosBuildBudget.ts` | 純函式：Info.plist 檢查、.app 內容檢查、Podfile.lock 檢查 | 3 |
| `tests/config/iosBuildBudget.test.ts` | 上面純函式的單元測試 | 3 |
| `scripts/ios/build-simulator.sh` | xcodebuild（Release、模擬器、不簽章） | 3 |
| `scripts/ios/guards.ts` | 對建好的 .app 跑 I2–I4 | 3 |
| `scripts/ios/run-flows.sh` | 起假資料後端與計數轉送器、開模擬器、跑 Maestro、量 R1–R4 | 4 |
| `scripts/ios/count-proxy.ts` | 轉送到假資料後端並記錄每個請求的時間 | 4 |
| `scripts/ios/measure-idle.sh` | 取樣 CPU 與記憶體，輸出 `runtime-<畫面>.json` | 4 |
| `scripts/ios/summary.ts` | 彙整守門、流程、資源結果成摘要 | 4 |
| `.maestro/ios/*.yaml` | 每個功能一個 flow | 4、7、8、9、10 |
| `.github/pull_request_template.md` | 兩平台勾選項 | 5 |
| `app.json` | `ios` 區塊、iOS 權限說明字串 | 6 |
| `tests/config/iosConfig.test.ts` | iOS 設定與版本號同步測試 | 6 |
| `src/ui/sheet/bottomSheet.tsx` | 關著的面板對輔助功能隱藏（兩平台） | 7 |
| `tests/ui/leanBottomSheet.test.ts`、`tests/ui/nativeSheetLifecycle.test.ts` | 加上 iOS 分支 | 7 |
| `scripts/ios/make-tone.py` | 產生 60 秒測試音檔（WAV） | 8 |
| `src/services/reminderDevice.ts`、`src/services/apiClient.ts` | iOS token 登記為 `IOS` | 9 |
| `src/services/friendPush.ts` | iOS 不註冊背景任務（alert 推播由系統顯示） | 9 |
| `src/services/reminderScheduler.ts` | 待發讀經提醒最多 60 則（兩平台） | 9 |
| `src/domain/friendNotificationText.ts` | 好友通知文字，App 和伺服器共用 | 9 |
| `server/apnsSender.ts` | 用 `@parse/node-apn` 送 alert | 9 |
| `server/friendPush.ts`、`server/remoteConfiguration.ts`、`server/routes.ts`、`server/http.ts`、`server/reminderPreferences.ts` | 依 token 平台分流 | 9 |
| `src/services/updateCheck.ts` | 非 Android 不查版本、不顯示更新 | 10 |
| `app/(tabs)/journal.tsx` | iOS 隱藏「同時存到我選的資料夾」（mock 核准後才做） | 10 |

**PR 切法**：Task 1–5＝M0（`feat/ios-ci`），Task 6＝M1，Task 7＝M2，Task 8＝M3，Task 9＝M4，Task 10＝M5。每個 PR 單獨可合併。

---

### Task 1：`unit` workflow（M0）

**Files:**
- Create: `.github/workflows/unit.yml`、`scripts/ci/vitest-summary.ts`

**Interfaces:**
- Produces: artifact `unit-summary`（`ci-out/vitest-summary.json`，格式 `{"passed":n,"skipped":n,"failed":n,"failedTests":["檔名 > 測試名", ...]}`）。

- [ ] **Step 1：寫 summary 腳本**

```ts
// scripts/ci/vitest-summary.ts
// usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json>
// Prints a PASS/FAIL table for the job summary and exits 1 when any test failed.
import { readFileSync, writeFileSync } from 'node:fs';

type Assertion = { fullName: string; status: string };
type Report = { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests?: number; testResults: Array<{ name: string; assertionResults: Assertion[] }> };

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json>'); process.exit(2); }
const report = JSON.parse(readFileSync(input, 'utf8')) as Report;
const failedTests = report.testResults.flatMap((file) => file.assertionResults
  .filter((test) => test.status === 'failed')
  .map((test) => `${file.name.replace(/^.*?tests[\\/]/, 'tests/')} > ${test.fullName}`));
const summary = { passed: report.numPassedTests, skipped: report.numPendingTests + (report.numTodoTests ?? 0), failed: report.numFailedTests, failedTests };
writeFileSync(output, JSON.stringify(summary));
console.log(`| 項目 | 結果 |\n|---|---|\n| vitest | ${summary.failed === 0 ? 'PASS' : 'FAIL'} |\n| 通過／略過／失敗 | ${summary.passed}／${summary.skipped}／${summary.failed} |`);
for (const name of failedTests.slice(0, 20)) console.log(`- FAIL ${name}`);
console.log(`\n\`${JSON.stringify({ unit: summary.failed === 0 ? 'PASS' : 'FAIL', passed: summary.passed, skipped: summary.skipped, failed: summary.failed })}\``);
process.exit(summary.failed === 0 ? 0 : 1);
```

- [ ] **Step 2：寫 workflow**

```yaml
# .github/workflows/unit.yml
name: unit
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: unit-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  vitest:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: vitest
        run: |
          mkdir -p ci-out
          npx vitest run --reporter=json --outputFile=ci-out/vitest.json > ci-out/vitest.log 2>&1 || true
          npx tsx scripts/ci/vitest-summary.ts ci-out/vitest.json ci-out/vitest-summary.json >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: unit-summary
          path: ci-out/vitest-summary.json
          retention-days: 7
```

- [ ] **Step 3：FOCUS**
  - **RED**：推上分支前，本機把 summary 腳本餵一份含 1 個失敗的假 JSON（`{"numPassedTests":1,"numFailedTests":1,"numPendingTests":0,"testResults":[{"name":"tests/x.test.ts","assertionResults":[{"fullName":"x fails","status":"failed"}]}]}`）→ 要 exit 1，並列出 `tests/x.test.ts > x fails`。
  - **GREEN**：PR 上 `unit` job 的摘要是 `1859／2／0`。結果不同就列差異清單；屬於雲端環境差異的（例如只在 Windows 存在的路徑）標註出來，不改產品程式。
- [ ] **Step 4：Commit** `ci: run vitest on every pull request`

### Task 2：`android` workflow（M0）

**Files:**
- Create: `.github/workflows/android.yml`、`scripts/ci/android-apk-check.ts`、`scripts/ci/compare-baseline.ts`

**Interfaces:**
- Consumes: `checkApkBudget`、`checkBackgroundAudioManifest`、`checkLeanReaderSheets`、`readZipEntries`、`readZipEntry`（`src/config/apkBudget.ts`，不改）。
- Produces: artifact `android-summary`（`ci-out/android-summary.json`：`{"apkBytes":n,"abis":"arm64-v8a,armeabi-v7a","problems":[],"nativeDiffFiles":n}`）。main 上保存 30 天，當 PR 的比較基準。

- [ ] **Step 1：APK 檢查腳本（重用既有檢查，只略過需要私有檔的 Firebase）**

```ts
// scripts/ci/android-apk-check.ts
// usage: tsx scripts/ci/android-apk-check.ts <apk> <abis> <maxMB> <out-json> <nativeDiffFiles>
// The release check (scripts/check-apk-budget.ts) also needs the private google-services.json, which never
// leaves 光佑's machine; every other release check runs here unchanged.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { checkApkBudget, checkBackgroundAudioManifest, checkLeanReaderSheets, readZipEntries, readZipEntry } from '../../src/config/apkBudget';

const [apk, abis, maxMb, output, nativeDiff] = process.argv.slice(2);
if (!apk || !abis || !maxMb || !output) { console.error('usage: tsx scripts/ci/android-apk-check.ts <apk> <abis> <maxMB> <out-json> <nativeDiffFiles>'); process.exit(2); }
const zip = readFileSync(apk);
const apkBytes = statSync(apk).size;
const problems = [
  ...checkApkBudget(readZipEntries(zip), apkBytes, { abis: abis.split(','), maxBytes: Number(maxMb) * 1e6 }),
  ...checkBackgroundAudioManifest(readZipEntry(zip, 'AndroidManifest.xml')),
  ...checkLeanReaderSheets(readZipEntries(zip), readZipEntry(zip, 'assets/index.android.bundle')),
];
const summary = { apkBytes, abis, problems, nativeDiffFiles: Number(nativeDiff ?? 0) };
writeFileSync(output, JSON.stringify(summary));
const row = (name: string, ok: boolean, note = '') => `| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${note} |`;
console.log(['| 守門 | 結果 | 備註 |', '|---|---|---|',
  row('ABI／大小／source map／背景播放／無 reanimated', problems.length === 0, `${(apkBytes / 1e6).toFixed(1)} MB`),
  '| Firebase 設定 | 略過 | 私有檔不上雲端；正式候選在本機驗 |',
  `| Android 原生設定 diff（vs main） | 資訊 | ${summary.nativeDiffFiles} 個檔案 |`].join('\n'));
for (const problem of problems) console.log(`- FAIL ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 2：基準比對腳本（Android、iOS 共用）**

```ts
// scripts/ci/compare-baseline.ts
// usage: tsx scripts/ci/compare-baseline.ts <current-json> <baseline-json|missing> <field> <maxRatio> <label>
// A PR may not grow a size or memory figure past maxRatio × main's last successful run.
import { existsSync, readFileSync } from 'node:fs';

const [currentPath, baselinePath, field, maxRatio, label] = process.argv.slice(2);
const current = JSON.parse(readFileSync(currentPath, 'utf8')) as Record<string, number>;
if (!baselinePath || !existsSync(baselinePath)) { console.log(`| ${label} | 略過 | main 還沒有基準 |`); process.exit(0); }
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
const ratio = current[field] / baseline[field];
const ok = Number.isFinite(ratio) && ratio <= Number(maxRatio);
console.log(`| ${label} | ${ok ? 'PASS' : 'FAIL'} | ${current[field]} vs main ${baseline[field]}（×${ratio.toFixed(3)}，上限 ×${maxRatio}） |`);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3：workflow**

```yaml
# .github/workflows/android.yml
name: android
on:
  pull_request:
    paths: ['app/**', 'src/**', 'plugins/**', 'patches/**', 'package.json', 'package-lock.json', 'app.json', 'app.config.js', 'metro*.js', 'react-native.config.js', 'babel.config.js', 'scripts/ci/**', '.github/workflows/android.yml']
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: android-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  actions: read
jobs:
  apk:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - run: npm ci
      - name: prebuild (branch)
        run: npx expo prebuild --platform android --no-install --clean
      - name: native diff vs main
        if: github.event_name == 'pull_request'
        run: |
          git worktree add ../base origin/main
          if git diff --quiet origin/main -- package-lock.json patches; then ln -s "$PWD/node_modules" ../base/node_modules; else (cd ../base && npm ci); fi
          (cd ../base && npx expo prebuild --platform android --no-install --clean)
          mkdir -p ci-out
          diff -r ../base/android/app/src/main android/app/src/main > ci-out/native-diff.txt || true
          for f in app/build.gradle build.gradle gradle.properties settings.gradle; do diff ../base/android/$f android/$f >> ci-out/native-diff.txt || true; done
          grep -c '^diff\|^[<>]' ci-out/native-diff.txt > ci-out/native-diff-count.txt || echo 0 > ci-out/native-diff-count.txt
      - uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
            /usr/local/lib/android/sdk/ndk/27.1.12297006
          key: gradle-${{ runner.os }}-${{ hashFiles('package-lock.json', 'patches/**', 'app.json', 'app.config.js', 'plugins/**') }}
          restore-keys: gradle-${{ runner.os }}-
      - name: assembleRelease (debug-signed; no -PqingmuRelease, so no private keystore)
        working-directory: android
        run: ./gradlew assembleRelease --no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" -PreactNativeArchitectures=arm64-v8a,armeabi-v7a -Pexpo.useLegacyPackaging=true
      - name: APK guards
        run: |
          mkdir -p ci-out
          npx tsx scripts/ci/android-apk-check.ts android/app/build/outputs/apk/release/app-release.apk arm64-v8a,armeabi-v7a 90 ci-out/android-summary.json "$(cat ci-out/native-diff-count.txt 2>/dev/null || echo 0)" >> "$GITHUB_STEP_SUMMARY"
      - name: size vs main
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          RUN=$(gh run list --workflow android.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          if [ -n "$RUN" ]; then gh run download "$RUN" --name android-summary --dir ci-out/base || true; fi
          npx tsx scripts/ci/compare-baseline.ts ci-out/android-summary.json ci-out/base/android-summary.json apkBytes 1.002 "APK 大小" >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: android-summary
          path: |
            ci-out/android-summary.json
            ci-out/native-diff.txt
          retention-days: ${{ github.ref == 'refs/heads/main' && 30 || 7 }}
```

- 大小上限 ×1.002：62.5 MB 的 0.2% 約 0.12 MB，接近上層計畫的「差 ≤ 0.1 MB」。

- [ ] **Step 4：FOCUS**
  - **RED**：第一次 PR 跑，還沒有 main 基準，所以大小比對會「略過」。另外在 `workflow_dispatch` 跑一次時，傳 `maxMB=10`（改 step 參數做一次性驗證，不 commit），確認守門會 FAIL。
  - **GREEN**：APK 守門 PASS；`native diff` 是 0（M0 沒動共用檔）；APK 大小跟 0.5.19 正式版（62,466,099 bytes）差距在 ±2 MB 內（差異來自 debug 簽章與沒有 Firebase 設定），並記錄下來。
- [ ] **Step 5：Commit** `ci: build and guard an Android test APK on every pull request`

### Task 3：`ios` workflow：建置與守門（M0）

**Files:**
- Create: `src/config/iosBuildBudget.ts`、`tests/config/iosBuildBudget.test.ts`、`scripts/ios/build-simulator.sh`、`scripts/ios/guards.ts`、`.github/workflows/ios.yml`

**Interfaces:**
- Produces:
  - `checkIosInfoPlist(plist: Record<string, unknown>, expected: IosPlistExpectation): string[]`
  - `checkIosAppFiles(files: Array<{ path: string; bytes: number }>): { appBytes: number; problems: string[] }`
  - `checkIosPods(podfileLock: string): string[]`
  - `interface IosPlistExpectation { bundleId: string; buildNumber?: string; requireChineseStrings: string[] }`
  - artifact `ios-summary`（`ci-out/ios-summary.json`：`{"appBytes":n,"footprintMB":n,"guards":{...},"flows":{...},"runtime":{...}}`）

- [ ] **Step 1：RED 測試**

```ts
// tests/config/iosBuildBudget.test.ts
import { describe, expect, it } from 'vitest';
import { checkIosAppFiles, checkIosInfoPlist, checkIosPods } from '../../src/config/iosBuildBudget';

describe('iOS build guards', () => {
  const good = { CFBundleIdentifier: 'org.qingmu.youth', CFBundleVersion: '40', UIBackgroundModes: ['audio'], NSCameraUsageDescription: '允許竹科聖經掃描好友 QR 碼' };
  it('accepts the expected bundle, background audio and Chinese purpose strings', () => {
    expect(checkIosInfoPlist(good, { bundleId: 'org.qingmu.youth', buildNumber: '40', requireChineseStrings: ['NSCameraUsageDescription'] })).toEqual([]);
  });
  it('flags a missing audio background mode, a wrong bundle, a stale build number and an English purpose string', () => {
    const problems = checkIosInfoPlist({ ...good, CFBundleIdentifier: 'x', CFBundleVersion: '1', UIBackgroundModes: [], NSCameraUsageDescription: 'Allow camera' },
      { bundleId: 'org.qingmu.youth', buildNumber: '40', requireChineseStrings: ['NSCameraUsageDescription', 'NSFaceIDUsageDescription'] });
    expect(problems).toEqual([
      'CFBundleIdentifier is x, expected org.qingmu.youth',
      'CFBundleVersion is 1, expected 40 (ios.buildNumber must equal android.versionCode)',
      'UIBackgroundModes lacks audio, so chapter narration stops when the app leaves the screen',
      'NSCameraUsageDescription is not written in Chinese',
      'NSFaceIDUsageDescription is missing',
    ]);
  });
  it('rejects shipped source maps and reports the app size', () => {
    expect(checkIosAppFiles([{ path: 'main.jsbundle', bytes: 10 }, { path: 'www.bundle/a.js.map', bytes: 5 }]))
      .toEqual({ appBytes: 15, problems: ['1 source map file(s) shipped, e.g. www.bundle/a.js.map'] });
  });
  it('finds reanimated / worklets pods but not Expo\'s own ExpoModulesWorklets', () => {
    expect(checkIosPods('PODS:\n  - ExpoModulesWorklets (56.0.0)\n  - RNReanimated (4.3.1):\n  - RNWorklets (0.8.3)\n')).toEqual([
      'pod RNReanimated is linked; reanimated / worklets must stay out (react-native.config.js)',
      'pod RNWorklets is linked; reanimated / worklets must stay out (react-native.config.js)',
    ]);
    expect(checkIosPods('PODS:\n  - ExpoModulesWorklets (56.0.0)\n')).toEqual([]);
  });
});
```

執行 `npx vitest run tests/config/iosBuildBudget.test.ts` → FAIL（模組不存在）。

- [ ] **Step 2：實作（純函式，才能在 Windows 本機測）**

```ts
// src/config/iosBuildBudget.ts
/**
 * iOS counterparts of the APK checks in apkBudget.ts, as pure functions so vitest can run them
 * anywhere; scripts/ios/guards.ts feeds them the built .app on the macOS runner.
 */
export interface IosPlistExpectation { bundleId: string; buildNumber?: string; requireChineseStrings: string[] }

const CJK = /[\u3400-\u9fff]/;

export function checkIosInfoPlist(plist: Record<string, unknown>, expected: IosPlistExpectation): string[] {
  const problems: string[] = [];
  if (plist.CFBundleIdentifier !== expected.bundleId) problems.push(`CFBundleIdentifier is ${String(plist.CFBundleIdentifier)}, expected ${expected.bundleId}`);
  if (expected.buildNumber !== undefined && plist.CFBundleVersion !== expected.buildNumber) {
    problems.push(`CFBundleVersion is ${String(plist.CFBundleVersion)}, expected ${expected.buildNumber} (ios.buildNumber must equal android.versionCode)`);
  }
  const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
  if (!modes.includes('audio')) problems.push('UIBackgroundModes lacks audio, so chapter narration stops when the app leaves the screen');
  for (const key of expected.requireChineseStrings) {
    const value = plist[key];
    if (typeof value !== 'string') problems.push(`${key} is missing`);
    else if (!CJK.test(value)) problems.push(`${key} is not written in Chinese`);
  }
  return problems;
}

export function checkIosAppFiles(files: Array<{ path: string; bytes: number }>): { appBytes: number; problems: string[] } {
  const maps = files.filter((file) => file.path.endsWith('.map'));
  return {
    appBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    problems: maps.length > 0 ? [`${maps.length} source map file(s) shipped, e.g. ${maps[0].path}`] : [],
  };
}

export function checkIosPods(podfileLock: string): string[] {
  return ['RNReanimated', 'RNWorklets']
    .filter((pod) => new RegExp(`^  - ${pod}[ (:]`, 'm').test(podfileLock))
    .map((pod) => `pod ${pod} is linked; reanimated / worklets must stay out (react-native.config.js)`);
}
```

執行同一個測試 → PASS。

- [ ] **Step 3：建置腳本**

```bash
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
```

- [ ] **Step 4：守門腳本**

```ts
// scripts/ios/guards.ts — I2 (no reanimated/worklets), I3 (Info.plist), I4 (.app contents). macOS only.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkLeanReaderSheets } from '../../src/config/apkBudget';
import { checkIosAppFiles, checkIosInfoPlist, checkIosPods } from '../../src/config/iosBuildBudget';

const out = process.env.OUT ?? 'ci-out';
const app = readFileSync(join(out, 'app-path.txt'), 'utf8').trim();
const appJson = JSON.parse(readFileSync('app.json', 'utf8')) as { expo: { android: { versionCode: number }; ios: { bundleIdentifier: string; buildNumber?: string } } };
const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { encoding: 'utf8' })) as Record<string, unknown>;
const walk = (dir: string): Array<{ path: string; bytes: number }> => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [{ path: relative(app, full), bytes: statSync(full).size }];
});
const files = checkIosAppFiles(walk(app));
const executable = join(app, String(plist.CFBundleExecutable));
const symbols = execFileSync('nm', ['-U', executable], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const nativeClasses = symbols.split('\n').filter((line) => /OBJC_CLASS_\$_(ReanimatedModule|REANodesManager|WorkletsModule)$/.test(line)).length;
const guards = {
  I2: [...checkIosPods(readFileSync('ios/Podfile.lock', 'utf8')),
    ...(nativeClasses > 0 ? [`${nativeClasses} reanimated / worklets native classes linked`] : []),
    ...checkLeanReaderSheets([], readFileSync(join(app, 'main.jsbundle')))],
  I3: checkIosInfoPlist(plist, {
    bundleId: appJson.expo.ios.bundleIdentifier,
    buildNumber: appJson.expo.ios.buildNumber,
    requireChineseStrings: (process.env.IOS_REQUIRED_CHINESE_STRINGS ?? 'NSCameraUsageDescription').split(',').filter(Boolean),
  }),
  I4: files.problems,
};
writeFileSync(join(out, 'guards.json'), JSON.stringify({ appBytes: files.appBytes, guards }));
const rows = Object.entries(guards).map(([id, problems]) => `| ${id} | ${problems.length === 0 ? 'PASS' : 'FAIL'} | ${problems.join('；')} |`);
console.log([...rows, `| .app 大小 | 資訊 | ${(files.appBytes / 1e6).toFixed(1)} MB |`].join('\n'));
process.exit(Object.values(guards).every((problems) => problems.length === 0) ? 0 : 1);
```

- [ ] **Step 5：workflow（建置部分；Task 4 接著加模擬器步驟）**

```yaml
# .github/workflows/ios.yml
name: ios
on:
  pull_request:
    paths: ['app/**', 'src/**', 'plugins/**', 'patches/**', 'package.json', 'package-lock.json', 'app.json', 'app.config.js', 'metro*.js', 'react-native.config.js', 'babel.config.js', 'server/**', '.maestro/**', 'scripts/ios/**', 'scripts/ci/**', '.github/workflows/ios.yml']
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: ios-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  actions: read
jobs:
  simulator:
    runs-on: macos-26
    timeout-minutes: 120
    env:
      OUT: ci-out
      EXPO_NO_TELEMETRY: '1'
      EXPO_PUBLIC_QINGMU_FIXTURE: 'true'
      EXPO_PUBLIC_QINGMU_DEV_TOKEN: ci-fixture-token
      EXPO_PUBLIC_QINGMU_API_BASE_URL: http://127.0.0.1:8788
      EXPO_PUBLIC_QINGMU_TEST_DATE: '2026-09-02'
      EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'true'
      EXPO_PUBLIC_QINGMU_QA_AUDIO_URI: http://127.0.0.1:8790/jhn13.wav
      # Empty until 光佑 approves Q1; the reader flows then report 略過（無 key）.
      EXPO_PUBLIC_YOUVERSION_APP_KEY: ${{ secrets.YOUVERSION_APP_KEY }}
      IOS_REQUIRED_CHINESE_STRINGS: NSCameraUsageDescription
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: sudo xcode-select -s /Applications/Xcode_26.4.1.app
      - run: npm ci
      - run: npx expo prebuild --platform ios --no-install --clean
      - uses: actions/cache@v4
        with:
          path: ios/Pods
          key: pods-${{ hashFiles('package-lock.json', 'patches/**', 'app.json', 'app.config.js') }}
      - run: cd ios && pod install
      - run: echo '| 守門 | 結果 | 備註 |' >> "$GITHUB_STEP_SUMMARY" && echo '|---|---|---|' >> "$GITHUB_STEP_SUMMARY"
      - run: bash scripts/ios/build-simulator.sh
      - run: npx tsx scripts/ios/guards.ts >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ios-summary
          path: |
            ci-out/*.json
            ci-out/xcodebuild-errors.txt
            ci-out/maestro/**/*.png
          retention-days: ${{ github.ref == 'refs/heads/main' && 30 || 7 }}
```

- [ ] **Step 6：FOCUS**
  - **RED**：本機 vitest 先紅（Step 1）。
  - **GREEN**：本機 vitest 綠；PR 上 I1–I4 全 PASS，記錄 `.app` 大小基準。
  - 如果 I1 失敗，只讀 `xcodebuild-errors.txt`（≤ 40 行），照 systematic-debugging 先找根因再修。
- [ ] **Step 7：Commit** `ci: build the iOS app for the simulator and guard it`

### Task 4：`ios` workflow：模擬器、Maestro、執行資源（M0）

**Files:**
- Create: `scripts/ios/count-proxy.ts`、`scripts/ios/run-flows.sh`、`scripts/ios/measure-idle.sh`、`scripts/ios/summary.ts`、`.maestro/ios/00-smoke.yaml`
- Modify: `.github/workflows/ios.yml`（在 guards 之後加步驟）

**Interfaces:**
- Consumes: `ci-out/app-path.txt`、`ci-out/guards.json`（Task 3）
- Produces: `ci-out/flows.json`（`{"<flow>":"PASS"|"FAIL"|"RERUN-PASS"|"SKIP"}`）、`ci-out/runtime-<screen>.json`（`{"cpuAvg":n,"footprintMB":n,"idleRequests":n}`）、`ci-out/ios-summary.json`

- [ ] **Step 1：請求計數轉送器**

```ts
// scripts/ios/count-proxy.ts — CI only. Why not a library: a pass-through with a request log is
// thirty lines of node:http, and changing the production server to log requests for a test is worse.
// usage: tsx scripts/ios/count-proxy.ts <listenPort> <targetPort> <log-file>
import { appendFileSync } from 'node:fs';
import { createServer, request } from 'node:http';

const [listen, target, log] = process.argv.slice(2);
createServer((incoming, outgoing) => {
  appendFileSync(log, `${Date.now()} ${incoming.method} ${incoming.url}\n`);
  const upstream = request({ host: '127.0.0.1', port: Number(target), path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
  incoming.pipe(upstream);
}).listen(Number(listen), '127.0.0.1');
```

- [ ] **Step 2：閒置量測**

```bash
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
```

- [ ] **Step 3：Maestro smoke flow**

```yaml
# .maestro/ios/00-smoke.yaml
appId: org.qingmu.youth
---
- launchApp:
    clearState: true
    permissions:
      notifications: allow
- extendedWaitUntil:
    visible: "積分"
    timeout: 90000
- assertVisible: "公告"
- assertVisible: "日記"
- tapOn: "積分"
- extendedWaitUntil:
    visible: "測試成員甲"
    timeout: 30000
- takeScreenshot: ci-out/maestro/00-smoke
- tapOn: "讀經"
```

- 「測試成員甲」來自假資料後端（`QINGMU_FIXTURE_ROSTER=two-member-week`），用來證明模擬器真的連上了後端。
- 如果積分頁不顯示成員名，就用 `maestro hierarchy` 找出積分頁上一段確定來自後端的文字，換掉這一行。

- [ ] **Step 4：流程腳本（起後端、開模擬器、一次跑一個 flow、量資源）**

```bash
#!/usr/bin/env bash
# scripts/ios/run-flows.sh — fixture backend + counting proxy + simulator + Maestro (one flow per call).
set -uo pipefail
OUT=${OUT:-ci-out}; mkdir -p "$OUT/maestro"; : > "$OUT/requests.log"
QINGMU_DEV_TOKEN=ci-fixture-token QINGMU_FIXTURE_ROSTER=two-member-week QINGMU_DB_PATH=:memory: QINGMU_SERVER_PORT=8787 \
  npx tsx server/http.ts > "$OUT/server.log" 2>&1 &
npx tsx scripts/ios/count-proxy.ts 8788 8787 "$OUT/requests.log" &
python3 scripts/ios/make-tone.py "$OUT/audio/jhn13.wav" 2>/dev/null && (cd "$OUT/audio" && python3 -m http.server 8790 --bind 127.0.0.1 > /dev/null 2>&1 &) || true
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8788/api/health > /dev/null && break; sleep 1; done
UDID=$(xcrun simctl create qm-ci "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-4)
xcrun simctl boot "$UDID"; xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$(cat "$OUT/app-path.txt")"
echo "$UDID" > "$OUT/udid.txt"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000
echo '{}' > "$OUT/flows.json"
record() { python3 -c "import json,sys;p='$OUT/flows.json';d=json.load(open(p));d[sys.argv[1]]=sys.argv[2];json.dump(d,open(p,'w'))" "$1" "$2"; }
run_flow() {
  local flow=$1 name; name=$(basename "$flow" .yaml)
  if [ -n "${REQUIRES_KEY_PATTERN:-}" ] && [[ "$name" =~ $REQUIRES_KEY_PATTERN ]] && [ -z "${EXPO_PUBLIC_YOUVERSION_APP_KEY:-}" ]; then record "$name" SKIP; return; fi
  for attempt in 1 2; do
    maestro --device "$UDID" test "$flow" --format junit --output "$OUT/maestro/$name.xml" > "$OUT/maestro/$name.log" 2>&1 && { record "$name" "$([ $attempt = 1 ] && echo PASS || echo RERUN-PASS)"; return; }
    # Retry only when the driver never started (no test case in the report); an assertion failure is final.
    grep -q '<testcase' "$OUT/maestro/$name.xml" 2>/dev/null && break
  done
  record "$name" FAIL
}
for flow in .maestro/ios/*.yaml; do
  run_flow "$flow"
  case "$(basename "$flow" .yaml)" in
    00-smoke) bash scripts/ios/measure-idle.sh "$UDID" home ;;
    10-reader-open) bash scripts/ios/measure-idle.sh "$UDID" reader ;;
  esac
done
```

- `REQUIRES_KEY_PATTERN='^1[0-9]-reader'` 寫在 workflow env：讀經 flow 需要 YouVersion key，沒有 key 時標 SKIP。

- [ ] **Step 5：彙整摘要**

```ts
// scripts/ios/summary.ts — one PASS/FAIL table and one JSON line; exit 1 on any FAIL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.OUT ?? 'ci-out';
const read = <T>(name: string, fallback: T): T => existsSync(join(out, name)) ? JSON.parse(readFileSync(join(out, name), 'utf8')) as T : fallback;
const guards = read('guards.json', { appBytes: 0, guards: {} as Record<string, string[]> });
const flows = read('flows.json', {} as Record<string, string>);
const home = read('runtime-home.json', null as null | { cpuAvg: number; footprintMB: number; idleRequests: number });
const reader = read('runtime-reader.json', null as null | { cpuAvg: number; footprintMB: number; idleRequests: number });
const rows: Array<[string, boolean | null, string]> = [];
for (const [name, result] of Object.entries(flows)) rows.push([`flow ${name}`, result === 'SKIP' ? null : result !== 'FAIL', result]);
if (home) {
  rows.push(['R1 讀經分頁閒置 CPU ≤ 3.0%', home.cpuAvg <= 3.0, `${home.cpuAvg}%`]);
  rows.push(['R3 記憶體 ≤ 350 MB', home.footprintMB <= 350, `${home.footprintMB} MB`]);
  rows.push(['R4 閒置請求 = 0', home.idleRequests === 0, String(home.idleRequests)]);
}
if (reader) rows.push(['R2 讀經器閒置 CPU ≤ 5.0%', reader.cpuAvg <= 5.0, `${reader.cpuAvg}%`]);
console.log(rows.map(([name, ok, note]) => `| ${name} | ${ok === null ? '略過' : ok ? 'PASS' : 'FAIL'} | ${note} |`).join('\n'));
const failed = rows.filter(([, ok]) => ok === false).map(([name]) => name);
const summary = { appBytes: guards.appBytes, footprintMB: home?.footprintMB ?? null, guards: guards.guards, flows, runtime: { home, reader }, failed };
writeFileSync(join(out, 'ios-summary.json'), JSON.stringify(summary));
console.log(`\n\`${JSON.stringify({ ios: failed.length === 0 ? 'PASS' : 'FAIL', failed, appMB: +(guards.appBytes / 1e6).toFixed(1), footprintMB: home?.footprintMB ?? null })}\``);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 6：workflow 加步驟（接在 guards 後面）**

```yaml
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - name: install Maestro 2.10.0
        run: |
          curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION=2.10.0 bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"
      - name: flows and runtime budgets
        env:
          REQUIRES_KEY_PATTERN: '^1[0-9]-reader'
        run: bash scripts/ios/run-flows.sh
      - name: summary
        if: always()
        run: npx tsx scripts/ios/summary.ts >> "$GITHUB_STEP_SUMMARY"
      - name: size and memory vs main
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          RUN=$(gh run list --workflow ios.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          if [ -n "$RUN" ]; then gh run download "$RUN" --name ios-summary --dir ci-out/base || true; fi
          npx tsx scripts/ci/compare-baseline.ts ci-out/ios-summary.json ci-out/base/ios-summary.json appBytes 1.05 "R5 .app 大小" >> "$GITHUB_STEP_SUMMARY"
          npx tsx scripts/ci/compare-baseline.ts ci-out/ios-summary.json ci-out/base/ios-summary.json footprintMB 1.10 "R3 記憶體 vs main" >> "$GITHUB_STEP_SUMMARY"
```

- Task 8 的 `scripts/ios/make-tone.py` 還沒出現前，`run-flows.sh` 的音檔那行會無聲略過（`|| true`），不影響 M0。

- [ ] **Step 7：FOCUS**
  - **RED**：用 `workflow_dispatch` 在 smoke flow 裡暫時加一行 `assertVisible: "不存在的字"`（不 commit）→ 摘要要顯示 `flow 00-smoke | FAIL`，並且只有這一張失敗截圖。
  - **GREEN**：smoke PASS；R1、R3、R4 有數字而且 PASS。
  - 第一次跑時如果 R4 > 0 或 R1 超標，那是**發現**，不是調門檻：先照 systematic-debugging 找出是哪個請求或哪個計時器，再決定修法。
  - ATS 若擋了 http 連 127.0.0.1（症狀：smoke 卡在沒有後端資料），在 Task 6 用 `app.config.js` 只對測試建置加 `NSAllowsLocalNetworking`。
- [ ] **Step 8：Commit** `ci: run the iOS app in the simulator with Maestro and runtime budgets`

### Task 5：PR 模板與追蹤 issue（M0）

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1：模板**

```markdown
## 改了什麼

## 兩個平台
- [ ] Android 與 iOS 走同一條程式路徑；如果有 `Platform.OS` 分支，每一處都寫了原因
- [ ] `unit`、`android`、`ios` 三個 workflow 都綠
- [ ] 動到 `app.json`／`app.config.js`／`package.json`／lockfile：Android 原生設定 diff 已看過（android workflow 摘要）
- [ ] 執行資源 R1–R5 沒有變差（ios workflow 摘要）
```

- [ ] **Step 2：追蹤 issue**：`gh issue create --title "iOS 同等移植" --body-file <本機暫存檔>`。內文放 M0–M8 勾選清單，連到上層計畫；不寫任何成員資料。
- [ ] **Step 3：Commit** `chore: pull request checklist for both platforms`
- [ ] **Step 4：M0 PR**：推 `feat/ios-ci`，開 **draft** PR（`Part of #<issue>`）。三個 workflow 都綠之後改成 ready，**合併等光佑同意**。

### Task 6：iOS 設定落地（M1）

**Files:**
- Modify: `app.json`（`ios` 區塊、四個 plugin 的 iOS 選項）、`.github/workflows/ios.yml`（`IOS_REQUIRED_CHINESE_STRINGS`）
- Create: `tests/config/iosConfig.test.ts`

**Interfaces:**
- Produces：`app.json` 的 `expo.ios.buildNumber`（字串，永遠等於 `expo.android.versionCode`）。

- [ ] **Step 1：RED 測試**

```ts
// tests/config/iosConfig.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expo = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const pluginOptions = (name: string) => (expo.plugins as unknown[]).find((plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === name)?.[1] ?? {};
const CJK = /[\u3400-\u9fff]/;

describe('iOS app config', () => {
  it('keeps the iOS build number in lockstep with the Android versionCode', () => {
    expect(expo.ios.buildNumber).toBe(String(expo.android.versionCode));
  });
  it('is an iPhone app that declares no non-exempt encryption', () => {
    expect(expo.ios.supportsTablet).toBe(false);
    expect(expo.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });
  it('writes every iOS purpose string in Chinese instead of the plugins\' English defaults', () => {
    expect(pluginOptions('expo-camera').cameraPermission).toMatch(CJK);
    expect(pluginOptions('expo-camera').microphonePermission).toMatch(CJK);
    expect(pluginOptions('expo-audio').microphonePermission).toMatch(CJK);
    expect(pluginOptions('expo-local-authentication').faceIDPermission).toMatch(CJK);
    expect(pluginOptions('expo-secure-store').faceIDPermission).toBe(pluginOptions('expo-local-authentication').faceIDPermission);
  });
});
```

`npx vitest run tests/config/iosConfig.test.ts` → FAIL（沒有 `ios.buildNumber` 等）。

- [ ] **Step 2：改 `app.json`**
  - `"ios"` 改成：
    ```json
    "ios": {
      "bundleIdentifier": "org.qingmu.youth",
      "buildNumber": "40",
      "supportsTablet": false,
      "infoPlist": { "ITSAppUsesNonExemptEncryption": false }
    }
    ```
  - `expo-camera` 選項加 `"microphonePermission": "竹科聖經不會錄音；這是相機元件要求的系統說明"`。
  - `expo-audio` 選項加同一句 `"microphonePermission"`。
  - `"expo-local-authentication"` 改成 `["expo-local-authentication", { "faceIDPermission": "允許竹科聖經用 Face ID 解鎖管理功能" }]`。
  - `"expo-secure-store"` 改成 `["expo-secure-store", { "faceIDPermission": "允許竹科聖經用 Face ID 解鎖管理功能" }]`。
  - 為什麼麥克風說明要留著、不設成 `false`：兩個套件的原生碼都連結了錄音 API，拿掉說明字串，上傳 App Store 時可能被判定缺少說明（ITMS-90683，**未驗證**）；誠實的中文說明風險最低。
- [ ] **Step 3：`ios.yml` 的 env** 改成 `IOS_REQUIRED_CHINESE_STRINGS: NSCameraUsageDescription,NSMicrophoneUsageDescription,NSFaceIDUsageDescription`。
- [ ] **Step 4：FOCUS**
  - **GREEN**：本機測試 PASS；CI 的 I3 PASS（這時 `CFBundleVersion` 也要是 40）。
  - Android workflow 的「原生設定 diff」必須是 0：這些選項都只作用在 iOS。
- [ ] **Step 5：Commit** `feat(ios): app config, Chinese purpose strings, build number in lockstep`；開 M1 PR。
- 不做的事（原因）：
  - Google iOS 登入設定延到 Phase 2（要先在光佑的 GCP/Firebase 建 iOS client）。
  - `aps-environment` 不必設：Expo 文件說 archive 時 Xcode 會切成 production。
  - `NavigationBar.setHidden` 在 iOS 只會印警告；只有 smoke 真的出錯才處理。

### Task 7：讀經器與面板的 iOS 分支（M2）

**Files:**
- Modify: `src/ui/sheet/bottomSheet.tsx`（面板與遮罩在關著時對輔助功能隱藏）
- Test: `tests/ui/leanBottomSheet.test.ts`、`tests/ui/nativeSheetLifecycle.test.ts`
- Create: `.maestro/ios/10-reader-open.yaml`、`.maestro/ios/11-reader-sheets.yaml`、`.maestro/ios/12-reader-verse.yaml`

**Interfaces:**
- 不改 `BottomSheet` 的 props；關著時一律輸出 `accessibilityElementsHidden={true}`、`importantForAccessibility="no-hide-descendants"`。

- [ ] **Step 1：RED（`tests/ui/leanBottomSheet.test.ts` 新增）**

```ts
describe('closed sheets are out of the accessibility tree on every platform', () => {
  it('hides a closed sheet and its backdrop button, and exposes them once open', () => {
    mount();
    expect(sheet().props.accessibilityElementsHidden).toBe(true);
    expect(sheet().props.importantForAccessibility).toBe('no-hide-descendants');
    const backdropWrapper = () => renderer.root.find((node) => node.props.testID === 'lean-bottom-sheet-backdrop').parent!;
    expect(backdropWrapper().props.accessibilityElementsHidden).toBe(true);
    act(() => ref.current!.snapToIndex(0));
    layContent(300);
    finishAnimations();
    expect(sheet().props.accessibilityElementsHidden).toBe(false);
    expect(sheet().props.importantForAccessibility).toBe('auto');
    expect(backdropWrapper().props.accessibilityElementsHidden).toBe(false);
  });
});
```

- [ ] **Step 2：RED（`tests/ui/nativeSheetLifecycle.test.ts` 同時跑兩個平台）**
  - 把 hoisted 的 `Platform: { OS: 'android' }` 改成 `Platform: { OS: 'android' as 'android' | 'ios' }`。
  - 把 `describe('installed SDK sheets on the app-owned bottom sheet', ...)` 包進 `describe.each(['android', 'ios'] as const)('%s', (os) => { beforeEach(() => { rn.Platform.OS = os; }); ... })`。
  - 在 `opens %s and keeps that host mounted...` 這個測試裡，`boundary.back` 那一段改成只在 `os === 'android'` 時執行（iPhone 沒有返回鍵）；`inertHosts` 的數量斷言也改成只在 android 檢查（iOS 分支不建 inert host，改由預熱掛著）。
  - 新增 iOS 專屬斷言：iOS 上三個面板在關著時 `sheet.props.accessibilityElementsHidden === true`。
  - 執行 → iOS 那一組因為 Step 1 的行為還沒實作而 FAIL。

- [ ] **Step 3：實作（`src/ui/sheet/bottomSheet.tsx`）**
  - 面板本體：
    ```tsx
    accessibilityElementsHidden={index !== 0 ? true : accessibilityElementsHidden ?? false}
    importantForAccessibility={index !== 0 ? 'no-hide-descendants' : importantForAccessibility ?? 'auto'}
    ```
  - 遮罩外層（`BottomSheetBackdrop` 的 `Animated.View`）：
    ```tsx
    accessibilityElementsHidden={!sheet.isOpen}
    importantForAccessibility={sheet.isOpen ? 'auto' : 'no-hide-descendants'}
    ```
  - 註解：`// Closed sheets stay mounted (the SDK pre-warms their WebViews on iOS), so they must be hidden from VoiceOver/TalkBack explicitly. Android's SDK path already asked for this; now both platforms get it.`
  - 兩個測試檔都要 PASS；原本 Android 的斷言不變。
- [ ] **Step 4：Maestro 讀經 flow（需要 Q1 的 key；沒有 key 時 SKIP）**
  - 先用 `workflow_dispatch` 跑一次 `maestro hierarchy > ci-out/hierarchy-reader.json`，只下載這一個檔，找出讀經器按鈕的 `accessibilityLabel`。已知的有「完成設定，返回閱讀」（`nativeSheetLifecycle.test.ts`）、「讀經閱讀器」分頁、「關閉面板」。
  - `10-reader-open.yaml`：點「讀經」→ 進讀經器 → 等到約 13:1 的經文片段「離世歸父」出現 → 截圖。
  - `11-reader-sheets.yaml`：設定、選章、選版本三個面板各做：打開 → 看到內容 → 點「關閉面板」→ 關掉；再打開 → 往下拖把手 → 關掉。
  - `12-reader-verse.yaml`：點一節經文 → 出現動作列 → 再點同一節 → 動作列消失。
  - **如果 12 失敗**（iOS 上沒有畫面上的方式取消選取）：停在這裡，做整頁 mock（疊在模擬器截圖上）給光佑，他說「改」才加按鈕。
- [ ] **Step 5：FOCUS GREEN**：vitest 兩個檔 PASS；有 key 時 10–12 PASS；R2 PASS；I2 仍然 0。
- [ ] **Step 6：Commit** `fix(reader): hide closed sheets from assistive tech on both platforms; iOS reader flows`；開 M2 PR。

### Task 8：背景朗讀（M3）

**Files:**
- Create: `scripts/ios/make-tone.py`、`.maestro/ios/20-audio-start.yaml`、`.maestro/ios/21-audio-after-background.yaml`
- Modify: `scripts/ios/run-flows.sh`（在 20 與 21 之間把 App 切到背景 20 秒）

- [ ] **Step 1：測試音檔（CI 當場產生，不進 repo）**

```python
# scripts/ios/make-tone.py <out.wav> — 60 s, 8 kHz, 8-bit mono 440 Hz tone (~480 KB) for the QA chapter.
import math, os, struct, sys, wave
path = sys.argv[1]
os.makedirs(os.path.dirname(path), exist_ok=True)
rate = 8000
with wave.open(path, 'wb') as out:
    out.setnchannels(1); out.setsampwidth(1); out.setframerate(rate)
    out.writeframes(bytes(int(128 + 60 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(rate * 60)))
```

- [ ] **Step 2：flows**
  - `20-audio-start.yaml`：進讀經器（約 13）→ 點播放 → 等 5 秒 → 斷言畫面顯示播放中（播放鈕變成暫停，label 由 Task 7 Step 4 的 hierarchy 取得）。
  - 背景：`run-flows.sh` 在 20 之後執行：
    ```bash
    xcrun simctl launch "$UDID" com.apple.Preferences
    sleep 20
    xcrun simctl launch "$UDID" org.qingmu.youth
    ```
  - `21-audio-after-background.yaml`：斷言進度文字符合正規式 `0:2[3-9]|0:3[0-9]`（5 秒加背景 20 秒）。如果在背景被暫停，進度會停在 0:05 左右，這一步就會 FAIL。
  - 切分頁續播：在 20 之後點「積分」再點回「讀經」，斷言進度仍在前進（`0:0[7-9]|0:1[0-9]`）。
- [ ] **Step 3：FOCUS**
  - **RED**：用 `workflow_dispatch` 把 `CHAPTER_AUDIO_MODE.shouldPlayInBackground` 暫時改成 `false`（不 commit）→ 21 要 FAIL。
  - **GREEN**：還原後 PASS。
  - 預期不用改產品程式：iOS 端的音訊模式、`UIBackgroundModes: audio`、Now Playing 都已經由 expo-audio 提供。
- [ ] **Step 4：Commit** `test(ios): background narration survives app and tab switches`；開 M3 PR。

### Task 9：iOS 推播與提醒（M4；真正送達在 Phase 2 驗）

**Files:**
- Create: `src/domain/friendNotificationText.ts`、`server/apnsSender.ts`、`tests/server/apnsSender.test.ts`、`.maestro/ios/30-friend-push.yaml`
- Modify: `src/services/reminderDevice.ts:15,127-138`、`src/services/apiClient.ts:325-333`、`src/services/friendPush.ts`（`presentFriendAddedNotification`、`registerConfiguredFriendPushTask`）、`src/services/reminderScheduler.ts:47-53`、`server/friendPush.ts`、`server/remoteConfiguration.ts`、`server/routes.ts:85,615-616,726-727`、`server/http.ts:95-100`、`server/reminderPreferences.ts:69-75`、`package.json`、`package-lock.json`
- Test: `tests/services/reminderDevice.test.ts`、`tests/services/friendPush.test.ts`、`tests/services/reminderScheduler.test.ts`、`tests/server/friendPush.test.ts`、`tests/server/reminders.test.ts`

**Interfaces:**
- Produces:
  - `export type DevicePushPlatform = 'ANDROID' | 'IOS'`（`src/services/reminderDevice.ts`）
  - `export function devicePushPlatform(tokenType: string): DevicePushPlatform | null`
  - `export function friendAddedNotificationText(friendName: string): { title: string; body: string }`（`src/domain/friendNotificationText.ts`）
  - `export interface ApnsAlert { title: string; body: string; data: Record<string, string>; collapseId?: string }`
  - `export type ApnsAlertSender = (token: string, alert: ApnsAlert) => Promise<void>`（錯誤訊息 `APNS_UNREGISTERED` 或 `APNS_SEND_FAILED_<status>`）
  - `export function createApnsSender(config: { keyFile: string; keyId: string; teamId: string; topic: string; production: boolean; provider?: ApnsProviderLike }): { send: ApnsAlertSender; shutdown: () => void }`
  - `export interface FriendPushSenders { android?: PushDataSender; ios?: ApnsAlertSender }`
  - `notifyFriendAdded(db, senders: FriendPushSenders, input)`（取代原本的 `send: PushDataSender` 參數）
  - `export const MAX_PENDING_READING_REMINDERS = 60`

- [ ] **Step 1：RED（App 端 token）** `tests/services/reminderDevice.test.ts` 新增：

```ts
it('registers an iOS APNs token as platform IOS', async () => {
  const secureStore = store();
  const register = vi.fn(async () => true);
  await expect(registerReminderDevice({ secureStore, tokenSource: { getDevicePushTokenAsync: async () => ({ type: 'ios', data: 'a1b2c3' }) }, api: { registerReminderDeviceToken: register, revokeReminderDeviceToken: async () => true }, generateInstallationId: () => 'install-ios' }))
    .resolves.toMatchObject({ registered: true, installationId: 'install-ios' });
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ token: 'a1b2c3', platform: 'IOS' }));
});
```

既有的「`type: 'apns'` 不登記」測試保留：expo 在 iOS 回傳的 type 是 `'ios'`，未知的 type 一律拒絕。

- [ ] **Step 2：實作（App 端 token）**

```ts
// src/services/reminderDevice.ts
/** expo-notifications reports an Android FCM token as 'android' (or 'fcm') and an iOS APNs token as 'ios'. */
export type DevicePushPlatform = 'ANDROID' | 'IOS';
export function devicePushPlatform(tokenType: string): DevicePushPlatform | null {
  const type = tokenType.toLowerCase();
  if (type === 'android' || type === 'fcm') return 'ANDROID';
  if (type === 'ios') return 'IOS';
  return null;
}
```

  - 第 15 行和 `apiClient.ts:325` 的型別改成 `platform?: DevicePushPlatform`。
  - 第 127–128 行改成 `const platform = devicePushPlatform(permissionToken.type); if (!platform || !permissionToken.data.trim()) return { registered: false, installationId: null };`。
  - 第 138 行改成 `platform`（取代寫死的 `'ANDROID'`）。

- [ ] **Step 3：RED/實作（通知文字共用）**

```ts
// src/domain/friendNotificationText.ts — the same words on both platforms: Android shows them from the app,
// the server puts them in the iOS alert.
export function friendAddedNotificationText(friendName: string): { title: string; body: string } {
  return { title: '竹科聖經', body: `${friendName} 已加你為好友` };
}
```

  - `presentFriendAddedNotification` 改用這個函式；Android 的輸出逐字不變，既有的 `tests/services/friendPush.test.ts` 必須照樣 PASS。

- [ ] **Step 4：RED/實作（iOS 不註冊背景任務）**
  - 測試：`Platform.OS = 'ios'` 時 `registerConfiguredFriendPushTask` 不呼叫 `registerTaskAsync`。
  - 實作放在函式開頭：
    ```ts
    // iOS friend pushes are alerts the system shows itself; a background task would need the remote-notification
    // background mode and is not used there. Android's data-only push still needs the task.
    if (Platform.OS === 'ios') return;
    ```
  - `friendPush.ts` 從 `react-native` 的 import 加上 `Platform`。

- [ ] **Step 5：RED/實作（待發提醒上限，兩平台）**
  - 測試：105 天的排程 → `buildUpcomingReadingReminderSpecs` 回傳 60 則，第一則是最近的那一天。
  - 實作：在 `.sort(...)` 後加 `.slice(0, MAX_PENDING_READING_REMINDERS)`，常數註解：`// iOS keeps a limited number of pending local notifications (commonly cited as 64); every activation reschedules, so 60 days ahead is always enough.`

- [ ] **Step 6：RED（伺服器 APNs sender）**

```ts
// tests/server/apnsSender.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createApnsSender } from '../../server/apnsSender';

describe('APNs alert sender', () => {
  it('sends an alert whose custom fields sit under body, where expo-notifications reads them on iOS', async () => {
    const provider = { send: vi.fn(async () => ({ sent: [{ device: 'tok' }], failed: [] })), shutdown: vi.fn() };
    const sender = createApnsSender({ keyFile: 'unused', keyId: 'K', teamId: 'T', topic: 'org.qingmu.youth', production: true, provider });
    await sender.send('tok', { title: '竹科聖經', body: '乙 已加你為好友', data: { event: 'FRIEND_ADDED', kind: 'FRIEND_ADDED', memberId: 'm1', friendMemberId: 'm2', friendName: '乙' }, collapseId: 'friend:m2' });
    const [note, token] = provider.send.mock.calls[0] as unknown as [{ topic: string; pushType: string; collapseId: string; compile(): string }, string];
    expect(token).toBe('tok');
    expect(note.topic).toBe('org.qingmu.youth');
    expect(note.pushType).toBe('alert');
    expect(note.collapseId).toBe('friend:m2');
    expect(JSON.parse(note.compile())).toEqual({
      aps: { alert: { title: '竹科聖經', body: '乙 已加你為好友' }, sound: 'default' },
      body: { event: 'FRIEND_ADDED', kind: 'FRIEND_ADDED', memberId: 'm1', friendMemberId: 'm2', friendName: '乙' },
    });
  });
  it('reports an unregistered device so the caller can revoke the token', async () => {
    const provider = { send: vi.fn(async () => ({ sent: [], failed: [{ device: 'tok', status: 410, response: { reason: 'Unregistered' } }] })), shutdown: vi.fn() };
    const sender = createApnsSender({ keyFile: 'unused', keyId: 'K', teamId: 'T', topic: 'org.qingmu.youth', production: true, provider });
    await expect(sender.send('tok', { title: 't', body: 'b', data: {} })).rejects.toThrow('APNS_UNREGISTERED');
  });
});
```

- [ ] **Step 7：實作（伺服器 APNs sender）**
  - `npm install --save-exact @parse/node-apn@8.1.0`（改 lockfile；**合併前先告知光佑**）。

```ts
// server/apnsSender.ts
import apn from '@parse/node-apn';

/** iOS alert push through Apple's provider API (token auth, HTTP/2), via the maintained @parse/node-apn. */
export interface ApnsAlert { title: string; body: string; data: Record<string, string>; collapseId?: string }
export type ApnsAlertSender = (token: string, alert: ApnsAlert) => Promise<void>;
export interface ApnsProviderLike {
  send: (note: apn.Notification, token: string) => Promise<{ sent: unknown[]; failed: Array<{ status?: number; response?: { reason?: string } }> }>;
  shutdown: () => void;
}

export function createApnsSender(config: { keyFile: string; keyId: string; teamId: string; topic: string; production: boolean; provider?: ApnsProviderLike }): { send: ApnsAlertSender; shutdown: () => void } {
  const provider: ApnsProviderLike = config.provider
    ?? new apn.Provider({ token: { key: config.keyFile, keyId: config.keyId, teamId: config.teamId }, production: config.production }) as unknown as ApnsProviderLike;
  return {
    async send(token, alert) {
      const note = new apn.Notification();
      note.topic = config.topic;
      note.pushType = 'alert';
      note.priority = 10;
      note.expiry = Math.floor(Date.now() / 1000) + 3600;
      note.alert = { title: alert.title, body: alert.body };
      note.sound = 'default';
      // expo-notifications hands JS only userInfo.body as the remote notification's data (NotificationRecords.swift).
      note.payload = { body: alert.data };
      if (alert.collapseId) note.collapseId = alert.collapseId;
      const result = await provider.send(note, token);
      const failure = result.failed[0];
      if (!failure) return;
      if (failure.status === 410 || failure.response?.reason === 'Unregistered' || failure.response?.reason === 'BadDeviceToken') throw new Error('APNS_UNREGISTERED');
      throw new Error(`APNS_SEND_FAILED_${failure.status ?? 'TRANSPORT'}`);
    },
    shutdown: () => provider.shutdown(),
  };
}
```

- [ ] **Step 8：RED/實作（伺服器分流）**
  - **測試**（`tests/server/friendPush.test.ts`）：
    - Android token 收到的 data 逐字等於 `{ event: 'FRIEND_ADDED', friendMemberId, friendName }`（快照）。
    - iOS token 收到的 alert 是 `friendAddedNotificationText(friendName)`，data 是 `{ event: 'FRIEND_ADDED', kind: 'FRIEND_ADDED', memberId: <owner>, friendMemberId, friendName }`，collapseId 是 `friend:<friend>`。
    - 丟出 `APNS_UNREGISTERED` 時，那個 iOS token 的 `revoked_at` 被寫入。
  - **`server/friendPush.ts`**：
    - 查詢改成 `SELECT token, platform FROM device_delivery_tokens WHERE member_id = ? AND revoked_at IS NULL ORDER BY updated_at DESC`。
    - `platform === 'IOS'` → `senders.ios?.(token, { ...friendAddedNotificationText(name), data: { ...data, kind: 'FRIEND_ADDED', memberId: input.ownerMemberId }, collapseId: \`friend:${input.friendMemberId}\` })`。
    - `platform === 'ANDROID'` → `senders.android?.(token, data)`。
    - 某個平台沒有設定 sender 時就跳過，不算失敗。
    - 遇到 `APNS_UNREGISTERED` 就執行 `UPDATE device_delivery_tokens SET revoked_at = ? WHERE token = ? AND platform = 'IOS'`。
  - **`server/reminderPreferences.ts:69-75`**：`registerDeviceDeliveryToken` 的 input 加 `platform: 'ANDROID' | 'IOS'`。INSERT 的 `'ANDROID'` 改成 `?`；`ON CONFLICT` 加 `platform = excluded.platform`。
  - **`server/routes.ts:726-727`**：接受 `body.platform === 'ANDROID' || body.platform === 'IOS'`，並把 platform 傳下去。
  - **`server/routes.ts:85`**：加 `pushIos?: ApnsAlertSender`。第 615–616 行的條件改成 `(options.pushData || options.pushIos)`，呼叫 `notifyFriendAdded(options.db.db, { android: options.pushData, ios: options.pushIos }, ...)`。
  - **`server/remoteConfiguration.ts`**：讀 `QINGMU_APNS_KEY_FILE`、`QINGMU_APNS_KEY_ID`、`QINGMU_APNS_TEAM_ID`；topic 固定 `org.qingmu.youth`；`QINGMU_APNS_PRODUCTION` 預設 `'true'`。四個都齊（key 檔存在）才建立 `pushIos`，而且要在 FCM 的提早 return **之前**算好，兩個 return 都帶上 `pushIos`。
  - **`server/http.ts`**：`createHttpServer` 的 options 加 `pushIos?: ApnsAlertSender`，把 `options.pushIos ?? remoteConfig.pushIos ?? undefined` 傳給 routes。
  - 會議提醒相關的 `'ANDROID'`（`remoteReminders.ts`、`reminders.ts`、`reminderWorker.ts`）**不動**：正式環境是關的，兩邊一起維持關閉。
- [ ] **Step 9：模擬器 P1（`30-friend-push.yaml` 加 `run-flows.sh`）**
  - 腳本用 Step 7 的 sender 配假 provider 產生跟正式一模一樣的 payload，寫到 `ci-out/friend.apns`，再加上 `"Simulator Target Bundle": "org.qingmu.youth"`。
  - App 在前景時執行 `xcrun simctl push "$UDID" org.qingmu.youth ci-out/friend.apns`。
  - flow 斷言：畫面出現好友加入的即時效果（`publishFriendAdded` 觸發的好友清單更新；確切文字由 hierarchy 取得）。
  - 點通知橫幅能不能用 Maestro 自動化，**未驗證**。做不到就由單元測試證明點擊路由：iOS 形狀的 notification（data 取自 body）交給 `createReminderNotificationController().handleResponse` 後，要呼叫 `openFriends`。這一項也列入 Phase 2 真機清單。
- [ ] **Step 10：FOCUS GREEN**
  - 相關測試檔都 PASS；Android FCM 快照不變；`npm run server:smoke` PASS；P1 PASS；本機提醒 flow（把提醒時間設成 1 分鐘後）PASS。
  - Android workflow 的 APK 大小差 ≤ 0.2%：`@parse/node-apn` 只在伺服器端用，Metro 不會把它打包進 App。
- [ ] **Step 11：Commit** `feat(push): iOS devices register and receive the friend alert through APNs`；開 M4 PR。
- **後端部署**不在 Phase 1：Phase 2 有 APNs key 時才用既有的 cutover 腳本，並經同意。

### Task 10：iOS 專屬畫面差異（M5）

**Files:**
- Modify: `src/services/updateCheck.ts`、`tests/updateCheck.test.ts`、`app/(tabs)/journal.tsx:224-231`
- Create: `.maestro/ios/40-no-update-prompt.yaml`、`.maestro/ios/41-journal.yaml`

**Interfaces:**
- `fetchUpdateState(installedVersionCode, fetchImpl = fetch, platform: string = Platform.OS)`

- [ ] **Step 1：RED（`tests/updateCheck.test.ts`）**
  - 檔頭加 `vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));`。
  - 新增：
    ```ts
    it('never asks and never offers the sideload page outside Android', async () => {
      const fetchImpl = vi.fn();
      await expect(fetchUpdateState(24, fetchImpl as unknown as typeof fetch, 'ios')).resolves.toEqual(NO_UPDATE);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
    ```
- [ ] **Step 2：實作**
  ```ts
  import { Platform } from 'react-native';
  // ...
  export async function fetchUpdateState(installedVersionCode: number | null, fetchImpl: typeof fetch = fetch, platform: string = Platform.OS): Promise<UpdateState> {
    // The published build is a sideloaded APK. An iPhone updates from the App Store by itself, and
    // App Review guideline 2.5.2 forbids pointing it at an installer, so iOS neither asks nor shows.
    if (platform !== 'android') return NO_UPDATE;
    // (existing body unchanged)
  ```
  - UpdatePrompt、UpdateBanner、公告頁的 UpdateCard 都是經由這個函式，一處改動全部涵蓋。iOS 也不會多打一次網路請求（R4）。
- [ ] **Step 3：Maestro `40-no-update-prompt.yaml`**：啟動後等 25 秒（超過 20 秒重試），斷言「有新版本」不存在。
- [ ] **Step 4：日記資料夾（UI 變更，先 mock）**
  - 用 `41-journal.yaml` 在模擬器寫一則日記，截取 iOS 日記頁。
  - 做一張整頁 mock：在截圖上把「同時存到我選的資料夾」標成「iOS 不顯示；改用上面的『匯出全部』（系統分享面板可以存到『檔案』）」，另附 Android 版對照。
  - 用 Playwright 自截自查後，把 `/private/` 連結給光佑。
  - **光佑說「改」才做 Step 5。**
- [ ] **Step 5：實作（核准後）**
  - `journal.tsx` 的資料夾按鈕和「停止同步」區塊外面包 `Platform.OS === 'android' ? (...) : null`，並加註解 `// iOS has no persistent folder permission (expo-file-system StorageAccessFramework is Android-only); 匯出全部 opens the system share sheet, which saves to Files.`。
  - 測試：Platform＝ios 時沒有 `accessibilityLabel` 為「同時存到我選的資料夾」的按鈕；Android 照舊有。
- [ ] **Step 6：FOCUS GREEN**
  - `tests/updateCheck.test.ts`、`tests/ui/updatePrompt.test.ts` 和日記測試都 PASS；40、41 PASS。
  - 既有的 `scripts/verify-install-link.ts` 流程不變（Android 發版用）。
- [ ] **Step 7：Commit** `feat(ios): no sideload update prompt; journal export through the share sheet`；開 M5 PR。

---

## RC（Phase 1 整合候選）

- 候選＝M0–M5 都合併之後的 main commit（每次合併都經光佑同意）。
- **一次性整合證明**：
  1. main 上 `unit`、`android`、`ios` 三個 workflow 都綠，iOS 的 flow 都是 PASS 或有理由的 SKIP，R1–R5 都 PASS。
  2. 本機在 qm-ios worktree 跑一次 vitest 全套，失敗集合 ⊆ base（目前是空集合）。
  3. **先跟光佑說一聲**，再用 `C:\dev\machine\tmp\qm-0518\build.py <main commit>` 建候選 APK，跑含 Firebase 的 check-apk-budget。
  4. 在光佑手機上 `adb install -r`，跑既有的 `sheets_check`、`audio_check`、`perf_check`（Android 執行資源不退步）。
- 不做 Android 發版，除非光佑另外同意；main 的 tree 必須跟驗證過的候選逐位元組相同。
- RC 找到問題 → 回到對應 Task 的 FOCUS 修正 → 產生新候選。

## Self-Review（plan coverage）

| 上層計畫要求 | Task |
|---|---|
| 三個雲端 job、兩平台每個 PR 都驗 | 1、2、3、4 |
| Android 不退步（vitest、APK 守門、原生 diff） | 1、2、RC |
| iOS 編得過、無 reanimated/worklets、Info.plist | 3、6 |
| 執行資源 R1–R5 | 4（R2 在 7） |
| 讀經器與面板的 iOS 分支、VoiceOver | 7 |
| 背景朗讀 | 8 |
| iOS 推播與本機提醒 | 9 |
| 更新提示、日記資料夾 | 10 |
| 版本號同步 | 6 |
| 不重造輪子 | 「沿用的現成元件」表；Task 9 用 `@parse/node-apn` |
| Google iOS 登入、用 Apple 登入、TestFlight、上架、真推播送達 | **Phase 2**（等 Q2、Q3） |

- 型別一致性：`DevicePushPlatform`、`ApnsAlertSender`、`FriendPushSenders`、`friendAddedNotificationText` 在 Task 9 各步驟的名稱一致。
- `fetchUpdateState` 第三個參數在 Task 10 定義，並在同一個 Task 使用。
