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

## 行為規格

### 進入與掛載

- 每次「讀經」tab 被點擊而拿到焦點，選中日期一律重設為今天，並導向 `/reader`（`app/(tabs)/today.tsx`）。
- `/reader` 不在底部 tab bar 顯示，但讀經頁的所有畫面都由它渲染；它設定 `freezeOnBlur: false`，所以離開這個 tab 不會卸載這個畫面（`app/(tabs)/_layout.tsx`、`app/(tabs)/reader.tsx`）。

### 指定範圍 vs 自由閱讀（`app/(tabs)/reader.tsx`）

- 當天有排定讀經時，預設顯示第一段指定經文；沒有排定時，預設自由閱讀約翰福音 1 章（`initialSelection`）。
- 點頁首章節籤中「非目前那一籤」會直接切到那一段指定經文（記為 `ASSIGNED`）；用「選擇其他章節」或官方書卷/章節選單換到不在今天範圍內的書卷/章，記為「自由閱讀」（`FREE`），並記住那個位置，不影響今天的指定範圍本身。
- 「回到指定範圍」（`returnToAssignedRange`）與再次點「讀經」tab 且判定要重置到指派起點時（`todayReaderTabPressResetToAssignedStart`），都會把選擇重設回第一段指定經文；後者只在登入身分、日期都跟當初觸發的一致，且不是仍在「同一天再次點讀經」的情形下才會覆蓋現有選擇。
- 未登入（訪客）時不記住/讀取任何位置，選擇只存在畫面狀態中，離開就消失。

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

### 在 YouVersion 開啟此章 / 版本資訊（`src/ui/FullscreenReaderLayout.tsx`、`src/ui/youVersionReaderConfig.ts`）

- 更多閱讀工具 → 「在 YouVersion 開啟此章」：先暫停朗讀（若正在播放），再用系統瀏覽器/YouVersion App 開啟 `https://www.bible.com/bible/{版本ID}/{書卷}.{章}` 這個公開連結，同時把目前位置存成一筆閱讀記錄；只有目前章節能合法轉成這個連結格式時（版本 ID、書卷縮寫、章數字都合法）這個按鈕才會啟用；開啟失敗顯示「目前無法開啟本章，請稍後再試」。
- 更多閱讀工具 → 「版本資訊」：顯示目前譯本的名稱、出版單位、版權聲明，以及（若有）朗讀版權聲明和一個外部「開啟官方版本資訊」連結；尚未載入 metadata 時顯示「版本資訊尚未載入」。

## 決定（為什麼這樣做）

**刻意不做：**

- **不建立另一套聖經 renderer**：官方 SDK 只透過既有 bridge 注入 CSS/JS 來改版面，不重寫或另外畫經文。（來源：[../superpowers/plans/2026-09-25-reader-layout-a-immersive.md](../superpowers/plans/2026-09-25-reader-layout-a-immersive.md) Global Constraints）
- **不會預先載入整本聖經或所有譯本**：背景只抓當天實際用得到的章節，同一時間最多 2 筆並行請求。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §4.5）
- **不用第三方 `@gorhom/bottom-sheet`（連帶 reanimated/worklets）**：改用 App 自己的輕量底部面板。原因有兩個：這一組套件在 RN 0.85 上多吃約 155 MB 原生記憶體，還讓畫面執行緒每格都在跑動畫迴圈；而且 iOS 上把可以按的元件包成一整顆背景時，裡面的選項對 VoiceOver 和自動化測試都看不到。（來源：[../design/lean-reader-sheets.md](../design/lean-reader-sheets.md)；[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 7 點）

- **沉浸模式收合時，頁首「原地收合」成進度細條，不搬到底部**：起因是舊版一般狀態進度在頁首、沉浸時卻跑到底部細條，位置前後不一致。（來源：[../design/reader-page.md](../design/reader-page.md) §5.1）
- **書名整個畫面只出現一次，放在章節籤**：範圍列、內文標題、底部膠囊都各顯示一次是設計錯誤，已定案改掉。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「書名」）
- **經文快取明訂 30 分鐘的新鮮期，不留給 SDK 自己決定預設保存期限**：避免 SDK 沒設定時自己套用不可預期的快取時間。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §4.4）

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

- `tests/ui/fullscreenReaderLayout.test.ts`、`tests/ui/fullscreenReaderPadding.test.ts`、`tests/ui/fullscreenReaderScreen.test.ts`、`tests/ui/fullscreenReaderWrapper.test.ts` — Layout A 的頁首、章節籤、右下按鈕、經文可視區域尺寸與換算。
- `tests/ui/readerLayoutA.test.ts`、`tests/ui/readerLayoutContract.test.ts` — 沉浸收合/展開時機與版面契約（`readerLayoutContract.ts`）。
- `tests/ui/readerImmersionBridge.test.ts`、`tests/ui/readerImmersionSettings.test.ts` — WebView 內收合/展開偵測腳本、沉浸狀態廣播。
- `tests/ui/readerRetrySignal.test.ts` — 回前景/回讀經頁自動重試訊號。
- `tests/ui/readerDailyFlow.test.ts` — DOM bridge 訊息（捲動方向、邊界）的編碼/解碼。
- `tests/ui/readerCompactHeaderContract.test.ts` — 隱藏 SDK 原生標題、精簡頁首樣式的字串契約。
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
