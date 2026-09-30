# 讀經計畫與每日完成

> 狀態：0.5.22 候選已實作，尚未發布｜平台：Android、iOS（差異見「平台差異」）｜2026-09-30 核對

## 一句話

App 每天顯示當天該讀的經文段落，讀完按一下就完成打卡並計分；錯過的日子七天內都還能補登，換手機或斷線也不會遺失完成記錄。

## 從哪裡進

- 底部導覽「讀經」分頁（`app/(tabs)/reader.tsx`）：App 開啟後預設就落在這一頁。
- 「積分」分頁最上方的讀經月曆卡片（`src/ui/gamification/ReadingCalendarCard.tsx`），可以另外選一天查看或補登。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 開啟日期 | 打開 App 落在「今天」（在計畫月份範圍內時），若今天不在計畫月份範圍內就落在計畫最早或最晚一天 |
| 讀經器日期列 ‹ › | 頂部一行日期，寫著「今天‧9/30（三）」；左右箭頭只能跳到有排定讀經的日子，跳不動就變灰 |
| 當日章節 chips | 日期列下方一排小標籤，每個代表當天的一段經文，點哪個看哪個 |
| 完成打卡 | 讀經器右下角一個圓圈按鈕，按下去變成勾勾；讀完當天最後一段時圓圈會展開顯示「完成今日讀經」字樣 |
| 補登期限 | 今天以及回溯 6 個台北日曆天（共 7 天）內都能打卡；超過就鎖住，只能繼續閱讀，不能打卡 |
| 撤銷完成 | 按已完成的勾勾會先跳出確認對話框，確認後才撤銷，積分也會一併收回 |
| 積分月曆 | 積分頁上方月曆格，綠色是完成的日子，深色框是今天，另一色框是目前選取的日子 |
| 跨手機完成 | 在另一支手機完成的日子，這支手機也顯示「已完成」，但沒有可以撤銷的按鈕 |
| 離線完成 | 沒有網路時完成一樣會先記住，畫面顯示「等待同步」，恢復連線後自動送出 |
| 整份讀經計畫清單 | 按月份看全部讀經日，今天標底色、讀完打 ✓；點一天就去讀 |

## 行為規格

### 讀經計畫的內容
來源：`src/domain/readingPlanImport.ts`

- 9 月的內容是既有資料（`data/september-2026.json`），10 月起讀教會 Excel 表（`data/source/2026-reading-plan-cells.json`），1 月到 8 月不含在計畫內，因為 App 上線前就已經讀過（`buildReadingPlan2026`，`readingPlanImport.ts:82-107`）。
- 每天的內容是「溫故」「知新」與詩篇三行合併成的一份經文清單；「安息」與空白格不會排進計畫，所以安息日這天沒有排定讀經（`planDaysFromCells`，`readingPlanImport.ts:62-67`）。
- 已知更正：教會表格把 10/15、10/16 的詩篇119篇前後段排反了；App 保留更正後的順序（10/15 讀 1-88 節，10/16 讀 89-176 節），不顯示更正說明。原始表格不改，修訂版本仍為 2（`SHEET_CORRECTIONS`，`readingPlanImport.ts`）。
- 計畫的 planId 固定是 `church-2026-09`：完成記錄、積分都用這個 id 記帳，即使實際內容已經是 10 月以後的表（`readingPlanImport.ts:83-86`）。

### App 開啟時看到哪一天
來源：`src/domain/calendar.ts`（`getInitialReadingDate`，`calendar.ts:79-86`）

- 今天落在計畫涵蓋的月份內：直接開在今天，不論那天有沒有排定讀經（安息日仍會開在當天，只是顯示「沒有排定讀經」）。
- 今天比計畫第一個月更早：開在計畫的第一天。
- 今天比計畫最後一個月更晚：開在計畫最後一天。

### 讀經器日期列 ‹ ›
來源：`src/ui/FullscreenReaderLayout.tsx:266-281`（沿用 `src/ui/ReadingDateNavigator.tsx` 的日期文字格式化）

- 中間顯示「今天‧9/30（三）」（今天）或「10/1（四）」（非今天）（`formatReadingDateHeader`，`ReadingDateNavigator.tsx:17-20`）。
- 日期旁有小 ▾，點日期就打開「整份讀經計畫」，不會在打開清單時更換章節或停止朗讀。
- 左右箭頭只能跳到上一個/下一個「有排定讀經」的日子（`getAdjacentScheduledDates`，`calendar.ts:88-93`）；沒有更早或更晚的排定日時，箭頭變灰、按不動。
- 手機夠寬時箭頭旁邊會多顯示日期文字（例如「‹ 9/29」），太窄時只顯示箭頭本身（`showAdjacentDateLabels`，`FullscreenReaderLayout.tsx:220-224`）。

### 當日章節 chips
來源：`FullscreenReaderLayout.tsx:282-297`

- 每個排定的段落各一個 chip，用書卷簡稱加章數顯示（如「詩106」「多1」），跟 `docs/design/reader-page.md` §2「章節寫法」一致，點哪個就切到哪個段落，目前所在的段落是實心樣式。
- 目前讀的內容不在當天排定範圍內（自由閱讀）時，前面多一個「自由 ⋯」的 chip。
- 當天沒有排定讀經時，chips 區顯示提示文字：「這一天沒有排定讀經。{日期}仍可自由閱讀。」（`noPlanMessage`，`app/(tabs)/reader.tsx:391`）。

### 完成打卡的規則
來源：`src/domain/completion.ts`、`src/services/completionController.ts`、`src/services/useCompletionController.ts`、`server/gamification.ts`（`mutateCompletion`，`gamification.ts:785-851`）

- 完成一天得 1 分（`GAMIFICATION_POINT_AMOUNT = 1`，`gamification.ts:29`），同一天只會有一份有效得分。
- 只能在「今天以及回溯 6 個台北日曆天」的補登期限內打卡或撤銷，共 7 天（`COMPLETION_WINDOW_DAYS = 7`，`src/domain/gamificationV1.ts:2`，`isWithinCompletionWindow`）；超過期限，讀經器按鈕顯示「超過補登期限」且按不動，積分月曆顯示「已超過 7 天，不能補登」。
- 沒有排定讀經的日子（例如安息日）不能打卡：讀經器顯示「無排定讀經」。
- 未登入不能打卡：讀經器顯示「登入後完成」。
- 讀完當天最後一段（章節結尾）時，完成圓圈會展開成一個寫著「完成今日讀經」的按鈕，方便直接點下去（`completionExpanded`，`FullscreenReaderLayout.tsx:234`）。
- 撤銷完成前一定會先跳出確認對話框「確定撤銷 {日期} 的完成？這一天的積分會一併撤回。」，按「撤銷」才會真正撤銷（`completionController.ts:338`、`useCompletionController.ts:157-160`）。
- 如果那一天的積分已經被兌換獎品用掉，伺服器會拒絕撤銷（後端只在還有足夠可兌換餘額時才允許撤回，`POINTS_ALREADY_SPENT`，`gamification.ts:825`）；使用者端會看到撤銷沒有生效並保留同步錯誤提示。
- 在另一支手機已經完成的日子，這支手機的按鈕顯示「已完成」但不能撤銷（沒有本機記錄可以撤銷，避免看起來能撤銷卻什麼都不會發生）（`finishedElsewhere`/`undoable`，`app/(tabs)/progress.tsx:536,565-573`，`CompletionTodayButton.tsx:25-26`）。

### 離線與同步失敗
來源：`src/storage/outbox.ts`、`src/services/outboxRecovery.ts`、`src/services/gamificationPendingStore.ts`

- 完成或撤銷一律先寫進本機資料庫再嘗試送出：沒有網路或送出失敗時，畫面顯示「已記錄，等待同步」，按鈕仍是完成勾勾但標成待同步狀態（`SyncStatus = 'PENDING_SAVE'`，`completion.ts:3`）。
- App 回到前景（從背景切回、或重新打開）時會自動重送一次；持續失敗時以 10 秒起、每次加倍、最多 60 秒的間隔背景重試（`createOutboxRecoveryController`，`outboxRecovery.ts:56-92`）。
- 同步一直失敗但本機仍有紀錄時，按鈕標成「重試同步完成記錄」，可以手動再按一次觸發重送（`buildCompletionTodayButtonModel`，`CompletionTodayButton.tsx:22-38`）。
- 完全無法重送（沒有待送出的紀錄卻標成失敗）時，按鈕鎖住並顯示「完成記錄未同步，無法重試」。
- 加分只會在伺服器確認同步成功後才顯示：「+1 分　完成今日讀經了！」的提示會淡入、停留約 1.75 秒、淡出（`CompletionAwardFeedback.tsx:7-11,29-41`）；同步中則顯示「已記錄，等待同步。同步成功後才會顯示加分。」

### 跨手機同一天
來源：`src/services/completionController.ts`、`app/(tabs)/progress.tsx:504-524`

- 換手機或另一支手機登入同一帳號完成打卡時，只要這支手機的積分頁在前景、有對到帳號與那一天，就會收到伺服器確認事件並立刻把那一天畫成已完成（`subscribeCompletionAwardSurface`/`onCompletionConfirmed`）。
- 這個事件只在同一裝置的畫面「當時在前景且對得上同一登入」才會送達；不在前景時，事件會保留最多 5 秒等下一次畫面出現再補送（`COMPLETION_EVENT_BRIDGE_TTL_MS = 5000`，`completionController.ts:21`），過了 5 秒就不再補送，改由下次開啟該日期時的一般讀取取得最新狀態。

### 積分頁的讀經月曆
來源：`src/ui/gamification/ReadingCalendarCard.tsx`、`src/ui/gamification/readingCalendarModel.ts`

- 月曆以週日為第一欄（`monthCells`，`readingCalendarModel.ts:86-91`，2026-09-27 決定）。
- 每一天的狀態只有五種：`open`（可以打卡）、`completed`（已完成，綠色）、`expired`（超過期限）、`rest`（這天沒有讀經）、`future`（還沒到）（`dayState`，`readingCalendarModel.ts:55-60`）。
- 先判斷有沒有排定讀經：未來的安息日也顯示「這天沒有讀經」，不會叫人當天回來打卡。未來日期的格子淡化，但被選取的格子恢復清楚的文字與選取框。
- 有讀經的日子一律顯示日期與經文，包含未來與過期日期；日期右邊可點「整份計畫 ›」打開共用清單。選到 `expired`/`rest`/`future` 時保留原本說明，不出現完成按鈕：
  - 超過期限：「{日期}已超過 7 天，不能補登」
  - 沒有讀經：「{日期}這天沒有讀經」
  - 還沒到：「{日期}還沒到，當天再來打卡」
- 預設選取的日子：今天有排定讀經就選今天；否則往前找 7 天內最近一個「有排定但還沒完成」的日子；再找不到就還是選今天（`defaultSelectedDate`，`readingCalendarModel.ts:70-83`）。
- 月份導覽箭頭只能翻到計畫實際涵蓋的月份範圍內（`app/(tabs)/progress.tsx:561-562`）。
- 沒有讀經的日子只顯示原本說明與清單入口，不顯示不存在的經文；月曆和清單都不顯示計畫更正說明。

### 整份讀經計畫清單

- 兩個入口使用同一個 `src/ui/ReadingPlanSheet.tsx`：讀經頁點日期；積分月曆選取日期旁的「整份計畫 ›」。
- 標題「整份讀經計畫」；副標由實際計畫和完成記錄計算，例如「9/1–12/31，共 105 天，已讀 14 天」。依月份分段，每列是日期/經文/完成 ✓；今天另有底色與「今天」。
- 打開時依實際排版位置捲到今天，只定位一次，後續手動捲動不被拉回。今天沒有讀經時落在下一個讀經日；計畫範圍外落在最近的一端。
- 點任一天關閉清單並開到那天；從積分入口選日期時切到讀經頁。此操作不打卡，也不改變補登期限。
- 打開時一次讀取各月的完成記錄（符合既有 API 62 天範圍上限），關閉時不讀取、不輪詢。本機待同步/失敗的完成意圖優先於遠端；其餘使用較新的修訂。
- 離線時仍可看完整內建計畫與手機上的完成記錄，會顯示「尚未連上更新，先顯示這支手機的完成記錄。」。換帳號或關閉清單後的舊回應不會更新目前畫面。

## 決定（為什麼這樣做）

**刻意不做：**

- **不顯示讀經計畫的更正說明**：保留更正後的經文順序，日期列、月曆、清單都不再加入說明小字。（維護者 2026-09-30 決定）
- **清單兩個入口共用一個元件**：讀經頁與積分月曆都用 `ReadingPlanSheet`，只維護一處，日期與完成記錄也從同一份計畫取得。（維護者 2026-09-30 決定）

- **完成打卡是整天手動確認一次，不逐章打勾**：即使一天排了好幾段經文，完成的判定與得分都只在按下「完成今日讀經」那一刻發生一次。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「完成」）
- **換日期與換章分開**：換日期用頁首箭頭或整份計畫清單；最後一段的「繼續讀」不會跳到明天。原本「只用頁首箭頭」已由 2026-09-30 的清單決定取代。（來源：[../design/reader-page.md](../design/reader-page.md) §2 已定案「日期」）
- **超過 7 天補登期限後不能再打卡或撤銷，但經文本身仍可以自由閱讀**：期限只鎖積分，不鎖內容。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL05）

- **完成一天固定得 1 分，同一人同一天最多一份有效得分**：不會因為那天讀了好幾段就重複給分。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL04）
- **已經被兌換用掉的積分不能撤銷讀經完成**：伺服器只在還有足夠可兌換餘額時才允許撤回打卡，避免餘額變成負的；畫面會顯示「這筆積分已用於兌換，請聯絡維護者處理。」。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §3.5）

- **積分頁月曆以週日為第一欄**：維護者 2026-09-27 指定，原因沒有記錄。（來源：`src/ui/gamification/readingCalendarModel.ts:85` 註解）

## 平台差異

此區塊（讀經計畫、日期列、章節 chips、完成打卡、離線同步、積分月曆）是 Android、iOS 共用的同一份程式碼與畫面，沒有已知的平台差異（`AGENTS.md`「兩個平台一起改」）。

## 資料與後端

- 讀經計畫存在後端 `reading_days` 表（`task_date`、`plan_id`、`references_json`、`source_revision`、`source_digest`），每次啟動時只會把「日期還沒有」或「修訂版本比資料庫新」的日子寫進去，不會覆蓋已存在且版本相同或更新的資料（`syncReadingDays`、`seedReadingDays`，`server/gamification.ts:247-302`）。App 內建的預設清單即 `defaultReadingDays()`（`gamification.ts:285-287`）。
- 完成記錄同時存在手機本機資料庫與伺服器，兩邊用同一份表結構（`member_id`、`plan_id`、`task_date`、`status`、`revision`、`sync_status`、`last_operation_id`），定義在 `src/storage/schema.ts`（`LOCAL_SCHEMA`），伺服器建庫時也套用同一份 schema（`server/db.ts:4,48`）。這是離線寫入之後能原樣送到伺服器確認的基礎。
- 每次完成或撤銷都帶一個獨一無二的 `operationId`：伺服器用它避免同一個操作被重複計分或重複扣分（idempotent），並用 `expectedRevision` 偵測「這支手機看到的版本」跟「伺服器目前版本」是否一致，避免兩支手機同時改到同一天造成衝突（`mutateCompletion`，`server/gamification.ts:785-851`）。
- 積分實際上是三份資料算出來的：`daily_point_entitlements`（誰在哪天有效得分）、`wallet_entries`（可兌換餘額的加減記錄）、以及仍保留但已不是計分依據的舊表 `point_events`（只為相容舊版 App/舊報表而繼續寫入，`gamification.ts:840`）。

## 守住它的測試

| 測試檔 | 內容 |
|---|---|
| `tests/domain/calendar.test.ts` | 讀經計畫的日期查找、月份範圍、開啟日期規則 |
| `tests/domain/completion.test.ts` | 完成/撤銷的狀態機（APPLIED、IDEMPOTENT_REPLAY、CONFLICT） |
| `tests/domain/readingPlan2026.test.ts` | 2026 計畫合併（9 月資料＋10 月表）與詩119更正規則 |
| `tests/integration/completionFlow.test.ts` | 完成打卡從畫面到伺服器的端到端流程 |
| `tests/server/completions.test.ts` | 後端完成 API（補登期限、衝突、重放）規則 |
| `tests/services/completionController.test.ts` | 完成/撤銷控制器的核心邏輯 |
| `tests/services/completionAwardBridge.test.ts` | 加分事件跨畫面（讀經器/積分頁）遞送與逾時規則 |
| `tests/services/completionControllerReminder.test.ts` | 完成打卡與讀經提醒排程的互動 |
| `tests/services/reminderCompletion.test.ts` | 完成後對應提醒的調整 |
| `tests/ui/completionAwardFeedback.test.ts` | 加分提示的文字與動畫時序 |
| `tests/ui/completionFeedback.test.ts` | 完成/撤銷提示列文字與按鈕 |
| `tests/ui/completionProfileSync.test.ts` | 完成事件同步進積分頁面的總積分/餘額 |
| `tests/ui/completionTodayButton.test.ts` | 完成按鈕在各種狀態下的文字與是否可按 |
| `tests/ui/readingDateNavigator.test.ts` | 日期列文字格式化與跳頁邏輯 |
| `tests/ui/readingSessionDynamic.test.ts` | 讀經 session store（選取日期、外部跳轉、日記借用日期） |
| `tests/ui/readingTaskCard.test.ts` | 舊版讀經卡片元件（`ReadingTaskCard`） |
| `tests/ui/readingCalendar.test.ts` | 積分頁讀經月曆模型（狀態、預設選取日） |
| `tests/ui/progressCalendar.test.ts` | 積分頁月曆卡片畫面 |
| `tests/ui/readingPlanSheet.test.ts` | 105 天分月、完成勾選與計數、今天定位、選日期、離線、關閉時沒有請求 |
| `tests/ui/fullscreenReaderLayout.test.ts` | 讀經器整頁版面：日期列、章節 chips、完成按鈕展開 |
| `tests/storage/outbox.test.ts` | 離線佇列的送出、失敗中止規則 |
| `tests/services/outboxRecovery.test.ts` | 背景重試退避（10 秒起，加倍到 60 秒） |
| `tests/services/useOutboxRecovery.test.ts` | App 回前景時掛上重試的 hook |
| `tests/ui/gamificationPendingStore.test.ts` | 待送出操作的安全儲存（也覆蓋積分頁兌換/撤銷佇列） |

## 相關文件

- `docs/design/reading-gamification-v1.md`：積分/獎品/好友原始設計規格（含讀經完成計分規則 CL04、CL05），只看資料模型與 API 細節，不要照抄成現況——實際功能已多出提名投票、社群進度等 v1 沒有的部分（詳見 `points.md`）。
- `docs/superpowers/plans/2026-09-29-ios-parity*.md`：iOS 移植計畫。

## 已知限制與待辦

- 使徒行傳 7:30 在計畫裡沒有排到（表裡是 `ACT.7.1-29` 接 `ACT.7.31-60`），疑似教會原始表格的筆誤，待教會確認。
- `src/ui/ReadingDateNavigator.tsx` 匯出的 `ReadingDateNavigator` 元件本身目前沒有在任何畫面上以元件形式渲染——讀經器用的是同檔案的日期文字格式化函式自行畫日期列（見上方「讀經器日期列」）。是否要改回直接用這個元件、或移除未使用的元件本身，待技術決定。
- `src/ui/completionFeedback.tsx` 的 `CompletionFeedback` 元件與 `src/ui/ReadingTaskCard.tsx` 內建的（另一個同名）完成提示，目前都沒有被任何現行畫面使用；讀經器與積分頁用的是各自內建的完成提示（`CompletionAwardFeedback`/inline 訊息）。

