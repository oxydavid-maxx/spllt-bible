# 讀經計畫與每日完成

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

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
| 更正說明 | 教會表格排版錯誤更正後，那一天在讀經器與月曆都多一行提示文字 |
| 跨手機完成 | 在另一支手機完成的日子，這支手機也顯示「已完成」，但沒有可以撤銷的按鈕 |
| 離線完成 | 沒有網路時完成一樣會先記住，畫面顯示「等待同步」，恢復連線後自動送出 |
| 整份讀經計畫清單 | 規劃中，見文末「規劃中（0.5.22）」 |

## 行為規格

### 讀經計畫的內容
來源：`src/domain/readingPlanImport.ts`

- 9 月的內容是既有資料（`data/september-2026.json`），10 月起讀教會 Excel 表（`data/source/2026-reading-plan-cells.json`），1 月到 8 月不含在計畫內，因為 App 上線前就已經讀過（`buildReadingPlan2026`，`readingPlanImport.ts:82-107`）。
- 每天的內容是「溫故」「知新」與詩篇三行合併成的一份經文清單；「安息」與空白格不會排進計畫，所以安息日這天沒有排定讀經（`planDaysFromCells`，`readingPlanImport.ts:62-67`）。
- 已知更正：教會表格把 10/15、10/16 的詩篇119篇前後段排反了；App 已改成照經文順序讀（10/15 讀 1-88 節，10/16 讀 89-176 節），並在這兩天顯示提示文字：「讀經表原本把 10/15、10/16 的詩119 前後段排反了，這裡已改成照經文順序讀。」（`SHEET_CORRECTIONS`，`readingPlanImport.ts:70-80`）。
- 計畫的 planId 固定是 `church-2026-09`：完成記錄、積分都用這個 id 記帳，即使實際內容已經是 10 月以後的表（`readingPlanImport.ts:83-86`）。

### App 開啟時看到哪一天
來源：`src/domain/calendar.ts`（`getInitialReadingDate`，`calendar.ts:79-86`）

- 今天落在計畫涵蓋的月份內：直接開在今天，不論那天有沒有排定讀經（安息日仍會開在當天，只是顯示「沒有排定讀經」）。
- 今天比計畫第一個月更早：開在計畫的第一天。
- 今天比計畫最後一個月更晚：開在計畫最後一天。

### 讀經器日期列 ‹ ›
來源：`src/ui/FullscreenReaderLayout.tsx:266-281`（沿用 `src/ui/ReadingDateNavigator.tsx` 的日期文字格式化）

- 中間顯示「今天‧9/30（三）」（今天）或「10/1（四）」（非今天）（`formatReadingDateHeader`，`ReadingDateNavigator.tsx:17-20`）。
- 左右箭頭只能跳到上一個/下一個「有排定讀經」的日子（`getAdjacentScheduledDates`，`calendar.ts:88-93`）；沒有更早或更晚的排定日時，箭頭變灰、按不動。
- 手機夠寬時箭頭旁邊會多顯示日期文字（例如「‹ 9/29」），太窄時只顯示箭頭本身（`showAdjacentDateLabels`，`FullscreenReaderLayout.tsx:220-224`）。

### 當日章節 chips
來源：`FullscreenReaderLayout.tsx:282-297`

- 每個排定的段落各一個 chip，用中文簡稱顯示（如「創世記1章」），點哪個就切到哪個段落，目前所在的段落是實心樣式。
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
- 選到 `expired`/`rest`/`future` 的日子時，月曆下方只顯示一行說明，不出現完成按鈕：
  - 超過期限：「{日期}已超過 7 天，不能補登」
  - 沒有讀經：「{日期}這天沒有讀經」
  - 還沒到：「{日期}還沒到，當天再來打卡」
- 預設選取的日子：今天有排定讀經就選今天；否則往前找 7 天內最近一個「有排定但還沒完成」的日子；再找不到就還是選今天（`defaultSelectedDate`，`readingCalendarModel.ts:70-83`）。
- 月份導覽箭頭只能翻到計畫實際涵蓋的月份範圍內（`app/(tabs)/progress.tsx:561-562`）。
- 選到有更正說明的日子（如 10/15、10/16）時，月曆下方會多顯示那一天的提示文字（`note`，`ReadingCalendarCard.tsx:31-32,76`）。

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

## 規劃中（0.5.22）

- 整份讀經計畫清單：一份共用的清單元件，從兩個地方打開——讀經頁點上方日期、積分月曆下方的「整份計畫」。按月份分段、打開時捲到今天、讀完的日子打勾、有更正說明的日子多一行小字、點任一天就去讀那天。畫面等 mock 確認後實作。
