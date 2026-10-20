# 讀經頁

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

讀經頁用 YouVersion 官方 SDK 顯示今天指定的經文（或自由選的其他章節），提供換譯本、調字體、選經節複製、沉浸式閱讀、章節載入失敗重試，並記住每個帳號每天讀到哪裡。

## 從哪裡進

底部 tab「讀經」（`app/(tabs)/today.tsx`）：每次這個 tab 拿到焦點，畫面會先把「目前選中的讀經日期」設回今天（`taipeiDate()`），再導向 `/reader`（`router.replace`）。實際畫面由 `app/(tabs)/reader.tsx` 渲染；`/reader` 這條路由本身不出現在底部 tab（`href: null`），且設定 `freezeOnBlur: false`，所以切到公告、積分、日記等其他 tab 時讀經頁仍留在原地，不會被卸載（`app/(tabs)/_layout.tsx`）。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 指定/自由閱讀 | 頂端章節籤顯示今天的指定範圍，目前那一段反白；點其他籤直接換、點自己那一籤或「選擇其他章節」可自由換書卷/章 |
| 譯本選擇 | 更多閱讀工具 → 選擇譯本：5 個版本，依繁體中文/English 分組 |
| 字體設定 | 更多閱讀工具 → 調整字體：官方字體大小/字型/行距面板 |
| 經節複製 | 選取經文出現複製按鈕，寫入剪貼簿並可帶入日記引句 |
| 沉浸模式 | 往下捲收起工具列；往上捲一段/到章首/到章尾/按返回鍵/點收合細條會叫回 |
| 內容預先載入 | 背景先抓今天每一段經文內容，換章不用等 |
| 閱讀位置記憶 | 每個帳號、每天分別記住讀到哪一段/哪一章 |
| 載入失敗與重試 | 章節或閱讀器本身載入失敗時顯示中文錯誤卡＋重試按鈕；回到前景/切回讀經 tab 會自動再試一次 |
| 在 YouVersion 開啟 | 更多閱讀工具 → 在 YouVersion 開啟此章，用外部連結打開同一章 |
| 版本資訊 | 更多閱讀工具 → 版本資訊：顯示譯本名稱/出版單位/版權聲明 |
| 日期切換與完成 | 頁首日期列與右下完成圓圈存在於本頁，規則見 [reading-plan.md](reading-plan.md) |
| 靈修分頁 | 章節籤最後一個「靈修」(葉子圖示)：傳道當天的靈修文、段落標題和詩歌 |
| 完成圈 | 右下角依序是葉子、書、▶；兩顆完成圈未完成是白底深綠框，完成後填滿深綠、白圖示 |
| 接續靈修 | 預設關；自行打開後，經文念完接著念靈修和播詩歌 |

## 行為規格

### 進入與掛載

- 每次「讀經」tab 被點擊而拿到焦點，選中日期一律重設為今天，並導向 `/reader`（`app/(tabs)/today.tsx`）。
- `/reader` 不在底部 tab bar 顯示，但讀經頁的所有畫面都由它渲染；它設定 `freezeOnBlur: false`，所以離開這個 tab 不會卸載這個畫面（`app/(tabs)/_layout.tsx`、`app/(tabs)/reader.tsx`）。

### 指定範圍 vs 自由閱讀（`app/(tabs)/reader.tsx`）

- 當天有排定讀經時，預設顯示第一段指定經文；沒有排定時，預設自由閱讀約翰福音 1 章（`initialSelection`）。
- 點頁首章節籤中「非目前那一籤」會直接切到那一段指定經文（記為 `ASSIGNED`）；用「選擇其他章節」或官方書卷/章節選單換到不在今天範圍內的書卷/章，記為「自由閱讀」（`FREE`），並記住那個位置，不影響今天的指定範圍本身。
- 「回到指定範圍」（`returnToAssignedRange`）與再次點「讀經」tab 且判定要重置到指派起點時（`todayReaderTabPressResetToAssignedStart`），都會把選擇重設回第一段指定經文；後者只在登入身分、日期都跟當初觸發的一致，且不是仍在「同一天再次點讀經」的情形下才會覆蓋現有選擇。
- 未登入（訪客）時不記住/讀取任何位置，選擇只存在畫面狀態中，離開就消失。

### 每日半章經文與錄音

- 計畫參照帶節數 (例如 `PSA.119.89-176`、`PSA.119.1-88`、`ACT.7.1-29`) 時，只顯示排定的經節、它們的段落和標題；進入時從範圍第一節開始。整章參照和自由閱讀維持整章。
- 起點不是第 1 節時，經文上方顯示「詩篇 119:89–176 · 看整章」；未到章末時，最後一節後顯示「今天讀到第 88 節」，下方「看整章 ›」。書卷、章與節數依當天範圍產生。
- 點「看整章」恢復整章並盡量保留眼前閱讀位置；換日期、章節或譯本後回到指定範圍。展開只影響閱讀，錄音仍讀當天排定範圍。
- SDK 的合節 (例如 `v="5-6"`) 是不可拆的經文單位，只要與指定範圍重疊便保留整段；同一節跨多段時全部保留。不改寫正文、不按字數猜節界。
- 錄音來源具備範圍首節/末節的 `verseTiming` 時，播放前先跳到首節 `start`，到末節 `end` 停止，走原本的章末完成事件。因此接續讀經與接續靈修仍依原設定執行。暫停繼續保留範圍內位置，念完後再按播放重讀該範圍。
- 錄音沒有可用的首尾分節時間時，播放整章，經文上方顯示「這段錄音沒有分節，會從頭播整章」。不借用其他譯本或章節的時間。整章參照不顯示此提示。
- 朗讀反白與跟隨仍由原本的 read-along bridge 負責，範圍外不反白；完成鈕依裁切後內容的底部判定，仍由使用者手動完成當天，不因錄音念完自動打卡。
- 經文仍由 YouVersion SDK 查整章與轉成 DOM。原生 `passageRange` prop 經 SDK 補丁傳到 `data-qingmu-passage-range`，`src/ui/partialChapterBridge.ts` 再處理顯示；SDK 非同步換內容後重新套用。此 DOM bridge 不發網路請求，也沒有常駐計時器。

### 章節導覽與章節籤（`src/ui/FullscreenReaderLayout.tsx`）

- 一般（未收合）狀態：頁首依序是日期列（‹ 上一個排定讀經日 · 今天日期 · 下一個排定讀經日 ›，規則見 [reading-plan.md](reading-plan.md)）與章節籤列。章節籤列列出今天每一段指定經文各一個籤，目前那一段反白；沒有排定時只顯示一個「自由閱讀：《書卷章節》」籤。籤列右側是「更多閱讀工具」按鈕。
- 點目前反白的那一籤＝打開官方「選擇其他章節」選單；點其他籤＝直接切換到那一段。
- 讀完當天最後一段、且尚未完成、且沒有其他遮擋時，右下角原本圓形的完成按鈕就地展開成「○ 完成今日讀經」文字按鈕（`completionExpanded`）；章尾同時出現「繼續讀 下一段 ›」卡片，點下去換到下一段指定經文。這兩個按鈕跟隨完成/連讀邏輯，完整規則見 [reading-plan.md](reading-plan.md)。

### 沉浸模式與工具列收合（`src/ui/FullscreenReaderLayout.tsx`、`src/ui/readerSettingsBridge.ts`、`src/ui/readerImmersionState.ts`）

- 所有工具（頁首、章節籤、右下 ○▶、底部提示卡）都以浮動疊層蓋在經文上，收合或展開時經文可視區域本身大小不變（避免 WebView 重新排版跳回章首）。
- 收合觸發：在經文區域偵測到往下捲動且移動超過門檻（WebView 內建腳本判定，`READER_CANVAS_BRIDGE`）。
- 展開（叫回工具列）觸發：往上捲動累積超過約 120dp、捲到章節頂端、捲到章節末尾、按硬體返回鍵，或點收合後的細條本身。點經文本身只會選取經節，不會觸發收合或展開。
- 開啟螢幕報讀（TalkBack/VoiceOver）時工具列強制常駐展開，且此後不會再自動收合（`AccessibilityInfo.isScreenReaderEnabled` 監聽）。
- 選到經節、或任何設定/章節/版本疊層開著時，工具列強制展開；同時底部 tab bar 與系統導覽列讓位隱藏、右下 ○▶ 暫時隱藏，讓經節動作列或疊層完整可見。
- 硬體返回鍵：若目前有選取的經節，先清除選取；否則若目前是收合狀態，先叫回工具列；兩種情況都停在讀經頁，不會離開到上一頁。
- 離開讀經頁（切到別的 tab 或返回）會重設：工具列展開、沉浸關閉、更多工具/版本資訊等疊層全部關閉。
- 「沉浸中」這個全域狀態（`readerImmersed`，經 `setReaderImmersed` 廣播）也會讓底部整條 tab bar 隱藏，而不只是被讀經頁自己的疊層蓋住（消費端在 `app/(tabs)/_layout.tsx`）。

### 譯本選擇（`src/config/youVersionContent.ts`、`src/services/readerPreferences.ts`、`src/services/nativeReaderPreferences.ts`）

- 可選譯本固定 5 個，依序：和合本（神版，繁體）、新譯本（繁體）、NIV、ERV、NKJV；預設為和合本（`SELECTED_BIBLE_VERSION_IDS`、`DEFAULT_BIBLE_VERSION_ID`）。
- 入口：更多閱讀工具 → 選擇譯本，畫面依語言分「繁體中文」「English」兩組單選列表；選定後自動儲存並關閉，儲存中顯示「正在儲存譯本…」，儲存失敗顯示紅字「譯本未儲存，請再試一次」且停留在選單（`CuratedVersionChoices`）。
- 每個登入帳號各自把譯本選擇存在本機安全儲存（`expo-secure-store`），訪客身分只存在記憶體，重新開 App 或換裝置不會保留（`nativeReaderPreferences.ts`）。
- 舊裝置上如果存的是已下架版本（1392、312、110、3034），讀取時會自動換成目前的預設版本並補寫回一次（`readerPreferences.ts` 的 `normalize(..., migrateRemovedVersion=true)`、`RETIRED_BIBLE_VERSION_IDS`）。
- 讀取或儲存偏好失敗時，畫面用 Alert 提示「暫時無法載入閱讀設定，已先使用預設值」或「閱讀設定尚未保存，請重試」，並提供「重試載入/重試儲存」（`app/(tabs)/reader.tsx`）。

### 字體與行距設定（`src/ui/useReaderPreferencesBinding.ts`、SDK patch）

- 入口：更多閱讀工具 → 調整字體，開啟 YouVersion 官方的字體大小/字型/行距設定面板（`BibleReaderSettingsSheet`）。
- 這組設定讀寫的是官方 SDK 既有的同一份 store，透過本專案在 `patches/@youversion+platform-react-native-expo-ui+1.5.0.patch` 加的擴充 API（`getReaderSettings`/`setReaderSettings`/`subscribeReaderSettings`）跟帳號綁定：換一個登入帳號時，若這個帳號之前存過設定就套用那組，沒存過就套用 SDK 出廠預設，絕不延用「前一個人」在同一個 App 進程裡留下的值。
- 這個擴充在原生執行環境不可用（例如安裝的 SDK 版本或建置沒帶這個 patch）時，畫面顯示「無法套用此帳號的閱讀設定，請重試」並可重試（`YouVersionReader.tsx` 的 `preferencesBinding.failed` 分支）。
- 任一疊層（設定/章節/版本）開著時，右上角固定顯示一顆「完成，返回閱讀」按鈕；按返回鍵也能關閉。

### 經節選取與複製（`src/ui/YouVersionReader.tsx`）

- 在經文上選字進入「選取」狀態，底部彈出官方的經節動作列；此時外層工具列強制展開但底部 tab/系統導覽列讓位隱藏，右下 ○▶ 暫時隱藏，避免蓋住動作列。
- 按下「複製」：文字寫入系統剪貼簿（`expo-clipboard`，失敗則靜默略過複製但仍繼續下一步），同時把「『經文內容』出處」格式的引句交給日記頁待用；日記頁不論當下有沒有開著都能收到，下次打開日記才會真正用掉這個引句。
- 換章節、收到清除選取訊號、或按返回鍵都會收起經節動作列、清除選取。
- 待確認：本專案呼叫官方 `BibleReader` 元件時只客製了 `onCopy`（其註解明確指出這會取代 SDK 內建的剪貼簿行為），沒有傳入 `onShare` 或 `highlights`/`onHighlightError`；SDK 本身在這個設定下是否仍提供「分享」「畫重點」選項、行為為何，本次檢查未安裝 SDK 套件原始碼可核對，列為待確認。

### 章節載入、重試與尚未就緒（`src/ui/YouVersionReader.tsx`、`src/ui/readerRetrySignal.ts`）

- 沒有設定 YouVersion App Key，或功能旗標 `EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE` 不是 `'true'` 時，一律顯示「官方閱讀器還在準備中，請稍後再試」，不嘗試載入官方閱讀器 UI 模組。
- 官方閱讀器 UI 模組載入失敗（原生環境問題）時顯示「閱讀器暫時無法開啟，請稍後再試」＋「重試」按鈕。
- 章節內容本身載入失敗時，由官方 SDK（經本專案 patch 加的 `retrySignal` 通道）顯示失敗卡片與重新載入按鈕；讀經頁在下列兩種情況會自動重觸發一次重試，不需使用者手動點：App 從背景回到前景、或「讀經」tab 剛剛重新拿到焦點（`useReaderRetrySignal`）。這個機制原本要解的問題是：在別的 tab 完成登入時，讀經頁那時看不到，載入失敗訊息會卡住不會自己恢復。
- 待確認：完全離線（無網路）時的畫面文案，本次程式碼檢查沒有找到專屬分支，推測會走上一點「章節內容載入失敗」的同一條路徑，但沒有找到寫死的「離線」提示文字，列為待確認。

### 內容預先載入（`src/services/bibleContentPreload.ts`、`src/ui/BibleContentPreloadHost.tsx`）

- 官方閱讀器就緒後，會在背景依序預先抓「今天」每一段指定經文的內容：先抓目前選中的那一段，再抓其餘的，同一時間最多 2 筆並行請求，用官方 SDK 自己的內容抓取管道。
- 換日期、版本或指定範圍時，還沒做完的預先載入會被取消，重新排一輪新的（依 `generationKey` 判斷是否要重排）。
- 這個過程沒有任何畫面顯示，失敗也不會出現錯誤提示，純粹是背景加速；`src/ui/BibleContentPreloadHome.tsx` 是另一個掛載點，供尚未進到全螢幕讀經頁前就先熱身用。

### 閱讀位置記憶（`src/storage/readerPosition.ts`）

- 每個帳號、每個讀經計劃、每一天分別記住最後讀到哪裡（書卷、章、是指定範圍還是自由閱讀），存在裝置本機資料庫（`qingmu_reader_positions` 表，主鍵為 member_id + plan_id + task_date），不是雲端同步。
- 重新進入讀經頁或換日期時，如果之前存過那一天的位置就恢復到那個位置；沒存過就回到「指定範圍第一段」或無排定時的預設自由閱讀章節。
- 訪客（未登入）不會讀取也不會寫入任何位置記錄。

### 譯本內容來源與後端（`server/officialBibleAdapter.ts`、`server/contentCapabilities.ts`、`server/contentRegistry.ts`）

- App 端把官方 SDK 的內容請求全部導向自己的後端（`YouVersionProvider` 的 `apiHost` 設成 `EXPO_PUBLIC_QINGMU_API_BASE_URL` 對應的主機名），不是直接打 YouVersion 官方 API（`src/ui/youVersionReaderConfig.ts` 的 `resolveReaderContentApiHost`）。
- 後端對這 5 個可選版本即時向 bible.com 對應網頁抓取、解析出章節內容與書卷/章節清單，轉成 SDK 預期的 JSON/HTML 格式回應；每次都會核對回應頁面上的版本 ID、章節、canonical 連結是否真的對得上要求的內容，對不上就回錯誤，不會把錯版本或錯章的內容混進去（`officialBibleAdapter.ts` 的 identity 檢查）。
- 抓取結果依「新鮮期」（預設 30 分鐘內直接用快取）與「延展期」（最長到 6 小時，逾期後背景重新確認，重新確認完成前先繼續顯示舊資料）快取，避免同一章反覆對 bible.com 發請求。
- 字型、語言清單等輔助端點也經同一個後端轉發，不是 SDK 直連外部服務。
- `src/domain/contentGate.ts` 與 `src/services/readerAdapter.ts` 定義了另一套「內容授權狀態」概念（`C_READY`/`C_TECHNICAL_PROBE`/`C_NOT_AVAILABLE`/`C_PENDING_ACCESS` 與對應的 `c-native`/`b-external`/`pending` 閱讀器模式）。搜尋整個 `app/` 目錄，沒有任何畫面 import 這兩個檔案：讀經頁實際顯示哪個譯本、能不能讀，是由上面三點（固定 5 版本清單＋`officialBibleAdapter.ts` 即時抓取結果）決定，不經過這套閘門。這套邏輯目前只出現在伺服器 `/api/content-capabilities` 端點在沒有另外指定 `contentGate` 選項時的預設回應，以及對應測試中。

### 靈修分頁 (`src/ui/devotion/`、`src/ui/FullscreenReaderLayout.tsx`、`server/devotional.ts`)

- 章節籤最後多一個「靈修」籤。點它換成靈修畫面 (經文留在後面不卸載)；在靈修時章節籤都不反白，點任一章回到經文。換日期也回到經文、停止朗讀。
- 靈修文由後端提供，要登入才拿得到 (`GET /api/devotional/<日期>`，檔案放在後端主機的 `QINGMU_DEVOTIONAL_DIR`，不在這個公開 repo)。只在打開靈修分頁時才抓。
- 靈修文怎麼進來：傳道每天早上把靈修貼在 LINE「竹科靈糧堂訊息公布欄」群組，群組裡有一個只收不發的 LINE bot。LINE 把 bot 所在每個群組的新訊息轉到後端 `POST /api/line/webhook` (`server/lineWebhook.ts`)，後端先用 channel secret 驗 LINE 的簽章，再只留下「公布欄群組裡、文字、能被靈修格式讀懂」的那則，寫成當天的 `YYYYMMDD.txt`；同一天再貼一次更正版就換成新的。bot 也在青少的群組裡，那些群組就算貼出靈修格式的文字也不存；怎麼認出公布欄群組見 [announcements.md](announcements.md)「怎麼認公布欄群組」(`server/lineGroups.ts`)。其他訊息不存、不記 log；bot 不回話也不發訊息。看起來像靈修卻讀不懂的貼文只記一行 `LINE_DEVOTIONAL_REJECTED`，不記內容。沒設定 channel secret 時這條路徑不存在 (404)。
- 畫面：標題《…》、「傳道 · 2026.10.14 (三) 讀經：…」、三段 (背誦經文、默想經文、用經文禱告) 各有標題和段落；最下面詩歌卡 (深色 16:9、播放圈、歌名)。
- 字的大小和行距跟經文用同一個「調整字體」設定 (每個帳號一份，見上面「字體與行距設定」)：段落字級和經文一樣、行高＝字級 × 行距；標題和段落名稱照同樣比例放大縮小；日期那一行固定大小。沒改過設定的人看到 SDK 出廠預設 (16、1.7)，跟以前一樣。
- 段落開頭的經文出處 (例如「彼得前書 5:2」「5:7」「5:8-9」「詩篇 118:15」) 用節號的小灰字：字級為正文的 0.65 倍、顏色 #636161。只切開字型樣式，出處、空白與正文逐字保留；內文中的出處不縮小。
- 今天 (或之後) 的週一到週六還沒貼時顯示「靈修請待發佈」，字比一般說明大一點 (18)；週日沒有靈修，和過去沒有靈修的日子一樣顯示「這一天的靈修還沒有上傳」；抓不到時顯示錯誤和「重試」。
- 抓靈修遇到網路錯誤、逾時或後端 5xx 時，畫面維持「正在載入今天的靈修…」，等 4秒自動再問一次；這次也失敗才顯示錯誤和「重試」。每次載入 (含按「重試」) 最多自動再問一次，等的時候再切到靈修分頁、回到前景都不多發請求。格式不對、被拒絕這類再問也不會變的錯誤直接顯示 (`DEVOTIONAL_RETRY_DELAY_MS`，`src/ui/devotion/useReaderDevotion.tsx`)。
- 後端對「今天 (週一到週六) 還沒上傳」回可以重試的錯誤 (`DEVOTIONAL_NOT_YET_POSTED`)，讓 0.5.34 以前的 App 之後再看一次會重新抓。同一個人 10 秒內又問同一天，改回「還沒有上傳」：那些 App 停在最後一章底部時，每次錯誤都會馬上再問，這樣問一次就停 (2026-10-19)。這版 App 把這兩種回答都當成還沒貼，不當錯誤；要不要寫「靈修請待發佈」只看日期，也不靠這 10 秒的規則擋重問。
- 還沒有上傳時，下次切到靈修分頁、滑到最後一章的底、或回到讀經頁 (切回讀經 tab，或讀經頁在畫面上時 App 回到前景，跟靈修葉子同一個規則) 都會再問一次後端；問的時候畫面維持「還沒有上傳」，不轉圈，這次也問不到就照舊。讀經頁不在畫面上時回到前景不問。沒有計時器。
  - 只有這些事會再問：停在最後一章的底只問一次，離開再回來才再問；每次回到讀經頁最多問一次；畫面因為回答而更新不會再問。同一時間最多一個問題在路上，路上還有一個時再看一次就等它的回答，所以舊的回答不會蓋掉新的。換日期或換帳號時，路上的回答不算。
  - 還沒有靈修時按 ▶ (或接續靈修念完經文切過來)，只等這一次的回答：問到就念；沒問到或抓不到就不再自動念，之後再問到時只顯示，不出聲，要念再按一次 ▶。
- 右下角三顆鈕：深綠葉子完成圈、深綠書完成圈 (讀經打卡，規則見 [reading-plan.md](reading-plan.md))、▶。
  - 葉子圈在經文時按下完成今日靈修，再按撤銷，不啟動朗讀，也不會展開成別的按鈕。
  - 滑到當天最後一章的底時，App 先抓當天的靈修；有上傳、還沒完成，就在「繼續讀」卡片的同一個位置出現「接著讀靈修 ›」，樣子也一樣。按了切到靈修頁最上面，不朗讀、不打勾。每天都出現，沒有期限；今天靈修已完成、當天沒有靈修、或正在朗讀而且開了接續靈修 (念完會自己切過去) 時不出現；選了某一節時跟「繼續讀」一樣先讓開。
  - 葉子圈在靈修時：滑到底才展開「完成今日靈修」。完成後回到深綠圓圈，白葉子旁長出新葉；再按取消。書圈未完成是封面有十字、闔上的聖經；完成後是白色打開的聖經，上面發出五道光。
  - 葉子完成成功後，共用讀經的浮出小字：今天是「完成今日靈修了！」，補勾是「完成 10月13日靈修了！」，不寫分數；出現 2 秒後開始淡出。撤銷或儲存失敗不顯示，換日或換帳號不留下舊提示。
  - ▶ 在靈修時是「朗讀靈修/暫停朗讀」，會先停掉經文朗讀。
- 朗讀靈修：優先用 Azure 神經語音一段一段合成 mp3，由現有 `expo-audio` 播放。預設男聲 `zh-TW-YunJheNeural`，女聲 `zh-TW-HsiaoChenNeural`；念到的段落換成跟經文朗讀一樣的灰底 (`READ_ALONG_HIGHLIGHT`，#D5DDD8)，一次亮一整段；最前面先念標題，每個段落 (背誦經文等) 開頭先念它的名稱。按 ▶ 開始或繼續時，畫面先捲到正在念的那段 (第一段捲到最上面，看得到標題)，之後每換一段就跟著捲；段落的開頭停在日期列和章節籤下面，跟沒捲動時標題的位置一樣，不會被頁首蓋住；暫停時不捲，停在使用者自己滑到的地方。暫停後再按從那一段重念 (Android 的語音不能停在一半)。某段取不到音訊 (離線、後端未設定、Azure 失敗、載入逾時或播放錯誤) 就只將該段交給手機內建 `expo-speech` (zh-TW)，念完繼續下一段；下一段仍可用 Azure。連手機語音也失敗時才停在該段，可按 ▶ 重試。
- 念法只改朗讀文字，畫面不改：書卷第一次出現在段首出處時念完整書名與章數 (例如「彼得前書第五章」，詩篇用「篇」)，同卷後續段首節號不念；括號出處如 (1:1) 不念，普通括號內文保留；內文 5:7 念「五章七節」、5:8-9 念「五章八至九節」；出處用半形逗號接著列更多節 (「119:20,23-24」「113:5-7, 9」) 算同一個出處，段首時整個是小灰字、不念，內文時念「五章七、九節」；全形逗號「，」後面的數字照一般內文處理；標題或小標題的「彼前5、詩118」展開為「彼得前書第五章、詩篇第一百一十八篇」；網址、表情符號不念。書名沿用 `scriptureReference.ts` 的既有對照，Azure 與手機語音共用同一份念法轉換。
- 「更多閱讀工具」的「朗讀速度」下方有「靈修朗讀聲音」男聲/女聲兩個選項，每個帳號記在自己的手機。朗讀速度與讀經共用 0.75/1/1.25/1.5 倍，Azure mp3 與手機語音都套用。播放中變速立即套用；手機語音需從當段重新念。切換聲音時也從當段重念。
- 後端 `GET /api/devotional/<日期>/audio/<段落索引>?voice=<聲音>` 與靈修文字使用相同登入邊界。啟動時從 `QINGMU_AZURE_SPEECH_FILE` 讀 JSON (`{"key":"…","region":"eastasia"}`)；沒設定、檔案無效或未指定靈修目錄時為 404。合成錯誤回 502, 不把 Azure 的 401 當成使用者登入逾期。成功回 `audio/mpeg`，不公開快取網址或金鑰。
- 後端事先把整篇合成好：LINE 收到 (或更正) 當天的靈修，以及後端啟動時最新的一篇，都先把每一段的男聲、女聲各請 Azure 做一次存起來 (預設男聲先做)，聽的人按 ▶ 時直接讀現成的檔。已經做好的段落直接讀檔、不排隊；只有真的要請 Azure 合成的才排 F0 佇列，某段做失敗只記次數，收聽時再試。App 播一段時就先下載下一段 (換聲音、換天或換段落時取消重下；先下載失敗時，輪到那段再試一次)，所以只有第一段要等網路。後端每次錄音請求記一行 `DEVOTIONAL_AUDIO_REQUEST` (日期、第幾段、聲音、狀態、讀檔或合成、毫秒)，不記內容，用來判斷退回手機聲音時是卡在後端、網路還是手機。
- mp3 存在 `QINGMU_DEVOTIONAL_DIR/.audio/` 私人快取，鍵包含日期、段落索引、聲音、朗讀文字及轉換版本；同段同聲音共用進行中的請求與已存檔案，同一天更正文會重新合成。F0 在同一後端程序內串行合成，不並行。App 只為正在念的段落取音訊，停止/換日會取消等待，暫存檔在播放結束或停止時刪除。
- 正式啟動腳本沿用 LINE 設定檔的模式：選配 `azure-speech-runtime-config.json` 只存 `{"speechFile":"<金鑰檔絕對路徑>"}`，launcher 只傳路徑，不讀、不輸出金鑰。既有文字 API 與舊版 App 不受影響。
- 朗讀時上方一條提示「正在朗讀靈修 · 讀完接著播詩歌」(關掉接續靈修時只寫「正在朗讀靈修」)。
- 詩歌卡下方顯示灰色小字「<歌名> · <頻道名>」(caption 字級，最多兩行，超出刪節)；歌名沿用卡片，頻道保留 oEmbed 的 `author_name` 原字串。只有歌名時只顯示歌名，兩者皆無則省略。當天有詩歌就顯示右對齊的綠色「在 YouTube 開啟 ›」，樣式同積分頁「整份計畫 ›」；按下先暫停正在播放/載入的詩歌，再由系統開啟原影片 (Android、iOS 共用 `Linking.openURL`，有 YouTube App 時由系統處理，否則開瀏覽器)。沒有詩歌則沒有上述入口。後端歌名和頻道同次查詢並快取，oEmbed 失敗時頻道為 null，不影響靈修內容；舊後端沒有頻道也能讀取。
- 「接續靈修」打開時，順序是：經文朗讀念完當天最後一章 → 自動切到靈修並朗讀 → 念完接著播詩歌。詩歌用 YouTube 播放器 (後端的 `/api/devotional/player` 頁面)，按播放或自動接上時才載入；只在螢幕亮著、App 在前景時播，切到背景就暫停。
- 更多閱讀工具 (⋯) 有「接續讀經」(副標：按 ▶ 接著念今天剩下的章節) 與「接續靈修」(副標：經文念完，接著念靈修和詩歌)。每個開關旁有獨立 44px 的 ?，只開說明，不切換設定；原本「連讀是什麼？」長段落移除。接續靈修預設關，每個帳號各記一份在手機；舊版從沒動過的成員升級後也改為關，明確開過或關過的人維持原選擇。只有選單開關與有期限的大按鈕可以打開。本機偏好暫時讀不到時保持關閉，並且不把未知狀態當成從未選過，不顯示接續提示；仍可在選單明確選擇。
- 「接續靈修」說明：打開後，按 ▶ 朗讀今天的經文，最後一章念完會接著念傳道的靈修，念完再播詩歌 (螢幕亮著才播)。自己讀、不聽朗讀的人不受影響，按「完成今日讀經」不會跳頁。預設是關的。

### 在 YouVersion 開啟此章 / 版本資訊（`src/ui/FullscreenReaderLayout.tsx`、`src/ui/youVersionReaderConfig.ts`）

- 更多閱讀工具 → 「在 YouVersion 開啟此章」：先暫停朗讀（若正在播放），再用系統瀏覽器/YouVersion App 開啟 `https://www.bible.com/bible/{版本ID}/{書卷}.{章}` 這個公開連結，同時把目前位置存成一筆閱讀記錄；只有目前章節能合法轉成這個連結格式時（版本 ID、書卷縮寫、章數字都合法）這個按鈕才會啟用；開啟失敗顯示「目前無法開啟本章，請稍後再試」。
- 更多閱讀工具 → 「版本資訊」：顯示目前譯本的名稱、出版單位、版權聲明，以及（若有）朗讀版權聲明和一個外部「開啟官方版本資訊」連結；尚未載入 metadata 時顯示「版本資訊尚未載入」。

## 看過的資料更新 (2026-10-19)

讀經頁採用成功讀回的後端讀經表，完成圈與靈修葉子在回到前景或切回讀經頁時重讀；台北跨日的自動日期在朗讀結束後換到今天，手選歷史日期保留。完整規則見 [reading-plan.md](reading-plan.md)「資料更新」。

## 決定（為什麼這樣做）

- 看過的資料要跟上：回到前景、切回頁面時重讀，不用計時器 (維護者 2026-10-19)。

**刻意不做：**

- **半章只顯示和朗讀排定範圍，保留看整章入口**：避免讓使用者誤以為今天要讀完整章；範圍外段落與標題一起隱藏，提示只在有被省略的頭/尾出現。換日期/章節重設，無分節錄音明說整章播放，不猜時間。(維護者 2026-10-16 確認；工單引用當日 mock 第四區)
- **半章首列是書名只出現一次規則的例外**：用完整範圍告知省略章首，僅非第 1 節開始時顯示。(維護者 2026-10-16)

- **「還沒有上傳」不是當天的定論**：傳道每天不一定什麼時候上傳，先看過的人之後要看得到；只在使用者再看一次時問，不用計時器輪詢。今天還沒貼寫「靈修請待發佈」，字放大一點。(維護者 2026-10-19)
- **再問只跟著使用者的動作，不跟著畫面更新；▶ 不留到以後**：停在最後一章底時，每次回答都讓畫面更新，曾因此一直重問 (一個請求接一個，0.5.34 的「錯誤就再問」也是同一個原因)；同時最多一個請求。回到前景只在讀經頁在畫面上時問，跟「看過的資料要跟上」同一個規則。▶ 只等當下那次的回答，免得幾小時後回到前景才突然出聲。週日沒有靈修，不寫「靈修請待發佈」，跟後端的週一到週六規則一致。(2026-10-19 合併前審查)
- **載入遇到網路錯誤或 5xx 自動再問一次，只一次**：2026-10-20 早上 07:08 後端部署斷線約 3秒，打開靈修就看到錯誤，積分頁卻會自己再試。等 4秒是為了撐過這種重啟；只再問一次，等的時候仍算同一個請求，不會回到 0.5.34 一個接一個的請求 (#68、#74)。「還沒有上傳」不是錯誤，照舊只在使用者再看一次時問，沒有計時器。(維護者 2026-10-20)
- **自己讀完按完成不跳靈修頁**：完成打卡與朗讀是兩件事，避免打斷自己閱讀的人。(維護者 2026-10-14)
- **接續靈修預設關，只能明確選擇打開**：保留曾經開過或關過的選擇；任何自動流程都不能改成開。提示只給從未選過、首次出現後 7 個日曆天內、確實到最後一章底的人；點後切到靈修並永久停止提示。(維護者 2026-10-14)
- **完成才填滿深綠**：圈圈一律白底 2px 深綠框 (#1A5544)，完成才深綠底白圖示；聖經打開發光，葉子長新葉。葉子圈是完成/撤銷，不是播放。(維護者 2026-10-14)
- **讀經圖示是「闔上的聖經 (十字) → 打開發光」**：詩篇 119:130「你的言語一解開，就發出亮光」；跟葉子長新葉一樣，完成是同一個東西起了變化；十字讓圈圈沒有字也認得出是聖經。取代原本「打開的書 → 闔上 (書籤帶)」。(維護者 2026-10-14)
- **名稱採「接續讀經」「接續靈修」**：兩者都描述按 ▶ 以後的接續行為，? 各自說明，減少選單長篇文字。(維護者 2026-10-14)
- **按鈕不用金色**：金色只保留月曆日期下靈修標記與圖表靈修虛線。(維護者 2026-10-14)

- **詩歌不在背景或關螢幕時播**：YouTube 播放器只在螢幕亮著時播，切到背景就暫停；不做背景播放。(維護者 2026-10-14)
- **靈修文不放在公開 repo**：由後端提供，要登入才拿得到。(維護者 2026-10-14)
- **靈修文由 LINE bot 即時收，不定時去抓**：傳道大約 5:30–7:30 之間發，要一發就進 App；定時輪詢是最後的選項。用原本就有的 LINE 官方帳號 (維護者 2026-10-15)。只存靈修、不回話，是因為 bot 在群組裡看得到所有人的訊息。
- **靈修只收公布欄群組** (維護者 2026-10-20)：靈修只貼在公布欄群組；bot 之後也會加進青少的群組，那些群組的文字不能被當成靈修存起來。認不出是哪個群組時寧可漏收一則。
- **不建立另一套聖經 renderer**：官方 SDK 只透過既有 bridge 注入 CSS/JS 來改版面，不重寫或另外畫經文。（來源：[../superpowers/plans/2026-09-25-reader-layout-a-immersive.md](../superpowers/plans/2026-09-25-reader-layout-a-immersive.md) Global Constraints）
- **不會預先載入整本聖經或所有譯本**：背景只抓當天實際用得到的章節，同一時間最多 2 筆並行請求。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §4.5）
- **不用第三方 `@gorhom/bottom-sheet`（連帶 reanimated/worklets）**：改用 App 自己的輕量底部面板。原因有兩個：這一組套件在 RN 0.85 上多吃約 155 MB 原生記憶體，還讓畫面執行緒每格都在跑動畫迴圈；而且 iOS 上把可以按的元件包成一整顆背景時，裡面的選項對 VoiceOver 和自動化測試都看不到。（來源：[../design/lean-reader-sheets.md](../design/lean-reader-sheets.md)；[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 7 點）

- **沉浸模式收合時，頁首「原地收合」成進度細條，不搬到底部**：起因是舊版一般狀態進度在頁首、沉浸時卻跑到底部細條，位置前後不一致。（來源：[../design/reader-page.md](../design/reader-page.md) §5.1）
- **書名整個畫面只出現一次，放在章節籤**：範圍列、內文標題、底部膠囊都各顯示一次是設計錯誤，已定案改掉。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「書名」）
- **經文快取明訂 30 分鐘的新鮮期，不留給 SDK 自己決定預設保存期限**：避免 SDK 沒設定時自己套用不可預期的快取時間。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §4.4）
- **已被取代 (2026-10-14)：舊版金色靈修鈕**：靈修仍是最後一個章節籤；配色與動作改採下方的完成圈決定。(維護者 2026-10-14；來源：[../superpowers/plans/2026-10-14-mock-1014-redesign.md](../superpowers/plans/2026-10-14-mock-1014-redesign.md))
- **已被取代 (2026-10-14)：接續靈修預設開、圓圈自動打開的舊決定**：改採下方 opt-in 決定。(維護者 2026-10-14)
- **已被取代 (2026-10-16)：靈修只用手機內建語音**：2026-10-14 的逐段朗讀與反白保留，主要聲音改為 Azure 神經語音，手機語音成為逐段退路。
- **靈修聲音優先 Azure，失敗不中斷後續段落**：預設男聲、可選女聲；沿用現有速度與播放器、不增加套件。合成快取與 F0 單請求佇列避免重複合成與並行限流。(維護者 2026-10-16)
- **讀完最後一章接著靈修，每天都出現；收掉 7 天的「接續靈修 ›」邀請**：原本的邀請把「帶我去靈修」和「以後自動接著念」綁在一起，用讀的人永遠不會開自動接續，7 天後就再也看不到往靈修的路。改成跟前面幾章的「繼續讀」同一個規則：每一步讀完，就指向下一步；自動接續只在 ⋯ 選單開關。(維護者 2026-10-17)
- **靈修錄音事先合成，不等使用者按 ▶ 才做**：Azure 要把整段念完才回傳，2026-10-16 第一段 (約 20 秒) 花了 11 秒，超過 App 每段等 8 秒的上限，整篇都退回手機聲音。拉長等待會讓人按了 ▶ 卻安靜十幾秒，所以改成收到貼文就做好；每天約兩倍全文字數，在 F0 每月免費額度內。(維護者 2026-10-16)
- **播一段時先下載下一段**：2026-10-16 晚上後端已經有現成的錄音，「默想經文」(約 1 分鐘、355KB) 仍有一次超過 8 秒、退回手機聲音，同一段之後重播都正常，判斷是網路或手機端一時變慢。先下載是一般播放器的做法，只多佔一段 mp3 的記憶體。(維護者 2026-10-16)
- **念法與畫面分開**：經文出處在朗讀中去除或展開，畫面文字一字不改；段首出處只是變為與經文節號相同的小灰字。(維護者 2026-10-16)
- **完成靈修只給完成提示、不給分數**：共用讀經的浮出提示與淡出時序，今天/補勾依實際完成日期寫；靈修仍不加積分。(維護者 2026-10-16)
- **靈修的字跟經文用同一個「調整字體」設定，朗讀底色也跟經文一樣是灰色**：兩個分頁讀起來像同一本書，不另外做一組靈修字體設定；底色一次亮一整段，因為手機語音是一段一段念的，沒有逐句位置。(維護者 2026-10-14)
- **按 ▶ 開始或繼續時先捲到正在念的那段**：暫停時使用者可能滑走了，繼續時要讓人馬上看到念到哪；暫停中不捲，不跟使用者搶畫面。(維護者 2026-10-14)

- 詩歌卡下方顯示歌名 · 頻道和『在 YouTube 開啟 ›』：讓人知道是誰的歌、能到原影片 (維護者 2026-10-19)。

**待確認（沒有記錄，請維護者確認是否刻意）：**

- owner 帳號目前存的行距是 2.0（新帳號預設是 1.7），是否為本人特意設定過，沒有記錄，暫不擅自清掉。（來源：[../design/reader-page.md](../design/reader-page.md) §6）

## 平台差異

- 更新提示（下載新版 APK 的橫幅）只在 Android 出現；`FullscreenReaderLayout` 把 `UpdateBanner` 放進「更多閱讀工具」清單中，但橫幅本身在非 Android 平台一律回報「沒有更新」且不發任何網路請求（`AGENTS.md` 第 54-66 行第 2 條；`app/(tabs)/reader.tsx` 傳入 `updateBanner={<UpdateBanner />}`）。
- 面板/選單（更多閱讀工具、版本資訊、譯本選擇、註腳）都用本專案自己的底部面板元件（`src/ui/sheet/bottomSheet.tsx`）取代第三方 `@gorhom/bottom-sheet`，兩平台共用同一套實作，理由是 React Native 0.85 上 reanimated/worklets 的原生記憶體與常駐畫格成本，以及 iOS 上可按的背景元件會讓 VoiceOver/自動化測試找不到面板內容（`src/ui/sheet/bottomSheet.tsx` 檔案開頭注解、`src/ui/SheetBackdrop.tsx`）。
- 沉浸模式會呼叫 `NavigationBar.hidden`（Android 系統導覽列）與 `StatusBar hidden`；iOS 沒有對應的畫面上系統導覽列，這段程式碼在 iOS 上實際生效範圍本次未能從程式碼確認，列為待確認（`src/ui/FullscreenReaderLayout.tsx`）。
- 除上述之外，本文件涵蓋的行為（章節籤、譯本選擇、字體設定、經節複製、沉浸收合叫回、內容預先載入、位置記憶）程式碼中沒有 `Platform.OS` 分支，兩平台共用同一份實作（已於 `FullscreenReaderLayout.tsx`、`YouVersionReader.tsx`、`app/(tabs)/reader.tsx` 逐檔確認）。

## 資料與後端

- 帳號閱讀偏好（譯本、字體設定）：裝置本機安全儲存，鍵值含帳號 ID，訪客不落地（`src/services/readerPreferences.ts`、`src/services/nativeReaderPreferences.ts`）。
- 閱讀位置：裝置本機 SQLite（`qingmu_reader_positions`），依帳號＋讀經計劃＋日期各存一筆（`src/storage/readerPosition.ts`）。
- 譯本內容：不落地快取到裝置，每次由 App 後端即時向 bible.com 抓取/解析後回應，後端本身做記憶體快取（`server/officialBibleAdapter.ts`）。
- 朗讀章節位址登記表（`server/contentRegistry.ts`）與其評估邏輯（`server/contentCapabilities.ts`）屬於朗讀/朗讀能力查詢功能，不是本文件範圍；本文件只確認它們與 `contentGate.ts`/`readerAdapter.ts` 一樣不是譯本文字內容顯示的實際路徑。

## 守住它的測試

- `tests/domain/partialChapter.test.ts` — 節數範圍、整章不限制、合節邊界。
- `tests/ui/partialChapterBridge.test.ts` — 詩篇 119 實錄經安裝的 WebView SDK 轉換後，真瀏覽器驗證範圍、空段、標題、頭尾提示、看整章、換日/內容重設和完成邊界。
- `tests/services/partialChapterAudio.test.ts`、`tests/ui/partialChapterAudioControls.test.ts` — 兩個譯本的實錄首尾時間、無分節退路、seek/停止/重播、背景與同章換日/延遲 seek。
- `tests/services/sdkPartialChapter.test.ts`、`tests/ui/youVersionReaderAutoplay.test.ts` — 安裝 SDK 的 DOM 屬性更新與清除、範圍/提示 prop 串接與原本章末接續。
- `tests/services/devotionReading.test.ts` — 每卷首次書名、段首節號、括號出處、內文章節、標題縮寫、網址/emoji 與不改原文。
- `tests/server/devotionalAudio.test.ts`、`tests/integration/devotionalAudioHttp.test.ts` — 登入保護、選配設定、mp3 HTTP bytes、私有快取/並行去重、F0 串行到 body 讀完、更正文與上游錯誤。
- `tests/services/devotionAudioClient.test.ts`、`tests/services/devotionAudioEngine.test.ts`、`tests/services/nativeDevotionAudio.test.ts` — 認證下載、逐段退路、逾時/停止/晚到回應、速度與 Expo 暫存檔/播放器釋放。
- `tests/services/devotionVoicePreferences.test.ts`、`tests/ui/readerDevotionOptIn.test.ts`、`tests/ui/fullscreenReaderLayout.test.ts` — 聲音存讀、帳號隔離、設定讀寫競爭、閱讀工具入口與 hook 串接。
- `tests/ui/devotionalView.test.ts`、`tests/ui/completionAwardFeedback.test.ts` — 原文保留、小灰字、今日/補勾完成文案與不顯示分數。
- `tests/ui/readerDevotionRefetch.test.ts`、`tests/services/devotionalNotYetPosted.test.ts` — 真的讀經頁加靈修 hook：停在最後一章底 (還沒上傳、抓不到) 只問一次、閒置不問、讀經頁不在畫面上時回前景不問、每次回來最多問一次、同時一個請求、舊回答不蓋新的、▶ 不留到以後、週日不寫請待發佈；後端 503 當成還沒貼；網路錯誤、逾時或 5xx 等 4秒自動再問一次 (第二次成功直接顯示靈修、兩次失敗才顯示錯誤，總共兩個請求，停在最後一章底幾小時也不多問)。
- `tests/tools/backendLaunchEnv.test.ts`、`ops/test_azure_speech_config.py` — 啟動路徑傳入選配金鑰檔，設定無效不影響核心 API。

- `tests/ui/fullscreenReaderLayout.test.ts`、`tests/ui/fullscreenReaderPadding.test.ts`、`tests/ui/fullscreenReaderScreen.test.ts`、`tests/ui/fullscreenReaderWrapper.test.ts` — Layout A 的頁首、章節籤、右下按鈕、經文可視區域尺寸與換算。
- `tests/ui/readerLayoutA.test.ts`、`tests/ui/readerLayoutContract.test.ts` — 沉浸收合/展開時機與版面契約（`readerLayoutContract.ts`）。
- `tests/ui/readerImmersionBridge.test.ts`、`tests/ui/readerImmersionSettings.test.ts` — WebView 內收合/展開偵測腳本、沉浸狀態廣播。
- `tests/ui/readerRetrySignal.test.ts` — 回前景/回讀經頁自動重試訊號。
- `tests/ui/readerDailyFlow.test.ts` — DOM bridge 訊息（捲動方向、邊界）的編碼/解碼。
- `tests/ui/readerCompactHeaderContract.test.ts` — 隱藏 SDK 原生標題、精簡頁首樣式的字串契約。
- `tests/server/lineWebhook.test.ts`、`tests/integration/lineWebhookHttp.test.ts` — LINE 簽章不對就 401、只存群組裡格式對的靈修、其他訊息不存不記、重送不變、更正版取代、不發任何網路請求、沒設定時 404、過大的內容 413、查不到群組名稱的群組不存。
- `tests/server/lineGroups.test.ts` — 只收公布欄群組的靈修和週刊、別的群組格式對的靈修不存、照片不下載、查不到群組名稱時不當成公布欄而且下一則再查、加入群組時記下名稱、重開後不再查、只向 LINE 拿權杖、群組名稱和照片，沒有回話或推播。
- `tests/ui/youVersionReader.test.ts` — `YouVersionReader` 元件的整體行為（載入狀態、錯誤卡、疊層）。
- `tests/ui/useReaderPreferences.test.ts`、`tests/services/readerPreferences.test.ts` — 譯本/字體偏好的讀寫、遷移、錯誤處理。
- `tests/services/sdkReaderSettingsExtension.test.ts`、`tests/services/sdkReaderRecovery.test.ts`、`tests/services/sdkReaderApiHost.test.ts` — SDK patch 的字體設定擴充、重試通道、`apiHost` 轉發，直接對安裝的 SDK 套件檔案斷言。
- `tests/services/fiveVersionReader.test.ts` — 5 個可選譯本清單與其中文/英文分組。
- `tests/services/youVersionAdapter.test.ts`、`tests/services/readerAdapter.test.ts`、`tests/domain/contentGate.test.ts` — 舊內容閘門概念（見上）自身的單元測試。
- `tests/server/officialBibleAdapter.test.ts` — bible.com 抓取/解析/身分核對/快取。
- `tests/services/bibleContentPreload.test.ts`、`tests/ui/bibleContentPreloadHost.test.ts` — 背景預先載入的排程與並行上限。
- `tests/storage/readerPosition.test.ts` — 閱讀位置記憶的存取。
- `tests/ui/sheetBackdrop.test.ts`、`tests/ui/leanBottomSheet.test.ts`、`tests/ui/nativeSheetLifecycle.test.ts`、`tests/config/leanSheetsWiring.test.ts`、`tests/ui/actionSheetDismissal.test.ts` — 自製底部面板/背景元件的無障礙與生命週期。
- `tests/ui/focusedReaderRoute.test.ts`、`tests/ui/focusedReaderVisibleIdentity.test.ts`、`tests/ui/unscheduledReaderRoute.test.ts` — 進頁導向、無排定日的自由閱讀初始狀態、身分切換時的畫面歸屬。
- `tests/ui/readerAccountSettings.test.ts` — 換帳號時字體設定套用哪一組。

## 相關文件

- [docs/design/reader-page.md](../design/reader-page.md) — 讀經頁版面決策與待決定事項（Layout A 的由來）。
- [docs/design/lean-reader-sheets.md](../design/lean-reader-sheets.md) — 為何自製底部面板取代 `@gorhom/bottom-sheet`。
- [docs/superpowers/plans/2026-09-25-reader-layout-a-immersive.md](../superpowers/plans/2026-09-25-reader-layout-a-immersive.md) — 沉浸模式頁首原地收合的實作計畫。
- [reading-plan.md](reading-plan.md) — 日期切換、今日排定範圍、完成讀經按鈕與加分規則。

## 已知限制與待辦

- 待確認：完全離線時的畫面文案（見「章節載入、重試與尚未就緒」）。
- 待確認：SDK 官方經節動作列在本專案的設定下是否仍提供「分享」「畫重點」，因為本專案只客製了複製，且本次檢查沒有安裝 SDK 套件原始碼可核對（見「經節選取與複製」）。
- 待確認：沉浸模式隱藏系統導覽列在 iOS 上的實際效果（見「平台差異」）。
- `src/storage/readerPosition.ts` 的 `resetToAssigned` 把每筆重置後的位置記錄寫死 `versionId: 1392`——這是 `src/config/youVersionContent.ts` 目前 `RETIRED_BIBLE_VERSION_IDS` 中已下架的版本，跟現在可選的 5 個版本（46/40/111/406/114）不一致。還原閱讀位置時的程式碼實際只讀 `book`/`chapter`/`reference`/`mode`，沒有用到這筆記錄的 `versionId`，所以目前看不出使用者可見的影響，但這是一段跟現況脫節的寫死值，值得清理。
- `src/domain/contentGate.ts` 與 `src/services/readerAdapter.ts` 是一套沒有被 App 畫面串接的舊內容閘門概念，只在伺服器預設分支與測試中存在；是否要移除或補上串接，待維護者決定。
