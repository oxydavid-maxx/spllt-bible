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
- 守衛測試 `tests/tools/featureDocs.test.ts`：每個規格檔都要被清單連到，清單也不能連到不存在的檔案。
- 這個 repo 是公開的：規格裡不放成員名字、帳號、金鑰和私人網址。

## 兩個平台一起改

- 一份程式碼。平台差異只能放在 config plugin（`plugins/`）、`app.json`／`app.config.js`，或 `Platform.OS` 分支，而且每一處都用註解寫原因。
- `android/`、`ios/` 由 `expo prebuild` 產生，不進 git（`.gitignore` 只忽略最外層的這兩個資料夾）。要改原生設定只能寫 plugin。
- 每個 PR 自動跑下面三個雲端驗證，三個都要綠。
- 版本號：發版只改 `app.json` 的 `version` 和 `android.versionCode`。iOS 的 `buildNumber` 由 `app.config.js` 從 versionCode 算出來，不要在 `app.json` 另外寫（`tests/config/iosConfig.test.ts` 會擋）。

## 雲端驗證（`.github/workflows/`）

| workflow | 做什麼 | 失敗時看哪個 artifact |
|---|---|---|
| `unit` | vitest 全套（ubuntu）。兩個真瀏覽器測試用 chrome-headless-shell | `unit-summary`：`vitest-summary.json`，每個失敗附一行原因 |
| `android` | prebuild；原生設定和 main 差幾行；debug 簽章的 release APK；APK 守門（兩個 ARM 架構、沒有 .map、大小上限）；大小和 main 比 | `android-summary`：`android-summary.json`、`native-diff.txt` |
| `ios` | `macos-26`＋Xcode 26.4.1；模擬器 Release 建置（ad-hoc 簽章）；守門（沒有 reanimated/worklets、Info.plist、沒有 .map）；Maestro 流程 `.maestro/ios/*.yaml`（假資料後端）；首頁閒置的 CPU、記憶體、網路請求 | `ios-summary`：`flows.json`、`ios-summary.json`、`maestro/<流程>-junit.txt`、`-screen.txt`、`-system.txt`、`-maestro-debug.txt`、`-backend.txt`、截圖 |

- iOS 一輪大約 35–40 分鐘。本機能重現的先在本機重現；多個修正攢成一批再推。
- 寫或修 Maestro 流程前，先讀 `<流程>-screen.txt`（失敗當下畫面上每個元素的標籤和位置），不要猜標籤。
- 讀經器和朗讀的流程（檔名符合 `^(1[0-9]-reader|2[0-9]-audio)`）要用 GitHub secret `YOUVERSION_APP_KEY`；沒有這個 secret 時記成 SKIP。CI 的朗讀跟正式版一樣由後端取得（`EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED=true`）。
- 量不到的數字一律判 FAIL，不會被當成 0 或通過。

### 執行資源預算

| 項目 | 上限 |
|---|---|
| 首頁閒置 CPU | ≤ 3% |
| 讀經器閒置 CPU | ≤ 5% |
| 記憶體 | ≤ 350 MB，而且不超過 main 的 1.10 倍 |
| 閒置時的網路請求 | 0 |
| iOS `.app` 大小 | 不超過 main 的 1.05 倍 |
| Android APK 大小 | 不超過 main 的 1.002 倍 |

### iOS 流程能穩定跑的前提

- 通知權限由 `scripts/ios/run-flows.sh` 在安裝 App 後授權一次（用 Maestro 內建的 applesimutils）。流程**不要**用 `clearState`：它會重裝 App、丟掉授權，系統通知對話框會卡住 driver。
- Maestro driver 開機後先暖機一次，之後所有呼叫都帶 `--no-reinstall-driver`。
- 流程用無障礙標籤（`accessibilityLabel`）比對。標籤同名時用相對位置（`above:`）或座標。
- 假資料後端的環境變數：`QINGMU_DEV_TOKEN`、`QINGMU_FIXTURE_ROSTER=two-member-week`、`QINGMU_FIXTURE_DEFAULT_MEMBER=fixture:self`（只帶 Bearer 的請求用這個成員）、`QINGMU_DB_PATH=:memory:`。前面接 `scripts/ios/count-proxy.ts`（HTTPS 8788 → 8787），記錄每個請求和回應狀態。App 用 `https://localhost:8788`：讀經器只從 https 的 API 網址取經文，所以 CI 每次產生一張只裝進模擬器的臨時根憑證（`scripts/ios/make-ci-tls.sh`）。

## iOS 注意事項（都實際發生過）

1. **不可** `import * as X from 'react-native'`，也**不可** `import('react-native')`。Metro 會跑過每個 getter，觸發 `PushNotificationIOS`，iOS release 版一開就閃退。守衛測試：`tests/config/noReactNativeWildcard.test.ts`。
2. 更新提示（下載 APK）只在 Android 出現：`fetchUpdateState` 在非 Android 平台直接回傳「沒有更新」，也不發網路請求（App Store 審查 2.5.2 不允許引導去裝安裝檔）。
3. 模擬器建置要 ad-hoc 簽章（`scripts/ios/build-simulator.sh`），不然沒有 keychain，SecureStore 會失敗。
4. `plugins/withGoogleSignInPods.js` 讓沒有 Google iOS 設定檔的建置也能通過 `pod install`。
5. 會員登入後，如果讀經提醒是開的，App 會要求通知權限（兩個平台都一樣）。
6. 日記的「同時存到我選的資料夾」只在 Android 顯示（`src/ui/journalFolderSync.ts`）：它靠 Android 的 StorageAccessFramework 取得長期的資料夾權限，iOS 沒有對應功能。iPhone 用「匯出全部」，系統分享面板可以存到「檔案」。iOS 流程 `41-journal` 會確認這件事。
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
- `patches/`（YouVersion SDK 擴充）用 patch-package 重新產生，不要手改 patch 檔。改到 `patches/` 或 lockfile，下次建置會重裝套件。
- 後端要向下相容：舊版 App 還會連新的後端。
- 發版腳本用 Node（tsx）執行，它們載入的 App 模組（例如 `src/services/updateCheck.ts`、`src/config/installLink.ts`）不可 import `react-native`：Node 解析不了它，發版檢查會直接壞掉。平台判斷由 App 裡的呼叫端傳入。守衛測試：`tests/tools/releaseScriptsLoad.test.ts`。
- 不要放金鑰、正式資料或個資進 repo、log 或截圖。

## Pull request

- 一個 PR 做一件說得清楚的事。說明從 `git diff origin/main...HEAD` 寫，每一句宣稱都要能在 CI 摘要裡找到證據。
- 合併、發布、部署由維護者決定。
