# 朗讀與朗讀跟著走

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

在讀經器裡可以聽朗讀，畫面會跟著念到的那一節走；手指一滑就放開跟隨，按「回到朗讀處」才會回去。

## 從哪裡進

- 讀經器（首頁「讀經」分頁）右下角的圓形播放鍵：播放/暫停/重試這一章的朗讀（`src/ui/FullscreenReaderLayout.tsx` 的 `audioCell`,底層是 `src/ui/ChapterAudioControls.tsx`）。
- 展開閱讀工具列後，右上「更多閱讀工具」裡有「連讀」開關與「朗讀速度」選項（同一檔案的 `更多閱讀工具` 選單，§行為規格「連讀」「速度」）。
- 朗讀開始播放後，左下角會在跟隨放開時出現「回到朗讀處」按鈕。
- 日記分頁也有一顆朗讀鍵（`src/ui/ReaderAudioBridgeButton.tsx`），但它只是遙控器，不會自己開始朗讀，見「與日記朗讀控制的互動」。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 播放/暫停/重試 | 讀經器右下角圓形鍵；載入中顯示轉圈，沒有朗讀顯示喇叭斜線圖示，可重試時顯示重播圖示 |
| 朗讀跟著走 | 播放時畫面自動捲到正在念的那一節，並用底色反白；手指一滑或選字就放開，出現「回到朗讀處」 |
| 連讀 | 開啟後，播完目前章接著念當日剩下的章節，最後一章念完才停 |
| 朗讀速度 | 0.75/1/1.25/1.5 倍，立即套用到正在播放的聲音 |
| 背景與鎖定畫面播放 | 離開讀經器、切到其他分頁、螢幕關閉都繼續念；鎖定畫面/通知欄出現一張可以暫停/倒退10秒/快進10秒的卡片 |
| 日記朗讀遙控 | 日記分頁的播放鍵會操作讀經器裡同一段朗讀，不會另外開一段 |

## 行為規格

### 播放、暫停、重試

來源：`src/ui/ChapterAudioControls.tsx`、`src/domain/chapterAudioContract.ts`、`server/genericChapterAudio.ts`

- 尚未登入 → 播放鍵顯示載入中的無障礙標籤「登入後即可使用朗讀」，不能按（`ChapterAudioControls.tsx` `slotLabel`）。
- 已登入、朗讀來源正在確認 → 顯示轉圈，標籤「正在載入朗讀來源」。
- 這一章確實沒有朗讀（YouVersion 目錄回報「查無此經文的朗讀」，或朗讀為戲劇/合成語音而被排除） → 顯示喇叭斜線圖示，標籤「本章沒有朗讀」，不能重試（`chapterAudioContract.ts` 的 `explicit_no_audio`/`isRetryable` 回傳 false）。
- 查詢暫時失敗（網路、逾時、格式異常、來源已過期需要重新確認） → 顯示「重試」，按下會重新呼叫後端並重新準備播放（`temporarily_unavailable`/`isRetryable` 回傳 true；`retryPlayback()`）。
- 播放中途發生原生播放錯誤（解碼、串流中斷） → 暫停，顯示「朗讀暫時無法播放，請重試。」，並把播放鍵轉成「重試」（`reportPlaybackError`）。
- 播放鍵一律操作同一顆播放器，換章只是換音源，不會整顆重建，所以「播 A → 播 B → 回頭播 A」不會壞掉（`src/services/expoAudioPlayback.ts` 的 ownership 設計，見 `tests/services/chapterAudioOwnership.test.ts`）。
- 切換章節、切換譯本、登出、帳號過期都會捨棄還在進行中的舊查詢結果，不會把舊章節的答案套用到新章節上（`ChapterAudioControls.tsx` 的 selection key/auth epoch 比對）。

### 連讀（連續播放到下一章）

來源：`src/services/readerAutoplayController.ts`、`src/services/readerAutoplayPreferences.ts`、`src/ui/YouVersionReader.tsx`

- 「更多閱讀工具」裡的「連讀」開關，預設開啟，依登入的會員各自記住（`readerAutoplayPreferences.ts`,SecureStore,每位會員一組鍵）。
- 開啟連讀只是設定，不會自己開始播放；播放仍要按播放鍵（`更多閱讀工具` 選單裡的說明文字：「切換設定不會立即播放」）。
- 開著連讀播放完一章 → 自動切到當日排定的下一段並開始播放；最後一段念完就停止，不繼續往後翻章（`readerAutoplayController.ts` 的 `onEof`）。
- 自動切到的下一章沒有朗讀 → 停止連讀，顯示提示「這一章沒有朗讀，已停止連續播放。」（`handleAutoplayUnavailable`）。
- 自動播放途中發生播放錯誤 → 停止連讀，顯示「朗讀暫時無法播放，已停止連續播放。」（`handlePlaybackError`）。
- 手動暫停、手動換到別的章節/日期/譯本、登出都會直接取消目前的連讀意圖（`cancelAutoplay` 在對應 effect 被呼叫）。
- 連讀只在「今日排定經文」之間前進；自由瀏覽（未排定的章節）沒有下一段可連，播完就停。

### 朗讀速度

來源：`src/services/readerSpeedPreference.ts`、`src/ui/ChapterAudioControls.tsx`、`src/ui/FullscreenReaderLayout.tsx`

- 可選 0.75、1（預設）、1.25、1.5 倍，在「更多閱讀工具」的「朗讀速度」列選擇。
- 選擇會立即套用到正在播放的聲音，不用重新開始這一章（`playbackRate` 直接寫進活著的播放器）。
- 音調不會跟著變快變高（`shouldCorrectPitch = true`,加速後聲音仍像正常說話，不是卡通音）。
- 已登入會員的速度選擇會記住，下次開讀經器維持同一速度；未登入或儲存失敗時，速度仍會套用在這次播放，只是不會被記住（`readerSpeedPreference.ts` 的 `update()`/`getSpeed()` 對 `memberId === null` 的處理）。

### 背景與鎖定畫面播放

來源：`src/services/chapterAudioStartup.ts`、`src/services/chapterAudioBackground.ts`、`src/ui/ChapterAudioControls.tsx`

- App 啟動時就把播放模式設成「背景可播放、不與其他 App 混音、靜音模式下也出聲」（`CHAPTER_AUDIO_MODE`），所以離開讀經器分頁、切到公告/積分/日記分頁、螢幕關閉，朗讀都繼續。
- 開始朗讀後，鎖定畫面與通知欄出現一張卡片：標題是章節（例如「約翰福音 3 章」），副標是譯本名稱，可以暫停/繼續、倒退10秒、快進10秒。
- 卡片會一直留到朗讀真的結束（登出、切到沒有朗讀的章節、這個播放器被收掉）才收掉；單純暫停不會讓卡片消失，方便從通知欄繼續聽。
- 只有讀經器頁面自己這一份播放器會開卡片；日記分頁的朗讀鍵操作的是同一份，不會開出第二張卡片。
- App 切到背景時，畫面上的進度條與朗讀反白停止更新（省電），回到前景那一刻會用播放器目前的真實位置重新對齊一次(`chapterAudioResolver.ts` 的 `verseAtPosition`/`hiddenRef`/`resyncOnShow`)。

### 朗讀跟著走：跟隨捲動與反白

來源：`src/ui/readAlongBridge.ts`、`src/ui/readAlongFollow.ts`、`src/ui/FullscreenReaderLayout.tsx`、設計文件 `docs/superpowers/plans/2026-09-29-read-along-follow.md`

- 開始朗讀 → 從跟隨狀態開始：念到哪一節，那一節（或那一段合併節）就反白。
- 跟隨中，念到的那一節接近可讀區下方時（進入可讀區下 1/4），畫面會捲一次，把那一節拉到可讀區上方 1/3 處；比可讀區還高的長段落則貼齊可讀區上緣。
- 手指在經文上拖動超過約 10px（不論方向）→ 立刻放開跟隨，朗讀與反白照常繼續，畫面不再自己捲。
- 點選經文做複製/分享等動作 → 同樣視為手動，放開跟隨。
- 放開跟隨後，左下角出現「回到朗讀處」按鈕；按鈕的箭頭指向朗讀位置：目前朗讀節在畫面上方顯示 ↑,在下方顯示 ↓,若剛好在畫面內則不畫箭頭。
- 停手不動、或暫停朗讀後再按播放，都**不會**自動恢復跟隨，必須按「回到朗讀處」。
- 按「回到朗讀處」→ 捲到正在念的那一節（可讀區上方 1/3），恢復跟隨，按鈕消失。
- 朗讀念完、或換到另一章 → 按鈕消失，狀態重置；下一次開始朗讀（同一章重播或新章節）一律從跟隨狀態開始。
- 設定裡開啟「減少動態」（iOS 減少動態/Android 移除動畫）→ 捲動改成直接跳過去，不做平滑動畫。
- 「合併節」處理：一節經文的反白與捲動都以「整段」為單位，例如詩105:5-6 這種一格顯示兩節經文的情況，朗讀念到第5節或第6節都會反白整段 5-6,不會出現「念到6節卻沒有反白」的情況（`readAlongBridge.ts` 的 `holds()`/`units()`；根因與修法見設計文件 §2、§3.1）。
- 反白顏色與 YouVersion 官方閱讀器的朗讀反白相同，但改由 App 自己的注入程式上色，不再借用 SDK 使用者標記的管道（避免合併節反白失敗）；使用者自己畫的標記仍然可見，只在念到那一節時被暫時蓋掉。
- 程式自己觸發的捲動不會誤觸「往下滑動收合工具列」的機制，也不會誤觸「往上滑動展開工具列」（`src/ui/readerSettingsBridge.ts` 的 `READER_CANVAS_BRIDGE` 讀取 `window.__qingmuFollowScrolling`）。
- 換章、字級或版面改變造成的捲動不會被誤判成手指滑動：只有真正的觸控拖動或選字才會放開跟隨。

### 找不到朗讀 / 離線 / 沒有朗讀時

來源：`server/genericChapterAudio.ts`、`src/domain/chapterAudioContract.ts`

- 後端一律代表 App 去問 YouVersion 的朗讀目錄；找不到這一章的朗讀、目錄回應異常、逾時或格式不對，都不會讓 App 崩潰，而是回報成「暫時無法取得」或「沒有朗讀」兩種之一，由播放鍵的文案分開處理（見上「播放、暫停、重試」）。
- 後端有快取，同一章同一版本一天內只需重新跟目錄確認一次；快取結果不會超過來源自己聲明的有效期。
- 朗讀網址只接受 `https://` 開頭、格式正確的網址，本機檔案、`data:`、`javascript:`、不安全的 `http://` 通通會被擋下，絕不會被拿去播放（`chapterAudioContract.ts` 的 `isApprovedStreamUri`）。
- 這一章的朗讀來源如果已經過了 App 自己設的重新確認期限，即使當時能播，也會先重新跟後端確認一次才能繼續播放/倒帶，但不會因此把正在播的聲音停掉（過期只擋「開始/跳轉」，不擋「停止」）。

## 決定（為什麼這樣做）

**刻意不做：**

- **連讀不會自動完成、不自動得分，也不會跳到別天**：只照今天排定的順序往前播，最後一段念完就停，不是自動打卡機制。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「連讀」）
- **停手不動、或暫停後再按播放，都不會自動恢復跟隨**：一定要按「回到朗讀處」，刻意不做「跟著跟著自己又跳走」的效果。（來源：[../superpowers/plans/2026-09-29-read-along-follow.md](../superpowers/plans/2026-09-29-read-along-follow.md) §1）
- **日記頁的朗讀鍵不會自己開始播放，只是同一段朗讀的遙控器**：讀經和日記來回切換時，同一段朗讀不能中斷。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「日記」）

- **播放鍵的版位固定 48×48dp，不管載入中/可播放/沒有朗讀是哪個狀態，位置都不跳動**：也不會因為顯示說明文字而推走旁邊的按鈕，避免畫面閃動。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL12、§4.6）
- **朗讀反白改由 App 自己的注入程式上色，不再借用 SDK 使用者標記的管道**：SDK 用 `parseInt(v)` 判斷節號，「5-6」這種合併節會被當成「5」，找不到第 6 節而整段不反白。（來源：[../superpowers/plans/2026-09-29-read-along-follow.md](../superpowers/plans/2026-09-29-read-along-follow.md) §2、§3.1）

## 平台差異

來源：`docs/superpowers/plans/2026-09-29-read-along-follow.md` §3.5、`AGENTS.md`

| 項目 | 說明 |
|---|---|
| 邏輯程式碼 | 朗讀、跟隨捲動、反白、連讀、速度全部是同一份程式，沒有 `Platform.OS` 分支；WKWebView（iOS）與 Android WebView 都支援同一套觸控/捲動/`MutationObserver` 機制 |
| 真機驗證現況 | Android 已用真機腳本（`follow_check.py`,0.5.21 測試版）驗證過反白、跟隨捲動、放開/恢復跟隨、暫停不跳位、選字放開等情境；iOS 目前只跑到模擬器層級的建置與資源預算檢查，「手指滑動＋朗讀反白」的真機驗證要等 YouVersion 金鑰進 CI 且測試音檔含逐節時間後才能自動化，目前列為已知殘餘（見設計文件 §6.4、下方「已知限制」） |
| 背景/鎖定畫面卡片 | 由 `expo-audio` 統一實作，兩平台都出現同一種可暫停/倒退/快進的卡片；平台原生外觀（notification shade vs 鎖定畫面）由系統決定，App 不特別分支 |

## 資料與後端

- 朗讀來源由後端 `server/genericChapterAudio.ts` 向 YouVersion 的朗讀目錄端點（`https://audio-bible.youversionapi.com/3.1/chapter.json`）查詢，回傳一份「這個版本、這一章有沒有朗讀、網址、出版者、每節時間」的結果（`ContentCapability`）。
- 逐節時間（`verseTiming`）用來驅動朗讀反白：`verseTimingOf()` 認得單節（`PSA.105.5`）、連續範圍（`PSA.105.5-6`）與合併記法（`PSA.105.5+PSA.105.6`）三種寫法，對不上這一章格式的資料會直接丟棄，不會亂猜。
- App 端 `src/domain/chapterAudioContract.ts` 的 `validateCapability()` 是唯一信任邊界：確認回應真的是「當時問的那個版本、那一章」，確認沒有過期，確認網址是核准的 `https` 串流，確認有出版者資訊，才會讓這份資料進到播放器；任何一項不符都不會播放。
- 播放本體用 `expo-audio`（Expo 內建），不是自寫的解碼器；App 只負責 play/pause/seekBy/setRate/setSleepTimer 這幾個動作，進度與時間一律讀播放器本身的即時狀態，不用計時器模擬。
- 朗讀是否對外開放播放，由部署端環境變數控制（是否已取得授權）；`src/services/audioChapterResolver.ts` 保證來源一律標明出版者與版本，不會用別的版本朗讀冒充目前章節。

## 守住它的測試

- `tests/domain/chapterAudioContract.test.ts` — 朗讀來源驗證邊界：身分比對、過期、網址、出版者四個守門條件。
- `tests/server/genericChapterAudio.test.ts` — 後端朗讀查詢端點的整體行為（含快取、格式錯誤、404）。
- `tests/server/genericChapterAudioTiming.test.ts` — `verseTimingOf` 認得合併節/連續節寫法，對不上就丟棄。
- `tests/services/chapterAudioBackground.test.ts` — 背景播放模式設定與鎖定畫面卡片素材。
- `tests/services/chapterAudioOwnership.test.ts` — 播放器換章不整顆重建，A→B→A 不會壞掉。
- `tests/services/chapterAudioSelection.test.ts` — 播放的一定是當前請求的那個版本/章節，不會有殘留的舊限制。
- `tests/services/readerAutoplayController.test.ts` — 連讀的狀態機：開始、換下一章、停止、取消。
- `tests/services/readerAutoplayPreferences.test.ts` — 連讀開關按會員儲存/讀取，含讀寫失敗處理。
- `tests/services/readerSpeed.test.ts` — 朗讀速度的允許值、預設值、按會員儲存/讀取。
- `tests/expoAudioPlayback.test.ts` — 播放器包裝層（play/pause/seek/setRate/睡眠計時）對真實播放器狀態的行為。
- `tests/audioChapterResolver.test.ts` — 章節音訊來源解析（QA 來源限定單章、正式授權來源）。
- `tests/integration/chapterAudioAuthenticatedRoute.test.ts` — 朗讀查詢必須帶正確登入身分，身分失效即失效。
- `tests/integration/chapterAudioCapabilityRoute.test.ts` — 朗讀查詢 API 的請求/回應合約。
- `tests/integration/chapterAudioIdentityWiring.test.ts` — 播放內容與畫面上的章節/版本身分一路對齊，不會串台。
- `tests/server/chapterAudioCapability.test.ts` — 朗讀目錄查詢不會被拿去冒充別的章節、過期即拒絕。
- `tests/ui/chapterAudioContinuousPlayback.test.ts` — 朗讀反白訊息與 EOF（播完）交接。
- `tests/ui/chapterAudioReplay.test.ts` — 來源過期後的重試與原生播完（EOF）同時發生時只處理一次播放意圖。
- `tests/ui/chapterAudioLockScreen.test.ts` — 系統媒體卡片的顯示/更新/收回時機。
- `tests/ui/chapterAudioBackgroundWork.test.ts` — App 切到背景時停止不必要更新、回前景重新對齊進度與反白。
- `tests/ui/chapterAudioStableSlot.test.ts` — 播放鍵在各狀態間切換時，畫面版位維持穩定不跳動。
- `tests/ui/readerAudioSelectionWiring.test.ts` — 從真實 ReaderScreen 到播放請求的整條串接，含換日期/換版本情境。
- `tests/ui/readerAutoplayNativeFlow.test.ts` — 連讀在真實 Reader 畫面上的完整流程。
- `tests/ui/youVersionReaderAutoplay.test.ts` — `YouVersionReader` 對連讀意圖與朗讀反白的轉發。
- `tests/ui/readAlongFollow.test.ts` — 跟隨狀態機（§3.2 每一條規則，含「暫停再播放不恢復」「念完恢復」）。
- `tests/ui/readAlongBridge.test.ts` — 注入程式在真瀏覽器（chrome-headless-shell）裡的反白、跟隨捲動、手勢放開、位置回報。
- `tests/ui/readAlongScreen.test.ts` — 從真實 ReaderScreen 到「回到朗讀處」按鈕、箭頭方向、選字放開的整條串接。
- `tests/ui/fullscreenReaderLayout.test.ts` — 讀經器版面與工具列，含「回到朗讀處」按鈕與其他浮動按鈕的版位互不遮擋。
- `tests/ui/readerImmersionBridge.test.ts` — 程式自己捲動不會誤觸工具列收合/展開。
- `tests/services/sdkPlayingVerseExtension.test.ts` — YouVersion SDK 的 patch：朗讀狀態改走專屬 DOM 屬性，不再借用使用者標記管道。

## 相關文件

- 設計與驗證計畫：[docs/superpowers/plans/2026-09-29-read-along-follow.md](../superpowers/plans/2026-09-29-read-along-follow.md)（跟隨捲動規格、5-6 合併節不反白的根因、驗證結果；本文件只取其現行行為，不重複其執行流程）。
- 版面規則：`docs/design/reader-page.md`（讀經器整體版面 Layout A,朗讀鍵與「回到朗讀處」按鈕在其中的固定位置）。

## 已知限制與待辦

- iOS 上「手指滑動放開跟隨」與「朗讀反白」的真機驗證還沒有自動化流程，要等 YouVersion 金鑰進 CI、且測試音檔含逐節時間後才能補上 Maestro 流程；目前只能等 TestFlight 真機驗收時人工確認（設計文件 §6.4）。
- 同一版本重灌 App 後第一次開啟，讀經入口頁偶爾停在空白（需要手動切一次分頁才會恢復）；這與朗讀功能本身無關，已另開問題追蹤，不在本文件範圍內（設計文件 §6.5「另外發現」）。
- 待確認：正式環境目前是否已對一般使用者開放朗讀（`EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED` 的正式部署值),本文件不記錄維運設定，只記錄程式碼支援的行為。
