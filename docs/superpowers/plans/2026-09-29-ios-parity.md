# 竹科聖經 iOS 同等移植：詳細執行計畫（2026-09-29）

> **狀態：計畫，尚未開工。** 光佑說「開始」才動程式。本檔不改程式、不開 PR、不動 CI。
> **基準：** main `b2fc416`（Android 0.5.19）。交接來源是本機 `.handoff/ios-porting-20260929/KICKOFF.md`（不在 git）。
> **可編輯正本：** 本檔 `docs/superpowers/plans/2026-09-29-ios-parity.md`（分支 `feat/ios-plan`）。手機頁由本檔產生，內容以本檔為準。

## 0. 一句話

同一份程式碼，用 GitHub 免費的 macOS 雲端機器在 iOS 模擬器上自動編譯、自動點畫面、截圖，證明 iOS 版能用。模擬器證明不了的（真推播、鎖定畫面播放卡、真機效能）集中到最後一步，由教會有 iPhone 的人用 TestFlight 照清單驗。**M0–M5 不花錢、不需要 Apple 帳號。**

## 1. 查證後改變計畫的 5 件事

| # | 查到的事實 | 對計畫的影響 |
|---|---|---|
| 1 | Expo SDK 56 需要 Xcode 26.4 以上、iOS 16.4 以上。GitHub 的 `macos-15` 映像最新只有 Xcode 26.3。 | CI 必須用 `macos-26`，並且釘住 Xcode 版本。 |
| 2 | iOS 拿到的推播 token 是 APNs token。App 現在只收 `android`/`fcm` 兩種 token，iOS 的 token 會被直接拒絕（`src/services/reminderDevice.ts:127`）；伺服器也只會送 FCM。Google 把 APNs token 換成 FCM token 的舊 API 已淘汰：2026-10-01 起新專案不能用，2027-09-29 關閉。 | 建議**後端直接送 APNs**：用 Node 內建 http2，加上專案已經在用的 `jose` 簽 JWT。App 不加 Firebase iOS SDK。 |
| 3 | iOS 的背景資料推播（data-only）是低優先。系統可能節流（Apple 建議每小時不超過 2–3 則），App 被滑掉時會丟棄。 | iOS 一律送**看得到的通知**（alert），不照搬 Android 的 data-only 做法。 |
| 4 | 真的推播一定要付費 Apple Developer Program（US$99/年），因為 APNs key 只有會員拿得到。免費的路只有 `xcrun simctl push` 模擬。 | 推播分兩段：程式和模擬 payload 先做完（免費）；真正送達等付費後在 TestFlight 驗。 |
| 5 | App Store 審核規則 4.8：用 Google 登入當主要帳號的 App，必須再提供一個同等的登入方式，實務上就是「用 Apple 登入」。規則 2.5.2 禁止 App 引導下載、安裝會改變功能的程式。 | 上 App Store 前要加「用 Apple 登入」。iOS 版的更新提示必須關掉，不能導去 APK 頁。 |

## 2. 範圍與不能退步的東西

- **同一份程式碼**：`ios/` 跟 `android/` 一樣由 prebuild 產生、不進 git。iOS 的差異只放在 config plugin、`app.config.js`、`Platform.OS` 分支。
- **Expo 版本不動**：留在 SDK 56。SDK 57 已經出了，但升級另案處理，不跟 iOS 移植綁在一起。
- **功能同等**：以 Android 0.5.19 為準（§3 逐項對照）。

| Android 守門 | 現況 | 每個 PR 怎麼證明沒退步 |
|---|---|---|
| vitest 全套 | 1859 通過、2 略過、0 失敗 | 新增 GitHub Actions `unit` job（ubuntu，免費），每個 PR 自動跑全套。本機只跑受影響的測試（`vitest related`），合併候選再跑一次全套，比對「base 失敗集合 vs 分支失敗集合」。 |
| Android 原生設定 | prebuild 產生 | 動到共用檔（`app.json`、`app.config.js`、`package.json`、lockfile）的 PR：在 qm-ios 自己的資料夾，base 和分支各跑一次 `expo prebuild --platform android --no-install`，比對 AndroidManifest、build.gradle、資源。差異必須是空的，或只有預期的那幾行。 |
| APK 守門（大小、Firebase、背景播放 manifest、無 reanimated/worklets） | `scripts/check-apk-budget.ts` | 動到共用檔的 PR：用既有的 `build.py <commit>` 建候選 APK（不發布、不裝手機），check-apk-budget 必須 PASS，APK 大小差 ≤ 0.1 MB。**每次 Android 建置前先跟光佑說一聲**，因為教會後端也在同一台電腦上。 |
| Android 發版流程 | `build.py`、`publish.py`、`verify-install-link.ts`、`check-apk-budget.ts` | 這些腳本都不改。iOS worktree 用自己的 `node_modules`（自己跑 `npm ci`），不 junction 到 `C:\w\q`，也不在 `C:\w\q` 跑 npm ci 或 prebuild。 |

## 3. 功能對照表

「只能真機」那一欄的項目都在 M7 驗。

| # | 功能 | Android 怎麼做 | iOS 要做什麼 | 風險 | 沒有 iPhone 怎麼證明 | 只能真機 |
|---|---|---|---|---|---|---|
| 1 | Google 登入 | nitro-google-signin 加 google-services.json。App 只傳 `webClientId`（`src/services/googleNative.ts:21`）。 | 建 iOS OAuth client，取得 GoogleService-Info.plist。修 `app.config.js`：現在只要有 Android 設定檔，iOS URL scheme 就會被丟掉（第 23 行的 else-if）。 | 中。設定錯只會在 iOS 上壞，畫面顯示「登入沒有完成」。iOS token 的 aud 是 web client 還是 iOS client：第三方說新版是 web client（**未驗證**），後端先做成兩個都接受。 | 設定單元測試：只有 Android 檔時，輸出要跟現在逐字相同。模擬器按「Google 登入」要開出 accounts.google.com 頁面，證明設定正確；不真的登入。 | 真帳號登入成功、後端接受 token |
| 2 | 用 Apple 登入（新） | 無 | 用 expo-apple-authentication，只在 iOS 顯示。後端用 jose 加 Apple 公鑰驗 identity token（aud＝bundle id）。首次登入自動建成員，跟 Google 一樣。 | 中。新增依賴會改 lockfile，Android 打包下次要重裝依賴。Apple 只在第一次登入時給名字。 | 後端單元測試用自簽的假 token。模擬器確認按鈕只在 iOS 出現。 | 真機登入 |
| 3 | 讀經器（YouVersion SDK 與面板） | DOM 元件（WebView）加上 App 自己的底部面板 shim，不打包 reanimated。 | 驗 iOS 分支：iOS 上關著的面板不會隱藏，是為了預熱（`native-sheet.js:115`）。我們的 shim 有把內容留在畫面外，但**VoiceOver 會讀到關著的面板**（`src/ui/sheet/bottomSheet.tsx:192`）。WebView 內容程序被系統殺掉時要自動重載（iOS 只發事件，不會自己重載）。 | **高**。這個 shim 在 iOS 上從沒被驗過。 | vitest 用 SDK 真實的 `native-sheet.js` 跑 iOS 分支。Maestro 在模擬器開關三個面板、選經節、截圖。建置守門確認 Pods 和 bundle 裡沒有 reanimated/worklets。 | 手感、效能 |
| 4 | 「返回」類操作 | 用實體返回鍵退出沉浸模式、清除經節選取（`FullscreenReaderLayout.tsx:113`、`YouVersionReader.tsx:267`）。 | iPhone 沒有返回鍵，要在畫面上提供退出方式。**這是 UI 變更，先做整頁 mock。** | 中 | Maestro 點畫面上的按鈕退出 | — |
| 5 | 背景朗讀（切分頁、切 App） | expo-audio 加前景服務通知。設定是不混音、靜音模式也播、背景繼續播（`chapterAudioBackground.ts:20`）。 | `UIBackgroundModes: audio` 會由 expo-audio plugin 自動加入（`expo-audio/plugin/build/withAudio.js:14`）；照現在的設定，iOS 音訊類別會是 `.playback`。Android 專用的說明文字（前景服務、3 分鐘）要換成 iOS 版。 | 低到中 | 模擬器：開始播放，切到別的 App 20 秒再回來，播放進度要前進 ≥ 18 秒。切分頁照同樣方法驗。 | 鎖螢幕後繼續播、來電中斷後恢復、耳機線控 |
| 6 | 鎖定畫面播放卡 | expo-audio 媒體通知 | 用同一套 API（`setActiveForLockScreen`、`updateLockScreenMetadata`）。iOS 原生端已經實作 Now Playing 和遠端控制（`MediaController.swift`）。 | 低 | 單元測試確認有呼叫、metadata 正確。能不能從指令列讀模擬器的鎖定畫面：**未驗證**。 | 卡片的標題、封面、播放/暫停、±10 秒 |
| 7 | 積分頁（日曆補登、分數、獎品提案、投票截止日） | 純 JS | 預期不用改 | 低 | Maestro 連假資料後端（兩人一週）：補登一天後分數 +1、提案成功、投票截止日有顯示。 | — |
| 8 | 好友 QR | 產生 QR。掃描用 `CameraView.launchScanner`。 | iOS 已經有另一條路：畫面內的 `<CameraView>` 掃描（`FriendQrPanel.tsx:92`），也有單元測試。 | 中。模擬器沒有相機。 | 產生 QR 並截圖。掃描那段只能靠單元測試。 | 用真相機掃另一支手機的 QR |
| 9 | 公告 | 純 JS 加網路 | 預期不用改 | 低 | Maestro 開公告頁、截圖 | — |
| 10 | 日記 | 寫、存、分享匯出、鏡射到資料夾（Android SAF） | 寫、存、分享已可用（`journalShare.ts` 已設 iOS 檔案類型）。**「鏡射到資料夾」在 iOS 會失敗**（`journalFolderMirror.ts:46`）：iOS 上改成「存到檔案」或隱藏這個按鈕（UI 變更，要做 mock）。 | 中 | Maestro：寫日記、儲存，出現「✓ 已儲存」；分享面板有打開。 | 分享到 LINE 或「檔案」App |
| 11 | 讀經提醒（本機通知） | 本機排程 | iOS 可以排程，但系統對待發通知有數量上限（常見說法是 64 個，**未驗證**）。現在排程沒有上限（`reminderScheduler.ts:46`），iOS 改成只排最近 N 則，開 App 時再補排。 | 中 | 單元測試數量上限。模擬器排一則 1 分鐘後的提醒，確認通知出現。 | — |
| 12 | 聚會提醒（遠端推播） | 後端送 FCM data-only 訊息，App 的背景任務負責顯示。 | 見 §6：後端直送 APNs alert。App 接受 iOS token，登記時 platform＝IOS。 | **高** | 後端單元測試：本機假 APNs http2 伺服器檢查標頭與內容。模擬器用 `xcrun simctl push` 送同樣的 payload：通知要出現，點了要開到正確頁。 | 真 APNs 送達 |
| 13 | 好友加入即時推播 | 同上 | 同上。另外，背景處理會讀 SecureStore，iOS 預設「解鎖時才能讀」，鎖螢幕時會讀不到（`friendPush.ts:122`）：相關的鍵改成「開機解鎖過一次後就能讀」（AFTER_FIRST_UNLOCK，只影響 iOS）。 | **高** | 同上 | 鎖螢幕時收到通知 |
| 14 | 更新提示 | `UpdatePrompt` 讀 app-version.json，開 APK 安裝頁。 | iOS 沒設 buildNumber，所以**每個 iOS 使用者都會被叫去 APK 頁**，這也違反 App Store 2.5.2。改成 iOS 不顯示。App Store 本身會自動更新，之後要的話可改成連到 App Store。 | **高**（一定被拒審） | 單元測試：Platform＝ios 時不顯示、不開網址。Maestro 確認開 App 時不出現更新視窗。 | — |
| 15 | 管理員解鎖（生物辨識） | expo-local-authentication | 補中文 Face ID 說明字串（不設的話會是英文預設）。 | 低 | 設定測試讀 Info.plist | 真機 Face ID |
| 16 | 帳號刪除入口 | 文案是寫給 Google Play 的（`accountSurfaceComponent.tsx:11`） | App Store 也要求 App 內能刪帳號。文案改成兩個平台通用。 | 低 | 單元測試文案 | — |
| 17 | 安裝與更新 | 自家網站側載 APK | iOS 只能走 TestFlight 或 App Store（§7） | — | — | — |
| 18 | 效能與安裝大小 | 跟 YouVersion 同場比 | 見 §4.4 | — | 模擬器趨勢、建置守門 | App Store 安裝大小 |

## 4. 驗證設計

### 4.1 工具選擇（官方 → 商用 → 自己做）

| 選項 | 查到的事實（來源見 §11） | 用不用 |
|---|---|---|
| GitHub Actions macOS（`macos-26`，Apple 晶片） | public repo 的標準機器免費，不限分鐘。Free 方案同時最多 5 個 macOS job，每個 job 最長 6 小時。映像有 Xcode 26.4.1、26.5、26.6，iOS 模擬器 26.2、26.4.1、26.5。 | **主力**：編譯、安裝、Maestro、截圖 |
| Maestro CLI（開源） | 免費，要 Java 17 以上，iOS 只支援模擬器。已知問題：在 iOS 26.x 上一次跑整個資料夾，跑完第一個 flow 後 driver 會掛；解法是一次跑一個 flow。 | **主力**：自動點畫面、斷言文字 |
| EAS Build / EAS Workflows | 免費方案每月 15 次 iOS 建置，低優先排隊，每次最長 45 分鐘。Maestro job 免費方案不能用：Starter 方案 US$19/月起，每次再加 US$0.05。 | 驗證不用它。**付費後拿來做簽章建置和上傳 TestFlight**（§5.4）。 |
| Appetize.io（瀏覽器裡跑 iOS 模擬器） | 有免費方案，但分鐘數官方頁面是用 JS 載入，我讀不到（**未驗證**；第三方說每月 30 分鐘）。上傳的是模擬器 `.app` 壓成 zip。預設拿到連結的人都能開，可以改成要登入。 | 讓光佑用手機或電腦瀏覽器親手試。**第二輪再決定**，因為要把 App 傳到外部服務。 |
| TestFlight 真機 | 需要付費帳號。內部測試最多 100 人，免審。外部公開連結最多 10,000 人，第一個 build 要審。每個 build 90 天後過期。 | 最後一哩：真推播、鎖定畫面、效能 |
| Maestro Cloud | 每台裝置每月 US$250 | 不用 |

### 4.2 CI 怎麼走到登入後的畫面（不用真 Google 帳號）

- 後端本來就有測試模式：設 `QINGMU_DEV_TOKEN` 加 `QINGMU_FIXTURE_ROSTER=two-member-week`（`server/http.ts:29`、`:151`）。App 端設 `EXPO_PUBLIC_QINGMU_FIXTURE=true` 和同一個 token，就會直接以「測試成員甲」登入（`src/services/authSession.ts:30`）。
- CI 在同一台 macOS 機器上起這個假資料後端（127.0.0.1），模擬器連它。這是測試專用的建置，不給任何人安裝；正式建置不帶這些變數。
- 風險：iOS 的 App Transport Security 可能擋 http 連 127.0.0.1。網路上說法不一，**未驗證**。M0 第一次跑就會知道結果；如果被擋，M1 在 `app.config.js` 只對測試建置加 `NSAllowsLocalNetworking`。
- 讀經文字需要 YouVersion key（決定 Q1）。沒有 key 時，讀經器只驗「錯誤卡片和重新載入按鈕有出現」。
- 朗讀用既有的 QA 測試音檔變數（`EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO`、`EXPO_PUBLIC_QINGMU_QA_AUDIO_URI`），不連正式錄音。

### 4.3 每一項檢查：用什麼跑、PASS/FAIL、我讀結果花多少 token

| ID | 檢查 | 用什麼跑 | PASS | FAIL | 讀結果 token |
|---|---|---|---|---|---|
| I1 | 編得過 | CI：prebuild → pod install → xcodebuild（Release、模擬器、不簽章） | exit 0 | 其他 | ≈0.3k（摘要一行） |
| I2 | 沒有 reanimated/worklets | CI：查 `Podfile.lock` 有沒有 `RNReanimated`/`RNWorklets`；用 `nm` 查執行檔符號；查 `main.jsbundle` 有沒有 `WorkletsModule`/`ReanimatedModule` 字串 | 三項都是 0。`ExpoModulesWorklets` 是 Expo 內建模組，不算。 | 任一項 > 0 | 含在摘要 |
| I3 | Info.plist 設定 | CI：plutil 讀出 | `UIBackgroundModes` 有 audio；相機、Face ID、麥克風說明是中文；bundle id 正確；buildNumber＝versionCode | 缺任一項 | 含在摘要 |
| I4 | .app 內容與大小 | CI | 沒有 `.map` 檔；大小 ≤ 基準 × 1.05（基準在 M0 第一次量） | 超過 | 含在摘要 |
| I5 | 開得起來 | Maestro | 首頁出現測試成員的資料 | 逾時或閃退 | 失敗才看 1 張截圖，≈1.5k |
| F* | 功能流程（§3 每一列一個 flow） | Maestro，一次跑一個 flow | 所有斷言都通過 | 任一斷言失敗 | 同上 |
| A1 | 背景朗讀 | Maestro 加 simctl | 背景 20 秒後回前景，進度前進 ≥ 18 秒 | < 18 秒 | 同上 |
| P1 | 推播 payload | `simctl push` 加 Maestro | 通知出現，點了開到正確頁 | 沒出現或開錯頁 | 同上 |
| U1 | vitest 全套 | CI（ubuntu） | 失敗集合 ⊆ base 的失敗集合（現在是空集合） | 出現新的失敗 | ≈0.3k |
| AND | Android 不退步 | 本機：prebuild diff、`build.py`、check-apk-budget | diff 空、budget PASS | 其他 | ≈0.5k |

- **不穩的處理**：Maestro driver 啟動失敗（基礎設施問題）自動重跑一次，摘要標「重跑」。斷言失敗一律 FAIL，不重跑。
- **輸出**：每次 CI 產生一行 `ios-summary.json`（commit、Xcode、模擬器版本、通過數、失敗數、失敗 ID、.app 大小），加上 job summary 裡的 PASS/FAIL 表。Artifact 只上傳截圖和摘要，保存 7 天。**用 secret 建出來的 .app 不上傳**，因為公開 repo 的 artifact 別人也下載得到。
- **我怎麼等**：`gh run watch <id> --exit-status` 放背景跑，完成時會通知我，不用 sleep 輪詢。之後只下載摘要，截圖只看失敗的那幾張。
- **Token 預算**：每個里程碑的驗證讀取預估 ≤ 15k tokens（假設 ≤ 3 輪修正）。整個移植的驗證讀取合計約 100k 以內。

### 4.4 模擬器做不到的，用什麼替代

| 做不到 | 原因 | M0–M6 的替代證據 | 最後誰驗 |
|---|---|---|---|
| 真 APNs 推播 | 要付費帳號和 APNs key。模擬器本身能收 sandbox 推播（Xcode 14 以上、Apple 晶片），但在 CI 虛擬機裡行不行**未驗證** | 後端對假 APNs 伺服器的單元測試，加上用 `simctl push` 送同樣的 payload | TestFlight 真機 |
| 鎖定畫面播放卡、鎖螢幕續播 | 指令列能不能鎖模擬器、讀鎖定畫面，**未驗證** | 單元測試（呼叫與 metadata）、Info.plist 有 audio 背景模式、背景續播（A1） | 真機 |
| 來電或其他 App 搶走音訊 | 模擬器沒有電話 | 單元測試中斷處理 | 真機 |
| 相機掃 QR | 模擬器沒有相機 | 既有的單元測試 | 真機 |
| Face ID | 模擬器能模擬，但很難自動化 | 檢查 Info.plist 字串 | 真機（只有管理員會用，低優先） |
| 真實效能、記憶體 | 模擬器其實是跑在 Mac 上 | 模擬器的 `footprint` 趨勢，只跟自己比。模擬器裝不了 YouVersion，**不硬跟 YouVersion 比**。 | 沒有 Mac 就量不到真機記憶體和 CPU，這點明說 |
| 安裝大小 | 模擬器版和真機版不同 | 建置守門（I4） | App Store Connect 顯示的安裝大小 vs YouVersion App Store 頁面上的大小 |
| 真 Google/Apple 登入 | CI 不能用真帳號 | 登入頁打得開，證明設定正確 | 真機 |

## 5. GitHub／CI 設計（最終建議）

### 5.1 分支、PR、追蹤

- 同一個 repo、同一個 main。每個里程碑開一個 `feat/ios-<主題>` 小 PR。
- 追蹤用**一個 GitHub issue**：「iOS 同等移植」，裡面放里程碑勾選清單；每個 PR 寫 `Part of #N`。不用 Project 看板，因為多一層要維護，卻沒有多的資訊。
- repo 是公開的：issue 和 PR 裡不寫成員名字或其他私人資訊。

### 5.2 Workflows

**`.github/workflows/unit.yml`**（ubuntu-latest，免費）

- 每個 PR 跑 vitest 全套，輸出通過、略過、失敗數和失敗清單。

**`.github/workflows/ios.yml`**（`macos-26`，釘 Xcode 26.4.1，也就是 EAS 預設版本那一線）

- **觸發**：`pull_request` 加 paths filter（`app/**`、`src/**`、`plugins/**`、`patches/**`、`package*.json`、`app.json`、`app.config.js`、`metro*.js`、`react-native.config.js`、`babel.config.js`、`.maestro/**`、`scripts/ios/**`、`.github/workflows/ios.yml`），加上手動 `workflow_dispatch`。
- **不用 `macos-latest`**：這個標籤會被 GitHub 換掉，所以釘 `macos-26`。
- **並行**：`concurrency: ios-${{ github.ref }}`，同一分支有新的 push 就取消舊的那次。權限只給 `contents: read`。
- **步驟**：
    1. checkout，裝 Node 24（跟本機同一個主版本），`npm ci`
    2. `expo prebuild --platform ios --no-install`，帶測試建置變數
    3. `pod install`。快取 key＝lockfile、patches、`app.json`、`app.config.js` 的雜湊
    4. xcodebuild
    5. I2–I4 守門
    6. 起假資料後端
    7. 開模擬器、安裝、啟動
    8. Maestro，一次跑一個 flow
    9. 產生摘要，上傳截圖和摘要
- **不放任何 Apple 憑證。** 只有 Q1 同意後，才讀 `secrets.YOUVERSION_APP_KEY`。fork 來的 PR 拿不到 secret，這時讀經項目標「略過（無 key）」，不算失敗。

### 5.3 Secrets（每一個都要光佑逐項同意）

| Secret | 放哪裡 | 誰用 | 什麼時候需要 |
|---|---|---|---|
| YouVersion app key | GitHub Actions secret | iOS CI 的讀經 flow | M2（Q1） |
| iOS GoogleService-Info.plist（或 iOS client ID） | 本機私有 loader；簽章建置時另外放到 EAS | 建置 | M6（第二輪） |
| APNs key（.p8） | **只放後端機器**，跟 FCM 憑證放同一個私有目錄，不進 GitHub | 後端送推播 | M7（第二輪） |
| App Store Connect API key | EAS（建議）或 GitHub secret | 上傳 TestFlight | M7（第二輪） |

- 絕不寫進 repo、log、網頁。

### 5.4 簽章建置與上傳（付費後才做）

- **建議 EAS Build 加 EAS Submit**：這是 Expo 官方的做法，會自動管憑證，免費方案每月 15 次 iOS 建置夠用。
- 代價是 Apple 憑證要存在 Expo（第三方），所以第二輪再決定。
- 替代做法是 GitHub Actions 加 fastlane，但憑證就得放進公開 repo 的 secrets，維護也比較多。

### 5.5 版本

- `expo.version` 兩個平台共用。
- `ios.buildNumber` 永遠等於 `android.versionCode`（字串），用單元測試守住。
- 發版時兩個一起加，打 tag `vX.Y.Z`。Android 既有的發版流程和命名照舊，不受影響。

### 5.6 一定要光佑同意的動作

- 合併、發布、部署後端、付款、新增 secret、把 App 上傳到外部服務。
- auto mode 會擋 `gh pr merge`。被擋時我照實說明，請你回「我同意你執行」，不繞路。

## 6. 推播設計（建議方案 A）

| 方案 | 做法 | 好處 | 壞處 |
|---|---|---|---|
| **A 後端直送 APNs（建議）** | App 用 expo-notifications 拿 APNs token。後端用 Node http2，加上已經在用的 `jose` 簽 ES256 JWT（Apple 規定每 20–60 分鐘換一次），送到 `api.push.apple.com`。 | App 不加 Firebase iOS SDK，不增加大小和啟動時間；少一個第三方；推播路徑一目了然。 | 後端要多寫一個 sender（約 100 行加測試）。 |
| B Firebase iOS SDK | App 加 `@react-native-firebase/messaging` 拿 FCM token，後端照舊送 FCM，APNs key 上傳到 Firebase。 | 後端幾乎不用改 | App 多一套原生 SDK（大小、啟動、設定檔）；lockfile 會變，Android 打包要重裝依賴；一樣要付費帳號和 APNs key。 |
| C APNs token 轉 FCM | Instance ID `batchImport` | — | 已淘汰：2026-10-01 起新專案不能用，2027-09-29 關閉。不採用。 |

**方案 A 的細節**

- **Token 紀錄**：`platform＝IOS`，另外記 APNs 環境（sandbox 或 production，依建置類型）。`device_delivery_tokens` 表本來就有 platform 欄位（`server/db.ts:118`）；如果還要加欄位，照既有的 migration 做法，舊資料不動。
- **iOS 推播內容**：一律送看得到的通知。標題和內文照舊，另附 data 讓點擊能導到正確頁。標頭用 `apns-push-type: alert`、`apns-topic: org.qingmu.youth`。
- **Token 失效**：APNs 回 410 Unregistered 就刪掉那個 token。
- **Android 路徑逐位元組不變**：FCM 的請求內容做快照測試。
- **部署時機**：程式在 M4 合併；後端到 M7 真的有 iOS 使用者時才部署，沿用既有的 cutover 腳本（新的 pinned worktree、先備份資料庫、失敗自動回滾），而且要先經光佑同意。

## 7. 發佈設計

- iOS 不能側載。路線是先用 TestFlight 內部測試，讓 1–2 位可信任的大人照清單驗真機；之後走 App Store「不公開上架」（Q3 建議）。
- **不公開上架（unlisted）是什麼**：不出現在搜尋、分類、排行榜，只有拿到連結的人才找得到。一樣要通過完整審核。送審後另外填申請表。Apple 可能不核准，這時退回公開上架或 TestFlight 外部連結。
- **需要準備**：
    - 用 Apple 登入（4.8）
    - 隱私權政策（改寫 `docs/play/privacy-policy.md`）和 App 隱私標籤
    - 截圖：由 Maestro 在 6.9 吋模擬器上自動截
    - 出口合規：`ITSAppUsesNonExemptEncryption=false`
    - App 內刪除帳號（已經有）
    - 審核人員的登入方式：用 Apple 登入後會自動建成員，審核人員用自己的 Apple ID 就能登入
- **更新**：App Store 會自動更新。iOS 版關掉 UpdatePrompt。

## 8. 里程碑

每個里程碑都是一個可以單獨合併的 PR，而且不會讓 Android 退步。工作量是我的粗估。

### M0：CI 骨架（iOS 編得過、開得起來）

- **內容**：`unit.yml`、`ios.yml`、`.maestro/smoke.yaml`、`scripts/ios/`（守門和摘要腳本），外加追蹤 issue。
- **動到的共用檔**：無，只新增檔案。
- **驗收**：
    - PR 上 unit 和 ios 兩個 workflow 都綠，摘要 I1–I5 全 PASS。
    - 有首頁截圖。
    - 記下 .app 大小基準和 CI 耗時。
- **Android 不退步**：`git diff --stat` 只有新增檔。unit.yml 的結果要跟本機一樣是 1859/2/0；不一樣的話列出差異清單，屬於環境差異的就標註，不改產品程式。
- **需要的決定**：無。
- **工作量**：約 1 天。

### M1：iOS 設定落地

- **內容**：
    - `app.json` 的 `ios` 區塊：buildNumber、`supportsTablet: false`、`infoPlist.ITSAppUsesNonExemptEncryption: false`。
    - 權限說明字串全部中文。相機已經有；Face ID 要補；麥克風：兩個套件都會自動加英文預設字串，改成誠實的中文說明。
    - expo-notifications 的 `mode` 依建置類型設定。
    - `app.config.js` 修 Google 設定：Android 檔和 iOS plist 要能同時存在；只有 Android 檔時，輸出跟現在逐字相同。
    - 只有測試建置才加本機網路例外（如果 M0 證明需要）。
    - `NavigationBar` 加平台判斷。
- **動到的共用檔**：`app.json`、`app.config.js`。
- **驗收**：`tests/config/iosConfig.test.ts` 先紅後綠；CI 的 I3 全 PASS；buildNumber＝versionCode 的測試通過。
- **Android 不退步**：prebuild diff 是空的；`build.py` 建出候選 APK，check-apk-budget PASS，大小差 ≤ 0.1 MB。
- **工作量**：約 0.5 天。

### M2：讀經器與面板的 iOS 分支

- **前提**：Q1 同意。
- **內容**：
    - `nativeSheetLifecycle` 測試加上 iOS 分支。
    - 關著的面板對 VoiceOver 隱藏（用 `Platform.OS` 限定 iOS）。
    - WebView 內容程序被殺掉時自動重載。
    - Maestro flows：固定日期的經文要出現；三個面板開、關；選經節、出現動作列、關掉；沉浸模式收合和叫回。
    - iOS 用來退出沉浸模式、清除選取的畫面按鈕：**先做整頁 mock，你說「改」才做。**
- **驗收**：讀經相關的 F* 全 PASS；I2 仍然是 0；有截圖。
- **Android 不退步**：vitest。如果改到 Android 也會走的程式，就在光佑手機上跑 `sheets_check.py` 迴歸（只用 `adb install -r`）。
- **工作量**：1–2 天，另加 mock。

### M3：背景朗讀與鎖定畫面

- **內容**：
    - iOS 版說明文字，不提前景服務。
    - 確認中斷處理。
    - Maestro A1：切分頁、切 App。
    - 鎖定畫面 metadata 的單元測試。
- **驗收**：A1 PASS，單元測試通過。
- **Android 不退步**：vitest。如果改到共用的音訊程式，實機跑 `audio_check.py` 的 18 項。
- **工作量**：約 0.5 天。

### M4：推播與提醒（程式完成、模擬器驗過；真正送達留到 M7）

- **內容**：
    - App：接受 iOS token，登記 IOS 和 APNs 環境。
    - App：背景會讀的 SecureStore 鍵改成 AFTER_FIRST_UNLOCK（只影響 iOS）。
    - App：iOS 本機提醒加數量上限。
    - 後端：APNs sender、路由、資料庫。
- **驗收**：
    - 後端單元測試（假 APNs http2 伺服器）通過。
    - Android FCM 請求快照沒變。
    - `simctl push` 送出的通知會出現，點了開到正確頁。
    - 本機提醒在 1 分鐘後出現。
- **Android 不退步**：FCM 快照、vitest、`server:smoke`。
- **部署**：只合併程式，後端到 M7 才部署。
- **工作量**：約 1.5 天。

### M5：iOS 專屬畫面差異

- **範圍**：更新提示、日記資料夾、帳號刪除文案。
- **流程**：先做整頁 mock（iOS 和 Android 並排），你說「改」才做。
- **內容**：
    - UpdatePrompt、UpdateBanner、UpdateCard 在 iOS 都不出現。
    - app-version.json 維持 Android 格式，只加一個可選的 `ios` 區塊；舊版 App 會忽略它。
    - 日記「鏡射到資料夾」在 iOS 改成「存到檔案」或隱藏。
    - 帳號刪除文案改成兩個平台通用。
- **驗收**：Platform＝ios 的單元測試通過；Maestro 確認開 App 時沒有更新視窗；`verify-install-link.ts` 照舊 PASS。
- **Android 不退步**：UpdatePrompt 在 Android 的行為測試不變。
- **工作量**：約 1 天，含 mock。

### M6：登入（Google iOS 加上用 Apple 登入）

- **前提**：
    - Q3 選了 App Store。
    - 第二輪決定：在你的 GCP/Firebase 帳號建 iOS OAuth client，plist 放進私有 loader。
- **內容**：
    - Google iOS 設定。
    - expo-apple-authentication：Android 端排除自動連結，用 APK 守門確認沒有變大。
    - 後端驗 Apple token，首次登入自動建成員。
    - 登入頁 mock。
- **動到的共用檔**：`package.json`、lockfile。Android 打包下次會重裝依賴，**事先跟你說**，並先確認後端用的是自己的 `C:\w\deps-backend-*`，不共用打包資料夾。
- **驗收**：
    - 模擬器按「Google 登入」會開出 Google 頁面。
    - Apple 按鈕只在 iOS 出現。
    - 後端測試：假 Apple token 的簽章、aud、iss、過期都要檢查到。
- **Android 不退步**：APK 大小差 ≤ 0.1 MB、check-apk-budget PASS、Android 登入頁實機截圖跟現在一樣。
- **工作量**：約 1.5 天。

### M7：TestFlight 真機驗收（付費後）

- **前提**：
    - Q2 已付費。
    - 第二輪決定：EAS 帳號與憑證、APNs key、找 1–2 位有 iPhone 的測試者。
- **內容**：
    - EAS Build 加 Submit。
    - 後端部署 APNs（經同意）。
    - 真機清單：一頁中文，照著做就好。項目包括登入、讀經、背景朗讀、鎖定畫面播放卡、來電中斷、好友推播、聚會提醒、QR 掃描、Face ID（管理員）、日記分享。
- **驗收**：
    - 清單全 PASS，測試者回傳截圖。
    - 比較 App Store Connect 上的安裝大小和 YouVersion 在 App Store 標示的大小。
    - 兩個平台的版本號一起加。
- **工作量**：取決於測試者什麼時候有空。

### M8：App Store 不公開上架（Q3 選 B 時）

- **內容**：隱私標籤、自動截圖、審核備註，然後送審，再申請 unlisted。
- **驗收**：審核通過，unlisted 連結裝得起來。
- **發布**：每一步逐項同意。

## 9. 要光佑決定的事（第 1 輪，3 題）

**Q1：同意在 GitHub Actions 新增一個 secret，放 YouVersion app key，只給 iOS CI 用嗎？**
我建議**同意**，理由有三：

1. 讀經是核心功能，沒有 key 就無法在 iOS 上證明讀經器能用。
2. 這把 key 本來就包在公開發布的 APK 裡：它是 `EXPO_PUBLIC_` 變數，Expo 文件說這類變數會以明文寫進編好的 App。
3. fork 來的 PR 讀不到它，用它建出來的 .app 也不會上傳。

M2 開始時才需要。

**Q2：Apple Developer Program（US$99/年，台幣以結帳畫面為準）要用誰的名義、什麼時候付？**
我建議**用你個人的名義，等 M0–M3 在模擬器上全綠之後再付**。理由：

- 錢要花在已經證明能跑的東西上。
- 個人名義不需要 D-U-N-S 編號，最快。
- 用教會（組織）名義要有 D-U-N-S、法人身分和網域 email，比較慢。
- 免年費資格目前沒看到台灣在內（**未驗證**）。

代價：App Store 上的賣方名稱會是你的法定姓名。M7 才需要。

**Q3：iPhone 使用者最後要怎麼裝？**

- (A) TestFlight 公開連結：先裝 TestFlight App；每 90 天我要重傳一次；第一次要經過測試審核。
- (B) **App Store 不公開上架**：只有拿到連結的人找得到；像一般 App 一樣從 App Store 裝、會自動更新。
- (C) App Store 公開上架。

我建議 **(B)，中間先用 TestFlight 內部測試驗真機**。理由：

- 用平台官方的派送和自動更新，不用再像 Android 那樣自己做更新提示。
- 「只有教會的人拿得到連結」剛好符合使用對象。

代價：(B) 和 (C) 都要加「用 Apple 登入」（M6），也要通過完整審核。

**第二輪（先不用回答，到那個里程碑前再問）**

- 要不要用 Appetize 讓你親手試（要把 App 傳到外部服務）。
- 在你的 GCP/Firebase 建 iOS 登入設定。
- EAS 帳號和 Apple 憑證放在哪裡。
- APNs key 放到後端。
- 誰當 iPhone 測試者。
- 各個 mock：M2 退出按鈕、M5 畫面差異、M6 登入頁。

## 10. 風險與回滾

| 風險 | 對策 |
|---|---|
| Maestro 在 iOS 26.x 不穩 | 一次跑一個 flow，釘 Maestro 版本。driver 啟動失敗自動重跑一次並標示；斷言失敗不重跑。 |
| GitHub 映像升級、把 Xcode 換掉 | 釘 `macos-26` 和 Xcode 26.4.1。只在 PR 或手動時跑，不排定時；映像真的變了再一次性調整。 |
| 模擬器全綠，真機卻壞 | M7 真機清單。模擬器做不到的項目全部列在 §4.4。 |
| Apple 拒絕 unlisted 或審核不過 | 退回公開上架或 TestFlight 外部連結；審核意見逐條修。 |
| 改共用檔讓 Android 退步 | 每個動到共用檔的 PR 都要做 prebuild diff、建候選 APK、跑 check-apk-budget。 |
| lockfile 改動讓 Android 打包重裝依賴（以前曾連帶刪掉後端的套件） | 只有 M6 會改 lockfile。事先告知，並確認後端用自己的依賴資料夾。 |
| 回滾 | 每個里程碑是獨立的 PR，revert 就好。後端 APNs 用既有 cutover 腳本回滾。 |

## 11. 外部事實來源（2026-09-29 當天查證）

「是」表示當天在官方頁面讀到；「未驗證」表示查不到或只找到第三方說法。

| 事實 | 來源 | 當天查證 |
|---|---|---|
| public repo 的標準 GitHub 機器免費、不限分鐘；larger runner 一律收費 | https://docs.github.com/en/billing/concepts/product-billing/github-actions | 是 |
| Free 方案同時最多 5 個 macOS job；每個 job 最長 6 小時 | https://docs.github.com/en/actions/reference/limits | 是 |
| `macos-26` arm64 映像：Xcode 26.4.1、26.5、26.6，iOS 模擬器 26.2、26.4.1、26.5 | https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md | 是 |
| `macos-15` 映像最新只到 Xcode 26.3 | https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md | 是 |
| public repo 的 artifact 可設 1–90 天保存 | https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization | 是 |
| SDK 56 需要 Xcode 26.4、iOS 16.4 | https://expo.dev/changelog/sdk-56 ；本機 `expo/template` 的 `IPHONEOS_DEPLOYMENT_TARGET = 16.4` | 是 |
| EAS 免費方案：每月 15 次 iOS 建置、45 分鐘上限；Maestro job 免費方案不能用 | https://expo.dev/pricing | 是 |
| EAS 模擬器建置不需要 Apple 帳號 | https://docs.expo.dev/build-reference/simulators/ | 是 |
| Maestro 要 Java 17 以上、iOS 只支援模擬器 | https://docs.maestro.dev/get-started/supported-platform/ios.md | 是 |
| Maestro 在 iOS 26.x 的已知問題 | https://github.com/mobile-dev-inc/maestro/issues/3318 ；https://github.com/mobile-dev-inc/Maestro/issues/3137 | 是 |
| Appetize 上傳格式與分享權限 | https://docs.appetize.io/platform/app-management/uploading-apps/ios ；https://docs.appetize.io/platform/sharing-apps.md | 是 |
| Appetize 免費方案的分鐘數 | 官方頁面用 JS 載入，讀不到 | **未驗證** |
| Apple Developer Program US$99/年；組織名義需要 D-U-N-S | https://developer.apple.com/programs/enroll/ | 是 |
| 台幣價格 | 沒有找到官方數字 | **未驗證** |
| 免年費資格（非營利組織）；台灣是否符合 | https://developer.apple.com/help/account/membership/fee-waivers/ | 資格是；台灣**未驗證** |
| 免費帳號不能用推播、TestFlight | https://developer.apple.com/support/compare-memberships/ ；https://developer.apple.com/help/account/reference/supported-capabilities-ios/ | 是 |
| TestFlight 內部 100 人、外部 10,000 人、90 天過期 | https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ | 是 |
| 模擬器能收 sandbox 推播（Xcode 14、Apple 晶片） | https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes | 是 |
| `simctl push` 與 `.apns` 檔 | https://developer.apple.com/documentation/xcode-release-notes/xcode-11_4-release-notes | 是 |
| 背景推播低優先、每小時 2–3 則、App 被滑掉會丟棄 | https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app | 是 |
| APNs JWT 每 20–60 分鐘換一次；要用 HTTP/2 | https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns | 是 |
| FCM iOS 要把 APNs key 上傳到 Firebase；`batchImport` 已淘汰 | https://firebase.google.com/docs/cloud-messaging/ios/client ；https://developers.google.com/instance-id/reference/server | 是 |
| expo-notifications 在 iOS 回傳 APNs token；產生推播憑證需要付費帳號 | https://docs.expo.dev/versions/v56.0.0/sdk/notifications/ ；https://docs.expo.dev/push-notifications/push-notifications-setup/ | 是 |
| App Store 規則 2.5.2、3.2.2、4.8 | https://developer.apple.com/app-store/review/guidelines/ | 是 |
| Unlisted App Distribution | https://developer.apple.com/support/unlisted-app-distribution/ | 是 |
| `EXPO_PUBLIC_` 變數會以明文寫進編好的 App | https://docs.expo.dev/guides/environment-variables/ | 是 |
| 新版 GoogleSignIn iOS 的 token aud 是 server client | 只有第三方說法 | **未驗證** |
| ATS 對 http 連 127.0.0.1 的處理 | 說法互相矛盾 | **未驗證**（M0 實測） |
| iOS 待發本機通知上限 64 個 | 沒有找到官方原文 | **未驗證**（設計上不依賴確切數字） |
