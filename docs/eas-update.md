# JavaScript/圖片更新 (EAS Update)

> 2026-10-19 決定；首次啟用隨 0.5.35 商店建置發布。本 PR 保留目前版號，由維護者發版時調整。

## 相容與頻道

| 項目 | 規則 |
|---|---|
| 可 OTA | 已有原生能力下的 JavaScript, 文字、樣式、圖片等資源修正 |
| 必須上架 | 新增/改變原生套件、權限、config plugin, SDK/React Native, 原生設定，或新的 runtime |
| runtimeVersion | `appVersion`, 取 `app.json` 的 `version`; 每次商店發版改 version, 同一 version 的安裝才收得到同一 runtime 的更新 |
| production | 正式 Android 本機 Gradle 與 iOS EAS Build 的預設頻道 |
| preview | 管理者先驗收；EAS preview 建置也預設指向這裡 |

本機 Gradle 在 `expo prebuild` 時從 `app.config.js` 寫入 `updates.requestHeaders['expo-channel-name'] = production`; 不是只在 `eas.json` 設定。EAS 的兩個 build profile 同時明列 channel. 更新網址從既有 EAS projectId 衍生。

每個 JS 冷啟動只在畫面掛載後檢查一次，背景下載。下載好的更新在下一次冷啟動，或 App 離開 30 分鐘以上回到前景時套用 (光佑 20261021, 取代 2026-10-19 的「只在下次完整關閉再打開時套用、不呼叫 `reloadAsync()`」：長輩很少完整關 App)：回前景時若正在朗讀或播放、日記或其他輸入還沒存、面板開著就不換，等下一次 (`src/ui/admin/OtaUpdates.tsx`、`src/services/autoUpdateGuard.ts`)；換的時候呼叫官方 `Updates.reloadAsync()`，畫面重新載入約 1 秒。沒有下載好的更新時，離開 30 分鐘以上回來會再檢查一次，所以開著好幾天的 App 也收得到。不輪詢、不用計時器。離線、檢查/下載失敗不顯示錯誤頁，保留嵌入/快取版本。原生 `checkAutomatically: ON_ERROR_RECOVERY` 在正常啟動不重複檢查，但保留故障復原檢查；`fallbackToCacheTimeout: 0`, `useEmbeddedUpdate: true`, `disableAntiBrickingMeasures: false` 保留快速啟動與復原。完全隔離的 CI 才用 `NEVER`, 避免故障時呼叫正式更新服務。

## 管理者手機

從「積分」右上角頭像進帳戶頁，往下捲到管理區，切換「先收到測試版更新」。說明：「只給管理者：先拿到還沒發給大家的修正，驗收用。」沿用既有伺服器 `canViewAllScores` 身分判斷，和帳戶頁其他管理入口共用同一次查詢 (`useViewerCapabilities`)，進頁面和回到前景時重新確認；一般成員看不到。

開啟呼叫官方 `Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': 'preview' })`; 關閉同樣明確傳 `production`. 選擇存在這支手機的原生儲存，不改伺服器頻道對應。切換不立即下載/重載：下次開啟背景下載，再下一次開啟 (或離開 30 分鐘以上回來) 套用；畫面會提示這件事。`Updates.channel` 在下次冷啟動後讀回選擇。關閉不使用 `null` 回到建置預設，因為 EAS preview 建置的預設也是 preview, 會與關閉狀態矛盾。preview 與 production 必須保持本機資料格式相容，避免切回後讀不到先前資料。

選擇存在手機上，比登入的人活得久，但開關只有管理者看得到。所以 preview 只跟著管理者：沒有人登入 (登出後)、換成別的成員登入，或伺服器回答這個人已經不是管理者時，App 自動把這支手機切回 production, 帳戶頁的檢查和開 App 時的檢查都會做。preview 手機在確認登入的是管理者之前不檢查更新；查不到身分 (離線、伺服器錯誤) 時保留選擇，這次開啟不檢查。一般 production 手機開 App 時不多發任何請求。切回後下一次開啟就從 production 檢查。若切回前這次開啟已經下載了 preview 更新，下一次開啟仍會先執行它 (官方沒有丟棄已下載更新的 API)，之後從 production 收到新的更新才換掉；所以管理者驗收完先關開關，再交出手機。

只使用 request-header API; 不使用需要關閉防變磚保護的 `setUpdateURLAndRequestHeadersOverride()`.

## 發送流程 (本文件不會自動執行)

以下命令由維護者在核准發送時執行。員工實作/CI 不發布更新，也不改頻道對應。CLI 固定使用既有 EAS Build 的 24.13.0; SDK 56 發送時必須帶 `--environment`, 兩個頻道都使用同一個 production 環境，避免 API/功能旗標漂移。執行前確認沒有 `CI=true` 搭配 `QINGMU_CI_DISABLE_OTA_CHECKS=1`, 也沒有 fixture/test date 等測試旗標。

沒有 iPhone 時，第 3 步的 iPhone 那一半用 GitHub Actions 的 `ios-ota-verify` 在模擬器上驗收 (見下面「iPhone 模擬器驗收」)：輸入第 2 步記下的 iOS group ID, 判定 PASS 才算 iPhone 驗收通過。

0. 首次啟用由維護者核對兩頻道，必須指向不同分支。以下是操作文件，員工本工單未執行任何線上頻道查詢/建立/改指向：

   ```sh
   npx eas-cli@24.13.0 channel:view preview --json
   npx eas-cli@24.13.0 channel:view production --json
   ```

   若頻道不存在，維護者才建立。此 CLI 會連到同名分支，分支不存在時一併建立；已存在的頻道保留現有對應，不重設：

   ```sh
   npx eas-cli@24.13.0 channel:create preview --json
   npx eas-cli@24.13.0 channel:create production --json
   ```

   建立後再讀回兩個頻道，核對 branch ID 不同，再繼續發送。

1. 確認商店已安裝包含 expo-updates 的版本，原生相容、version/runtime 相同。記錄 source commit, runtime, 兩平台、更新前的 production update group ID; 第一個 OTA 沒有前一組時記錄嵌入版本。
2. 在固定且乾淨的來源 (`git status` 沒有改動)，**每個平台分開**匯出、檢查、推到 preview 頻道。一律用這個腳本，不要直接執行 `eas update` 指令：

   ```sh
   npx tsx scripts/ota/ota-update.ts --platform android --message "修正說明" --publish
   npx tsx scripts/ota/ota-update.ts --platform ios --message "修正說明" --publish
   ```

   腳本 (`scripts/ota/ota-update.ts`) 依序做三件事，任何一步失敗就以結束碼 1 停下：
   - 清掉 `dist/ota-<平台>`，用 `npx eas-cli@24.13.0 env:exec production` 帶入 EAS production 環境變數並設 `EXPO_NO_DOTENV=1`，執行 `npx expo export --platform <平台> --output-dir dist/ota-<平台> --dump-sourcemap --dump-assetmap --clear`。這和 `eas update --environment production` 自己打包時的環境與參數相同 (已對照 eas-cli 24.13.0 原始碼)。
   - 跑推送前檢查 `scripts/ota/verify-ota-bundle.ts` 並印出檢查表 (見下一節)。有 FAIL 就不推。
   - 檢查全部 PASS 才執行 `npx eas-cli@24.13.0 update --skip-bundler --input-dir dist/ota-<平台> --platform <平台> --channel preview --environment production --message "修正說明" --non-interactive --json`，上傳的就是剛剛檢查過的那個資料夾。腳本只會推到 preview 頻道。

   不帶 `--publish` 時只匯出和檢查，通過後印出推送指令。只想在本機檢查、不連 EAS 的話，改帶 `--local-env` (不含 EAS 環境變數，只驗證，永遠不推)。訊息不可含 `"`、`%`、`$`、`` ` `` 或換行。

   每個平台都要保存輸出的 update group ID, runtime 和 update ID; 分開推，兩個平台各有自己的 group 編號。

   為什麼不直接 `eas update`：它打包完立刻上傳，中間沒有機會檢查 bytecode 內容；而且 `--platform all` 在這個專案會連 web 一起打包而失敗 (eas-cli 從專案根目錄找不到放在 `node_modules/expo/node_modules` 裡的 `@expo/cli`，退回舊的 `--platform=all` 參數，web 端的 expo-sqlite wasm 解析失敗)。

3. **兩個平台分別驗收**。Android 和 iOS 是各自執行的兩份更新，iOS 的讀經器等走不同的原生路徑，只看一支手機不代表另一個平台沒問題。維護者在一支 Android 和一支 iPhone 的管理區各自開啟開關，完整關閉 App 後重開，等背景下載；再完整關閉重開，驗收可見的小字變更、讀經、朗讀、登入與既有功能，確認手機所見內容和該平台的 preview update group 相符：帳戶頁最下面的版本行會多「· 更新 <日期>-<更新編號最後 6 碼>」，要和第 2 步記下的該平台 update ID 對得上。每個平台分別記下結果。含「回前景自動換上」(2026-10-21) 的版本上線後，至少一次改用這條路驗：背景下載後不關 App, 放到背景 30 分鐘以上 (沒有朗讀、沒有開著的面板) 再回來，畫面重新載入約 1 秒，版本行換成新的 update ID; 朗讀中回來則不換。
4. 哪個平台驗收通過，就只把那個平台原樣重發到 production, **不重新匯出或建置**。`<group ID>` 必須使用第 2 步保存的、那個平台自己的 ID; republish 會建立新的 group ID, 但沿用已驗收的程式/資源：

   ```sh
   # Android 手機驗收通過後
   npx eas-cli@24.13.0 update:republish --group <Android 的-preview-group-ID> --destination-channel production --platform android --message "preview Android 驗收通過" --json
   # iPhone 驗收通過後
   npx eas-cli@24.13.0 update:republish --group <iOS 的-preview-group-ID> --destination-channel production --platform ios --message "preview iOS 驗收通過" --json
   ```

   推 production 不用 `--platform all`。某個平台驗收沒過就不推它，修正後從第 2 步重新發那個平台的 preview.

5. 保存每個平台新的 production group ID 與其來源 preview group ID. 管理者關閉開關，按上述兩次冷啟動流程確認 production; 其他成員在後續冷啟動收到更新。

## 推送前的 bytecode 檢查 (2026-10-20)

2026-10-20 第一份 preview 更新 (Android, main `5630d06`) 在手機一套用就閃退：`src/domain/calendar.ts` 的 `loadReadingPlan` 拋「invalid date at index 30」，expo-updates 退回舊版也失敗，下一次啟動才回到內建版本。問題在 Expo 的打包工具，不在 App 程式：

1. `expo export` 先把 JS 編成 Hermes bytecode 檔，之後 `@expo/cli` 56.1.25 才在 bytecode 裡把網頁元件 (`'use dom'`；這個 App 是 YouVersion 讀經器的 8 個) 的 html 檔名原地換成內容雜湊 (`transformNativeBundleForMd5Filename`)。
2. hermesc 會讓共用位元組的字串在字串表裡頭尾重疊，原地換檔名時連鄰居一起改掉。用同一個套件資料夾重新匯出 `5630d06`，Android bytecode 裡「2026-10-06」「2026-12-21」「PSA.119.1-88」都被改了，讀經計畫的日期檢查就讓 App 一啟動就閃退。
3. 改到哪些字串，取決於 `node_modules` 的實際路徑 (被替換的佔位檔名是網頁元件檔案路徑的 md5)：換一台電腦或一個資料夾，就換一批字串被改，所以不是每次都看得出來。Android 和 iOS 也各自不同。
4. 商店內建的版本走 `export:embed`，先替換文字再交給原生建置編譯，沒有這個問題。

上游：[expo/expo#49626](https://github.com/expo/expo/issues/49626) 是問題回報，[expo/expo#49627](https://github.com/expo/expo/pull/49627) 是修正。兩個在 2026-10-20 都還沒合併，npm 上最新的 @expo/cli 56.1.26 也不含修正。

| 項目 | 做法 |
|---|---|
| 修正 | `patches/expo++@expo+cli+56.1.25.patch`、`patches/@expo+metro-config+56.0.19.patch` 用 patch-package 套上游 #49627 的修法：含網頁元件的 bundle 延後編譯，先在 JS 裡換好 html 檔名再交給 hermesc 編譯；`@expo/cli` 不再改已編好的 bytecode 檔，遇到就直接報錯。不含網頁元件的 bundle 檔，以及商店建置用的 `export:embed` 流程，編出來的東西不變。 |
| 推送前檢查 | `scripts/ota/verify-ota-bundle.ts <匯出資料夾> --platform <平台>`：(1) bytecode 檔尾的 SHA-1 是 hermesc 對整個檔案算的，對不上就代表編完之後被改過；(2) 讀經計畫的每個日期、經文代號和原文都要在 bytecode 裡，缺的會列出 bytecode 裡實際的樣子；(3) 網頁元件 html 的檔名要等於內容的 md5 值，也要跟 bytecode 裡的參照一一對上 (expo-updates 依內容雜湊存檔，對不上 App 就找不到網頁元件)。任何一項 FAIL 就不推。 |
| 推送 | `scripts/ota/ota-update.ts`：匯出、檢查、通過才 `eas update --skip-bundler` 推同一個資料夾 (上一節第 2 步)。 |
| 守衛測試 | `tests/tools/otaBytecodeGate.test.ts` (檢查本身，含用 hermesc 重現「2026-10-06」被改的情形)、`tests/tools/otaHermesPatch.test.ts` (裝好的 Expo 工具鏈真的先換名再編譯)。 |

### 上游修好後怎麼拿掉 patch

1. 確認 #49627 或同等修正已經合併，而且進到這個 SDK 會裝的 `@expo/cli`、`@expo/metro-config` 版本 (看兩個套件的 CHANGELOG)。
2. 升級 expo 套件 (用 `npx expo install --fix` 對齊版本)，刪掉上面兩個 patch 檔，`npm install`。版本變了而 patch 還在時，`postinstall` 的 `patch-package --error-on-fail` 會在套不上時直接失敗，提醒做這個決定。
3. `npx vitest run tests/tools/otaHermesPatch.test.ts` 要全過。測試照 #49627 的檔名和函式名寫；上游改了名字就照上游改測試，但「含網頁元件的 bundle 不能在編完之後被改」這條不能拿掉。
4. 兩個平台各跑一次 `npx tsx scripts/ota/ota-update.ts --platform <平台> --message 檢查 --local-env`，檢查結果要全部通過。
5. 推送前檢查和 `--skip-bundler` 流程保留，不跟著 patch 一起拿掉。

## 回復

若上一組 OTA 已驗證可用，將那一組重新送到 production, 不重新打包。兩個平台的 group 是分開的，`--group` 用出問題那個平台自己的上一組，`--platform` 寫那個平台：

```sh
npx eas-cli@24.13.0 update:republish --group <該平台上一組已驗證可用的-group-ID> --destination-channel production --platform <android|ios> --message "回復上一版" --json
```

若這是第一組 OTA, 或要退回商店內嵌版本，CLI 支援對目前該 branch/runtime 最新 group 執行 rollback; 它會重發前一組，沒有前一組才送出回到 embedded 的指令。先核對 group 身分，勿把 preview 的 ID 當成 production:

```sh
npx eas-cli@24.13.0 update:rollback <該平台目前-production-最新-group-ID> --platform <android|ios> --message "撤回問題更新" --json
```

這些操作不會即時重啟所有手機。可正常啟動的手機要連網冷啟動 (或離開 30 分鐘以上回來) 下載復原，再重新開啟或下一次離開 30 分鐘回來時套用；啟動崩潰由保留的 expo-updates 復原機制處理，不保證能挽救任何任意資料遷移，因此仍須保持資料格式相容。沒有網路時繼續用現有本機版本。

## CI 隔離

只有 `CI=true` 且 `QINGMU_CI_DISABLE_OTA_CHECKS=1`, 並且沒有 EAS build profile/`EAS_BUILD=true` 與正式 Gradle 簽章旗標 `QINGMU_RELEASE_SIGNING_PROPERTIES` 時，原生 `checkAutomatically` 才設 `NEVER`. 原生更新套件仍啟用，可驗官方 header API, 但不呼叫正式更新服務。App 從官方 `Updates.checkAutomatically` 讀取安裝檔內的政策，只在正式的 `ON_ERROR_RECOVERY` 政策下手動背景檢查；不從 OTA manifest 讀取停用旗標，因此測試用 metadata 不會抑制正式安裝的後續檢查。

EAS production/preview 與本機簽章正式建置即使繼承 CI 旗標仍保留 `ON_ERROR_RECOVERY`. 一般本機 Gradle 正式建置不可設定這組 CI 專用旗標。iOS CI 在啟動前直接讀回成品 `Expo.plist` 守門，再用記憶體假資料管理者驗證切換持久化；不發布 OTA.

Android 的同等檢查是 `scripts/android/check-updates-config.ts`: prebuild 後讀 `android/` 的 `AndroidManifest.xml` 和 `strings.xml`, 核對 expo-updates 啟用、update URL, runtime 等於 `app.json` 的 version, `expo-channel-name` 是 production, 啟動不等待下載、防變磚與內嵌版本保留，以及 check-on-launch 政策。正式本機建置 `scripts/build-android.ps1 -Variant release` 在 Gradle 前用預設的 `ERROR_RECOVERY_ONLY` 執行，不符就停；維護者自己的發版腳本也要在 prebuild 之後、Gradle 之前呼叫它 (`npx tsx scripts/android/check-updates-config.ts --project <repo>`)。Android CI 用 `--check-on-launch NEVER` 檢查同一份真實 prebuild 輸出。改了 version 一定重新 `npx expo prebuild --platform android --clean`, 不手改 `android/`.

## iPhone 模擬器驗收 (`ios-ota-verify`, 2026-10-21)

沒有 iPhone 時，iOS 的驗收 (「發送流程」第 3 步) 用手動觸發的 GitHub Actions `ios-ota-verify`：輸入 iOS 的 update group ID 和頻道 (預設 `preview`，推到 production 之後也可以驗 production 的 group)，一輪約 40 分鐘，判定表在 run 的摘要，截圖和紀錄在 artifact `ios-ota-verify`。它不推送、不改頻道、不用任何 secret, 也不加進 PR 的自動檢查。

```sh
gh workflow run ios-ota-verify.yml -f group_id=<iOS 的 group ID> -f channel=preview
```

| 步驟 | 做法 |
|---|---|
| 要驗哪個 update | 讀公開的 `https://u.expo.dev/<projectId>/group/<group ID>` (App 也用這個服務，不用 token)，取得 iOS update 的 ID, runtime 和建立時間。group 不存在或沒有 iOS update 就判 FAIL |
| 原生層 | 依 runtime 在 `scripts/ios/store-builds.json` 找商店 build 的 commit, 在那個 commit 用 `EAS_BUILD_PROFILE=<頻道>` 建 Release 模擬器 App (`scripts/ios/build-simulator.sh`), 啟動檢查維持 `ON_ERROR_RECOVERY`。讀回成品的版本、build 號、runtime, update URL, 頻道和 `ERROR_RECOVERY_ONLY`；原生設定組成要和這份 update 匯出時的正式設定相同，只差頻道 |
| 內建 update 的時間 | expo-updates 只收比正在跑的版本新的 update. 今天才建的模擬器 App 比每一份已推的 OTA 都新，會全部拒收，所以把 `EXUpdates.bundle/app.manifest` 的時間改成商店 build 在 EAS 完成的時間 (進位到整秒) 再重簽；商店 App 的內建版本就是在那次建置裡產生的 |
| 第一次冷啟動 | 內建 JS 的入口換成 `scripts/ios/ota-seed-entry.js`：本機假資料後端的管理者 (`fixture:self`) 照真正登入的方式存好登入狀態，App 自己的啟動檢查 (`src/ui/admin/OtaUpdates.tsx`) 從頻道背景下載 |
| 第二次冷啟動 | 執行下載的 update. 所有畫面都要登入 (`src/ui/AppStack.tsx`)，所以這台 runner 把 update 的 API 主機名稱指到同一個本機假資料後端 (hosts 檔，憑證只在這台模擬器信任)：update 用登入狀態打開讀經頁和帳戶頁，正式後端收不到任何請求 |
| 判定 (`scripts/ios/ota-verify.ts verdict`) | 9 項全部 PASS 才 PASS: group 有 iOS update, 頻道現在發的就是它、原生層、內建時間、只連本機、第一次下載的是它、第二次跑的是它 (帳戶頁版本行「· 更新 <台北日期>-<ID 最後 6 碼>」，而且 expo-updates 記錄它成功啟動)、沒有閃退或 ErrorRecovery, 讀經頁打開今天 (台北) 讀經計畫的那幾段。量不到一律 FAIL |

每個 iOS 商店 build 在發版 PR 裡於 `scripts/ios/store-builds.json` 加一筆 (`eas build:list --platform ios --json` 的 `gitCommitHash` 和 `completedAt`)；沒有登記的 runtime 直接 FAIL. 模擬器結果不代替 App Store 安裝入口的驗收；Google/Apple 登入、推播和正式後端的真實資料也不在這裡驗。

## 原生套件的一次性大小基準

`scripts/ci/eas-update-size-baseline.json` 記錄導入 expo-updates 56.0.28 前後的實測 bytes (同一個 main commit 的 before/after run 與 commit). 允許量是兩者相減的原生增量 (APK 3625033bytes, iOS 3828511bytes)，加在 main 目前的大小上，所以其他 PR 先合併、main 先變大幾 KB 也照樣成立。只有在產生 main 基準的那個 commit 的 `package.json` 還沒有 expo-updates 時才加；main 已含 expo-updates 就只和 main 比。CI 從 main 基準 run 的 headSha 取出那份 `package.json`; 讀不到就不加 (寧可 FAIL 也不放寬)，候選裝的 expo-updates 不是實測版本也不加。APK 1.002/iOS 1.05 的比例不變，記憶體不套用這個調整。缺值、0 或字串測量一律 FAIL. PR/REPORT 另列最終候選和原 main 的實際增量。

## 依據

- [Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)
- [Deployment](https://docs.expo.dev/eas-update/deployment/)
- [SDK 56 Updates API](https://docs.expo.dev/versions/v56.0.0/sdk/updates/)
- [Channel surfing](https://docs.expo.dev/eas-update/channel-surfing/)
- [Override 設定與防變磚限制](https://docs.expo.dev/eas-update/override/)
- [EAS CLI update/republish/rollback](https://docs.expo.dev/eas/cli/)

命令參數已用 `npx eas-cli@24.13.0 <command> --help` 核對。頻道初始化行為也已核對 CLI 原始碼；未實際建立頻道或發布。實測發送/同組推廣由維護者在 0.5.35 上架後完成。

2026-10-20 更正：該版 CLI 的 publish.js 只有在從專案根目錄解析得到 `@expo/cli` 時，才把 `update --platform all` 拆成兩個 native `--platform` 參數；這個專案的 `@expo/cli` 裝在 `node_modules/expo/node_modules`，解析不到，會退回 `--platform=all` 連 web 一起匯出而失敗。`update --skip-bundler`/`--input-dir`、`env:exec` 的行為，以及 `--environment` 會帶入 EAS 變數、`EXPO_NO_DOTENV=1` 和 `--clear`，都已對照 eas-cli 24.13.0 的 `build/commands/update/index.js`、`build/project/publish.js`、`build/utils/expoCli.js`、`build/commands/env/exec.js`。
