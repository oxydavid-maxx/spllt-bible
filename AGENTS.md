# AGENTS.md：在這個 repo 工作前先讀

給人和 AI agent 共用的技術規則。Claude Code 會經由 `CLAUDE.md` 自動讀到這份。

竹科聖經是 Expo SDK 56／React Native 0.85 的讀經 App：Android 已發布，iOS 移植進行中（[issue #23](https://github.com/oxydavid-maxx/spllt-bible/issues/23)）。後端在 `server/`（Node＋SQLite）。

## 先讀順序

1. 這份檔案。
2. `docs/features/README.md`：功能清單，App 現在做什麼、每個功能的詳細規格在哪。
3. `.github/pull_request_template.md`：每個 PR 要勾的兩平台檢查。
4. 進行中的計畫在 `docs/superpowers/plans/`（iOS：`2026-09-29-ios-parity*.md`）；設計決定在 `docs/design/`。
5. `HANDOFF.md` 和 `docs/handoff/` 是 2026-09-23（0.5.9）以前的交接，當歷史參考。

維護者的私人營運（發版簽章、正式後端、測試裝置）不放在這個公開 repo。

## 功能清單與規格（`docs/features/`）

- `docs/features/README.md` 列出使用者看得到的每個功能，一個功能一列，連到它的規格檔（`docs/features/<功能區>.md`）。
- 規格寫「App 現在怎麼做」：什麼情況 → 看到什麼，含離線、錯誤和平台差異。討論過程和決定留在 `docs/design/`、`docs/superpowers/plans/`，規格連過去，不重抄。
- **新增或改變功能的 PR，同一個 PR 更新清單和規格。** 還沒做完的功能寫在規格的「規劃中」段落。
- 每份規格都有「決定（為什麼這樣做）」段，刻意不做的事放最前面。維護者在對話裡做的決定，由同一個 PR 寫進去。
- **看到像「沒做完」或「怪怪的」地方，先讀那份規格的「決定」段**；沒有記錄就問維護者是不是刻意的，不要直接當成 bug 修。commit 說明記錄的是當時實作者的打算，不是決定的來源：日記「不上傳伺服器」是隱私決定，早期 commit 說明卻寫伺服器是本體，曾因此被誤判成 bug。
- 守衛測試 `tests/tools/featureDocs.test.ts`：每個規格檔都要被清單連到、都要有「決定」段，清單也不能連到不存在的檔案。
- 這個 repo 是公開的：規格裡不放成員名字、帳號、金鑰和私人網址。

## 兩個平台一起改

- 一份程式碼。平台差異只能放在 config plugin（`plugins/`）、`app.json`／`app.config.js`，或 `Platform.OS` 分支，而且每一處都用註解寫原因。
- `android/`、`ios/` 由 `expo prebuild` 產生，不進 git（`.gitignore` 只忽略最外層的這兩個資料夾）。要改原生設定只能寫 plugin。
- 每個 PR 自動跑下面三個雲端驗證，三個都要綠。
- 版本號：發版只改 `app.json` 的 `version` 和 `android.versionCode`。iOS 的 `buildNumber` 由 `app.config.js` 從 versionCode 算出來，不要在 `app.json` 另外寫（`tests/config/iosConfig.test.ts` 會擋）。
- 0.5.35 起用官方 `expo-updates`/EAS Update 更新 JS, 文字、樣式與圖片；`runtimeVersion` 採 `appVersion`, 每次商店發版都改 version, 同 version 才可互收 OTA. 新增/改變原生套件、權限、SDK, config plugin 或原生設定一定要重新上架。OTA 不改版號；建置/發布方法見 [docs/eas-update.md](docs/eas-update.md)。
- Android 本機 Gradle 與 iOS EAS 正式建置預設 `production`; 管理者手機用官方 request-header API 選 `preview`. 不得關防變磚保護。下載好的 OTA 只在冷啟動，或離開 30 分鐘以上回前景時換上 (光佑 20261021)；朗讀或播放中、輸入沒存、面板開著不換。新的輸入框、面板、播放器要告訴 `src/services/autoUpdateGuard.ts` (`useAutoUpdateHold`、`addAutoUpdateProbe`)，守衛測試 `tests/tools/autoUpdateHolds.test.ts`。CI 專用停用檢查旗標不得帶進正式 Gradle 建置；EAS profiles 會強制保留檢查。

## 雲端驗證（`.github/workflows/`）

| workflow | 做什麼 | 失敗時看哪個 artifact |
|---|---|---|
| `unit` | vitest 全套（ubuntu）。兩個真瀏覽器測試用 chrome-headless-shell | `unit-summary`：`vitest-summary.json`，每個失敗附一行原因 |
| `android` | prebuild；原生設定和 main 差幾行；debug 簽章的 release APK；APK 守門（兩個 ARM 架構、沒有 .map、大小上限）；大小和 main 比 | `android-summary`：`android-summary.json`、`native-diff.txt` |
| `ios` | `macos-26`＋Xcode 26.4.1；模擬器 Release 建置（ad-hoc 簽章）；守門（沒有 reanimated/worklets、Info.plist、沒有 .map）；Maestro 流程 `.maestro/ios/*.yaml`（假資料後端）；首頁閒置的 CPU、記憶體、網路請求；讀經頁、積分頁記憶體；每個切換的延遲 (`14-reader-instant`、`44-points-instant`，見下面「切換延遲怎麼量」) | `ios-summary`：`flows.json`、`ios-summary.json`、`switch-latency.json`、`maestro/<流程>-junit.txt`、`-screen.txt`、`-system.txt`、`-maestro-debug.txt`、`-backend.txt`、截圖 |

- iOS 一輪大約 35–40 分鐘。本機能重現的先在本機重現；多個修正攢成一批再推。
- 寫或修 Maestro 流程前，先讀 `<流程>-screen.txt`（失敗當下畫面上每個元素的標籤和位置），不要猜標籤。
- 讀經器和朗讀的流程（檔名符合 `^(1[0-9]-reader|2[0-9]-audio)`）要用 GitHub secret `YOUVERSION_APP_KEY`；沒有這個 secret 時記成 SKIP。CI 的朗讀跟正式版一樣由後端取得（`EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED=true`）。
- 量不到的數字一律判 FAIL，不會被當成 0 或通過。

### 執行資源預算

| 項目 | 上限 |
|---|---|
| 首頁閒置 CPU | ≤ 3% |
| 讀經器閒置 CPU | ≤ 5% |
| 記憶體 (首頁、讀經頁、積分頁) | ≤ 350 MB；首頁另外不超過 main 的 1.10 倍 |
| 切換延遲 (點下到內容出現，400ms 手機網路延遲下) | ≤ 100ms，量不到判 FAIL |
| 閒置時的網路請求 | 0 |
| iOS `.app` 大小 | 不超過 main 的 1.05 倍 |
| Android APK 大小 | 不超過 main 的 1.002 倍 |

### 切換延遲怎麼量 (光佑 2026-10-23)

- 會等網路的切換 (全教會｜青少、換月、主堂獎品｜青少獎品、自己｜好友、領取紀錄、公告的主堂、讀經頁的靈修和換日) 一律走共用暫存 `src/services/viewCache.ts`：打開頁面先抓好、點了先顯示暫存、背景再更新。新增這類切換也要走它，並在兩個流程和 `scripts/ios/check-switch-latency.ts` 的 `EXPECTED` 加一項。
- 量法：App 自己記 (只有 CI 假資料建置，`src/services/switchLatencyProbe.ts`)，從點下到畫出內容的那一幀，寫進 App 的 Documents；`run-flows.sh` 在這兩個流程期間讓 count-proxy 給 `/api/` 加 400ms 延遲 (`$OUT/proxy-delay-ms`)，流程跑完把紀錄拷出來。少一筆就是量不到，判 FAIL。

### iOS 流程能穩定跑的前提

- 通知權限由 `scripts/ios/run-flows.sh` 在安裝 App 後授權一次（用 Maestro 內建的 applesimutils）。流程**不要**用 `clearState`：它會重裝 App、丟掉授權，系統通知對話框會卡住 driver。
- Maestro driver 開機後先暖機一次，之後所有呼叫都帶 `--no-reinstall-driver`。
- 流程用無障礙標籤（`accessibilityLabel`）比對。標籤同名時用相對位置（`above:`）或座標。
- 假資料後端的環境變數：`QINGMU_DEV_TOKEN`、`QINGMU_FIXTURE_ROSTER=two-member-week`、`QINGMU_FIXTURE_DEFAULT_MEMBER=fixture:self`（只帶 Bearer 的請求用這個成員）、`QINGMU_DB_PATH=:memory:`。前面接 `scripts/ios/count-proxy.ts`（HTTPS 8788 → 8787），記錄每個請求和回應狀態。App 用 `https://localhost:8788`：讀經器只從 https 的 API 網址取經文，所以 CI 每次產生一張只裝進模擬器的臨時根憑證（`scripts/ios/make-ci-tls.sh`）。

## iOS 注意事項（都實際發生過）

1. **不可** `import * as X from 'react-native'`，也**不可** `import('react-native')`。Metro 會跑過每個 getter，觸發 `PushNotificationIOS`，iOS release 版一開就閃退。守衛測試：`tests/config/noReactNativeWildcard.test.ts`。
2. 更新提示 (2026-10-21 改寫)：Android 照舊 (Play 或安裝檔的版本檔)。iPhone 只有從 TestFlight 裝的才提示：`src/services/iosInstallSource.ts` 看 App 資料夾旁的商店收據 (`StoreKit/receipt` 是 App Store, `StoreKit/sandboxReceipt` 是 TestFlight) 和 expo-application 的簽章種類，TestFlight 安裝讀版本檔的 `ios.testflight` ([docs/app-version.md](docs/app-version.md))，按「更新」開 TestFlight 裡竹科聖經的頁面。App Store 安裝、模擬器、開發版不問、不發請求，**絕不出現 TestFlight 連結或安裝檔** (審查 2.5.2)。`fetchUpdateState` (安裝檔) 在非 Android 照舊直接回「沒有更新」。CI 模擬器沒有收據，fixture 建置照 Maestro 啟動參數 `qingmuInstallSource` 假裝 (流程 40, 42)；TestFlight 真機的收據判斷要在發版後用真的 iPhone 驗。
3. 模擬器建置要 ad-hoc 簽章（`scripts/ios/build-simulator.sh`），不然沒有 keychain，SecureStore 會失敗。
4. `plugins/withGoogleSignInPods.js` 讓沒有 Google iOS 設定檔的建置也能通過 `pod install`。
5. 會員登入後，如果讀經提醒是開的，App 會要求通知權限（兩個平台都一樣）。
6. 日記的「同時存到我選的資料夾」只在 Android 顯示（`src/ui/journalFolderSync.ts`）：它靠 Android 的 StorageAccessFramework 取得長期的資料夾權限，iOS 沒有對應功能。iPhone 用「匯出全部」，系統分享面板可以存到「檔案」。`tests/ui/journalFolderSync.test.ts` 守這件事；iOS 流程 `41-journal` 在日記沒有入口期間 (2026-10-14 起) 暫停，入口回來時從 commit `cd5ec05` 拿回來。分頁列藏起來的分頁 (`href: null`)，流程不能再找它的按鈕 (`tests/tools/iosFlowReadiness.test.ts`)。
7. 面板和選單**不可**包在可以按的背景（`Pressable`）裡：iOS 把可以按的元件當成一整顆按鈕，裡面的選項對 VoiceOver 和 XCUITest 都看不到。用共用的 `src/ui/SheetBackdrop.tsx`，背景和面板並排。守衛測試：`tests/ui/sheetBackdrop.test.ts`。
8. 關閉中的底部面板要對輔助工具隱藏（`src/ui/sheet/bottomSheet.tsx`），不然 VoiceOver 和自動化測試會點到看不見的按鈕。
9. 推播：Android 用 FCM 的 data-only 訊息；iPhone 用 APNs 的可見通知，自訂資料放在 `body` 裡（expo-notifications 只把 `userInfo.body` 交給 JS）。後端的 `server/apnsSender.ts` 只有設了 `QINGMU_APNS_KEY_FILE`、`QINGMU_APNS_KEY_ID`、`QINGMU_APNS_TEAM_ID` 才會載入，所以舊的後端套件目錄也起得來（`tests/server/apnsLazyLoad.test.ts`）。模擬器用 `xcrun simctl push` 驗，流程 30、31。
10. iOS 最多只能排 64 個本機通知，所以讀經提醒最多排 60 個（`MAX_PENDING_READING_REMINDERS`）。

## 朗讀跟著走（read-along，兩個平台共用）

設計與驗證：`docs/superpowers/plans/2026-09-29-read-along-follow.md`。

- 朗讀反白和跟隨捲動只有一個負責者：WebView 裡的 `src/ui/readAlongBridge.ts`。App 端的跟隨狀態在 `src/ui/readAlongFollow.ts`。**不要**再把朗讀反白放進 SDK 的 highlights 管道：SDK 用 `parseInt(v)` 上色，找不到「5-6」裡的第 6 節（詩105:5-6 曾整段不反白）。
- 找經文一律用「包含第 N 節的那一段」：`v` 可能是 `5-6`，一節跨段時會有好幾個同 `v` 的元素。
- 「手動」只認手指拖動和選取經文，不認捲動事件：SDK 換章、字級改變都會自己捲動。
- 程式自己捲動時，工具列收合程式會略過（`window.__qingmuFollowScrolling`），不收合也不展開。
- 真機驗證時，WebView 裡的位置以截圖為準：程式捲動之後，uiautomator 回報的 WebView 節點座標會落後而且有偏移。原生按鈕（▶、回到朗讀處）照常用無障礙標籤。

## 測試慣例

- 先寫會失敗的測試，再改到通過。每修一類錯誤，加一條守衛測試擋住整類。
- 跟日期有關的測試要固定日期：`vi.useFakeTimers({ toFake: ['Date'] })` 加上 `vi.setSystemTime(...)`。
- 只能在特定環境跑的測試，用 `describe.skipIf(...)` 並註明原因。
- 真瀏覽器測試（`tests/ui/fullscreenReaderPadding.test.ts`、`tests/ui/readerImmersionBridge.test.ts`）用 chrome-headless-shell；可以用 `CHROME_PATH` 指定。
- 本機：`npm run typecheck` 加上改到的測試檔。全套 vitest 要跟 main 比失敗集合（有些歷史檢查在乾淨 clone 上本來就不會過，見 `CONTRIBUTING.md`）。

## 編輯注意

- **換行字元**：有些檔案刻意保留 CRLF（見 `.gitattributes`）。改檔要保留原本的換行；push 前比較 `git diff --stat` 和 `git diff --ignore-cr-at-eol --stat`，差很多就是換行被改了。
- `patches/`（YouVersion SDK 擴充；`expo++@expo+cli`、`@expo+metro-config` 是 OTA 打包改壞 Hermes bytecode 的上游修正，拿掉的條件見 [docs/eas-update.md](docs/eas-update.md)）用 patch-package 重新產生，不要手改 patch 檔。改到 `patches/` 或 lockfile，下次建置會重裝套件。
- 後端要向下相容：舊版 App 還會連新的後端。
- 後端的對外連線有 IPv4 備援 (`server/nat64Fallback.ts`，2026-10-20)：部署主機的網路有時只剩 IPv6，只有 IPv4 的服務 (LINE、Azure Speech) 會改走公開 NAT64。它只在直接啟動 `server/http.ts` 時開啟，`QINGMU_NAT64_FALLBACK=0` 可關；不要另外為對外連線指定 `lookup` 或只用 IPv4 (`family: 4`)，那樣會繞過備援。
- 發版腳本用 Node（tsx）執行，它們載入的 App 模組（例如 `src/services/updateCheck.ts`、`src/config/installLink.ts`）不可 import `react-native`：Node 解析不了它，發版檢查會直接壞掉。平台判斷由 App 裡的呼叫端傳入。守衛測試：`tests/tools/releaseScriptsLoad.test.ts`。
- 不要放金鑰、正式資料或個資進 repo、log 或截圖。

## Pull request

- OTA 也須先取得對應 runtime 的 preview 驗收，再用 `update:republish` 將同一份 JS/資源交給 production; 原生改動走商店。保留 group ID, 來源 commit 與回復點，不用重新打包代替已驗收的更新。發布授權與正式手機驗收屬維護者，操作文件不代表授權發布。

- 一個 PR 做一件說得清楚的事。說明從 `git diff origin/main...HEAD` 寫，每一句宣稱都要能在 CI 摘要裡找到證據。
- 合併、發布、部署由維護者決定。
