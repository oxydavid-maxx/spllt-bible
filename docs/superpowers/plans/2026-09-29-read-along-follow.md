# 朗讀跟著走＋合併節反白：執行與驗證計畫（2026-09-29）

> **狀態：光佑 2026-09-29 核准，開工。** Part of #23：跟 iOS 同等移植一起進版，兩個平台共用同一份程式（見 `2026-09-29-ios-parity.md` §2.1、§8 F1）。
> 討論用 mock：`/private/jhuke-read-follow-mock-0929/`（維護者私人頁面）。

## 0. 一句話

朗讀時，畫面跟著念到的那一節走。手指一滑就停止跟隨，左下角出現「回到朗讀處」，按了才回去。同時修掉「5-6 這種合併節不反白」。

## 1. 規格（光佑核准版）

| 情況 | 行為 |
|---|---|
| 開始朗讀 | 跟隨中：念到的那一節反白。快到可讀區下方 1/4 時捲一次，把它拉到可讀區上方 1/3（Q3） |
| 手指滑動經文 | 立刻停止跟隨。朗讀、反白照常，畫面不再自己捲 |
| 點經文選取（複製、分享） | 也算手動，停止跟隨 |
| 停止跟隨時 | 左下角出現「回到朗讀處」。箭頭指向朗讀位置：在上面 ↑、在下面 ↓，在畫面內不畫箭頭 |
| 按「回到朗讀處」 | 捲到正在念的那一節（上方 1/3），恢復跟隨，按鈕消失 |
| 停手幾秒 | **不會**自動回去（Q1） |
| 暫停後再按播放 | **不會**自動回去，還是要按「回到朗讀處」（Q2，光佑：「不要換地方」） |
| 念完、換章、沒有朗讀 | 按鈕消失。下一次朗讀從跟隨開始（新的一章從頭跟隨） |
| 手機開「減少動態」 | 直接跳過去，不做平滑動畫 |

## 2. 5-6 不反白的根因（已查證）

- 和合本女聲版（version 46）詩 105 的時間表：`PSA.105.5` 只有 0.007 秒，5-6 那一整段記在 `PSA.105.6`（`audio-bible.youversionapi.com/3.1/chapter.json`，2026-09-29 實抓）。
- 經文 HTML 由後端 `server/officialBibleAdapter.ts` 產生，合併節的標記是 `<span class="yv-v" v="5-6">`（`verseId()` 把 `PSA.105.5+PSA.105.6` 轉成 `5-6`）。
- 現在的反白借用 SDK 的使用者標記管道（`mergePlayingVerseHighlight` → `PSA.105.6`），SDK 上色用 `parseInt(v)`，把「5-6」當成 5 → 第 6 節找不到元素，所以不反白。
- 同類：當代譯本（1392）把合併節寫成一筆 `PSA.105.5+PSA.105.6`，`server/genericChapterAudio.ts` 的 `verseTimingOf` 看不懂就丟掉，結果念 5-6 時反白停在第 4 節。

## 3. 設計

### 3.1 資料流

```
ChapterAudioControls --verse N (timing)--> YouVersionReader --playingVerse, follow, followRequest-->
  native BibleReader (expo-ui patch) --DOM props--> BibleReaderDOM: <html data-qingmu-*>
    --> 注入程式 read-along（src/ui/readAlongBridge.ts）
          1. 反白「包含 N 的那一段」（所有 v 範圍含 N 的 .yv-v，一節跨段時有好幾個）
          2. 跟隨中：出了可讀帶就捲
          3. 手指拖動（touchmove 超過 10px）→ postMessage follow.release
          4. 不跟隨時：回報朗讀位置 above / below / visible（有變才送）
  <-- onMessage -- YouVersionReader --> useReaderChrome 的跟隨狀態 --> FullscreenReaderLayout 的按鈕
```

- 反白改成單一負責者：注入程式用 class `qingmu-playing` 上色，顏色公式與 SDK 相同（`#d5ddd8` 以 `--yv-highlight-mix-p` 混 `--yv-background`，`!important` 蓋過使用者標記，跟以前一樣「念到時暫時蓋掉」）。`mergePlayingVerseHighlight` 不再使用（刪除），使用者標記管道只放使用者標記。
- 找段落用一個函式：`v` 解析成範圍（`5-6` → 5..6、`7` → 7..7），反白與捲動共用。

### 3.2 狀態（誰擁有）

| 狀態 | 擁有者 | 規則 |
|---|---|---|
| `following` | RN `useReaderChrome`（純函式 reducer `src/ui/readAlongFollow.ts`） | 初始 true。收到 release 或選取經文、而且有朗讀位置時 → false。按鈕 → true。朗讀位置變成沒有（念完、換章）→ true。播放/暫停不動它 |
| `followRequest` | 同上 | 每按一次按鈕 +1；DOM 看到變化就捲（不管在不在帶內） |
| `position` | DOM 回報，RN 存 | 只在 `following=false` 時有意義，決定箭頭 |
| 按鈕顯示 | 推導 | `!following && playingVerse !== null && !verseSelected && !sheetOpen` |

### 3.3 捲動規則

- 可讀帶：上緣 = 閱讀頁頂部覆蓋工具列的高度（`insets.top`），下緣 = 視窗高 − `insets.bottom`。
- 跟隨中，段落底 > 可讀帶的 75%，或段落頂 < 可讀帶上緣 → 把段落頂捲到可讀帶上方 1/3。段落比 2/3 可讀帶還高時，頂端對齊可讀帶上緣。
- 程式自己捲的時候設一個標記，工具列收合的程式（`READER_CANVAS_BRIDGE`）看到標記就只更新基準點，不收合、不展開。到章末的 edge 回報照常（「繼續讀下一段」卡片照常出現）。
- 不用計時輪詢：只靠屬性變化（MutationObserver）、觸控與捲動事件，閒置 CPU 不增加。

### 3.4 後端

`verseTimingOf` 接受連續的 `BOOK.C.a+BOOK.C.b`（和 `BOOK.C.a-b`），記成第 a 節、用那一筆的起訖時間。舊版 App 也受益（`parseInt('5-6')=5`）。向下相容，不改回應格式。

### 3.5 兩個平台

全部是共用程式，不需要 `Platform.OS` 分支。WKWebView 與 Android WebView 都支援 touch 事件、`scrollTo({behavior})`、MutationObserver。「減少動態」由 RN 的 `AccessibilityInfo.isReduceMotionEnabled()` 傳入，不依賴 WebView 的 media query。

## 4. 檔案

| 檔案 | 改什麼 |
|---|---|
| `server/genericChapterAudio.ts` | `verseTimingOf` 認得 `a+b`、`a-b` |
| `src/ui/readAlongBridge.ts`（新） | 注入程式：找段、反白、跟隨捲動、手勢、位置回報；訊息解析 |
| `src/ui/readerSettingsBridge.ts` | 兩種模式都帶上 read-along 程式；工具列收合程式忽略程式捲動 |
| `src/ui/readAlongFollow.ts`（新） | 跟隨狀態 reducer |
| `src/ui/FullscreenReaderLayout.tsx` | `useReaderChrome` 加跟隨狀態；左下「回到朗讀處」按鈕 |
| `src/ui/YouVersionReader.tsx` | 把 follow / followRequest / reduceMotion 傳給 BibleReader；收 release / position 訊息；回報有沒有朗讀位置 |
| `app/(tabs)/reader.tsx` | 接線 |
| `patches/@youversion+platform-react-native-expo-ui+1.5.0.patch` | native 傳 `qingmuPlayingVerse` 等 DOM props、不再合併進 highlights；DOM 端寫到 `<html data-qingmu-*>`；README 補說明。用 patch-package 重產，保留 M0 的 `useColorScheme` |
| 測試 | 見 §5 |
| `docs/superpowers/plans/2026-09-29-ios-parity.md` | §8 加 F1 指到本檔 |

## 5. 執行步驟（每步先紅後綠）

| 步 | 先寫會失敗的測試 | 改到通過 |
|---|---|---|
| S1 後端 | `tests/server/genericChapterAudioTiming.test.ts`：`PSA.105.5+PSA.105.6` → 第 5 節；`PSA.105.5-6` → 第 5 節；不連續、跨章的照樣丟 | `verseTimingOf` |
| S2 注入程式（真瀏覽器） | `tests/ui/readAlongBridge.test.ts`（chrome-headless-shell，SDK 樣式＋SDK 捲動容器，45 節含 `v="5-6"`）：念 6 → 5-6 反白；念 5 → 同一段；念 7 → 7 反白、5-6 清掉；跟隨中念到帶外 → 段落頂落在可讀帶 1/3（±2px）；不跟隨 → 不捲、回報 below；touchmove 超過 10px → 送一次 release；程式捲動不讓工具列收合 | `readAlongBridge.ts`、`readerSettingsBridge.ts` |
| S3 SDK 外殼 | `tests/services/sdkPlayingVerseExtension.test.ts` 改寫：native 把 playingVerse 當 DOM prop 傳、highlights 原樣傳；DOM 端寫 `data-qingmu-*`；`noReactNativeWildcard` 仍過 | 改 node_modules 後 `npx patch-package @youversion/platform-react-native-expo-ui` |
| S4 狀態 | `tests/ui/readAlongFollow.test.ts`：§3.2 每條規則（含「暫停再播放不恢復」「沒有朗讀時滑動不放開」「念完恢復」） | `readAlongFollow.ts` |
| S5 畫面接線 | `tests/ui/readAlongFollowButton.test.ts`（react-test-renderer）：不跟隨＋有朗讀 → 左下出現「回到朗讀處」，箭頭依 position；按下 → followRequest +1、按鈕消失；選取經文 → 不跟隨；YouVersionReader 收到 release/position 訊息會叫到對應 callback | FullscreenReaderLayout、YouVersionReader、reader.tsx |

## 6. 驗證

### 6.1 本機（FOCUS → RC）

- 每步只跑自己的測試（FOCUS）。全部組好後：`npm run typecheck`＋改到的測試檔＋鄰近（`readerImmersionBridge`、`fullscreenReaderPadding`、`sheetBackdrop`、`noReactNativeWildcard`、`sdkReaderRecovery`、`sdkReaderSettingsExtension`）。
- vitest 全套交給 CI 的 `unit`（ubuntu），結果跟 base（feat/ios-push）的失敗集合比，不能多。

### 6.2 雲端（PR 三個都要綠）

| workflow | 這次看什麼 |
|---|---|
| `unit` | 全套 vitest；失敗集合不多於 base |
| `android` | APK 守門；大小 ≤ main 的 1.002 倍；原生設定差異為 0 行 |
| `ios` | 模擬器 Release 建置、守門、既有 Maestro 流程；首頁閒置 CPU ≤3%、記憶體 ≤350 MB、閒置網路 0 |

### 6.3 Android 實機（光佑的手機，`adb install -r`，只跑腳本回 PASS/FAIL）

`follow_check.py`：本機用正式簽章建一顆（不發布），用詩 105（9/29 的讀經）：

| # | 檢查 | PASS 條件 |
|---|---|---|
| 1 | 裝上並開啟 | 版本是這次的建置 |
| 2 | 5-6 反白 | 播到 29–41 秒時，「5-6」那段有反白底色（截圖取像素，反白色像素數超過門檻） |
| 3 | 跟隨捲動 | 念到第 12 節以後，畫面自己捲過，反白一直在可讀帶內 |
| 4 | 手指一滑就停 | `input swipe` 後 2 秒內出現「回到朗讀處」；之後 20 秒畫面不自己捲 |
| 5 | 暫停再播放 | 按鈕仍在，畫面不動（Q2） |
| 6 | 按回到朗讀處 | 按鈕消失，反白回到可讀帶上方 |
| 7 | 選取經文 | 出現「回到朗讀處」（被選取面板擋住時，關掉面板後出現） |
| 8 | 收尾 | 暫停、回桌面；不改音量等設定 |

媒體音量維持 0（不改設定），播放照常進行，只是沒有聲音。

### 6.4 iOS

- CI `ios`：建置、守門、既有流程、資源預算全綠。
- 注入程式在 WebKit 的行為：S2 的測試若能在本機 Playwright WebKit 跑，就兩個引擎都跑；跑不了就記為殘餘。
- **殘餘（誠實列出）**：iPhone 上真的手指滑動與朗讀反白，要等 YouVersion 金鑰放進 CI（ios-parity Q1），而且 fixture 要有帶逐節時間的測試音檔，才能寫 `1x-reader-follow` 的 Maestro 流程；否則留到 M7 TestFlight 真機驗收，加一條「朗讀跟著走」。

## 7. 發版（不在這個 PR）

- 合併、部署、發布都由光佑逐項同意。
- 這串 iOS PR 是在 0.5.20 之前開的分支，併進 main 前要先 rebase 到最新 main（iOS 工作階段負責整串，本 PR 跟著 rebase）。
- 發版時：後端（`verseTimingOf`）照 `.handoff` 的換版腳本部署；App 兩個平台同一版號。

## 8. 回滾

- App：revert 本 PR 即回到「反白不捲動」。
- 後端：`verseTimingOf` 只多認兩種寫法，舊資料照舊；revert 不影響資料庫。

## 9. 風險

| 風險 | 處理 |
|---|---|
| SDK 換章時自己捲到頂，被誤判成手動 | 手動只認觸控拖動，不認捲動事件 |
| 字級改變、內容重排造成的捲動 | 同上，不會放開跟隨；跟隨中下一次換節會重新對齊 |
| 程式捲動讓工具列收合 | 程式捲動期間工具列程式只更新基準點 |
| 使用者標記被蓋 | 跟以前一樣只在念到那一節時暫時蓋掉 |
| 跟 iOS 分支衝突 | 疊在 feat/ios-push 上；iOS 工作階段 rebase 前會通知 |
