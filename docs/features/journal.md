# 靈修日記

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

登入會員每天可以寫一篇私人的靈修日記，只存在自己的裝置和自己的帳號下；可以整份匯出，Android 另外可以同步存到自己選的資料夾。

## 從哪裡進

底部分頁「日記」（`app/(tabs)/_layout.tsx`：`Tabs.Screen name="journal"`）。從「讀經」分頁切到「日記」時，編輯器會自動帶出目前讀經頁選中的那一天（`app/(tabs)/_layout.tsx:47-50` 呼叫 `setJournalEntryDate`）；直接點「日記」分頁（不是從讀經頁切過去）則預設是台北時間的今天。

在讀經器裡複製一段經文後，切到日記會看到「插入剛複製的經文：…」的提示條，點一下才會插入，不會自動貼上（`app/(tabs)/reader.tsx` 的 `onVerseCopied={setPendingJournalQuote}` → `app/(tabs)/journal.tsx:199-201`）。

## 功能一覽

| 功能 | 使用者看到什麼 |
| --- | --- |
| 寫日記 | 一個多行文字框，最多 4000 字，兩秒沒動作自動存 |
| 儲存狀態 | 文字框下方一行「尚未儲存/已儲存 HH:MM」，還有一個「儲存」按鈕 |
| 換日期 | 標題兩側「‹」「›」箭頭；不能切到未來的日期 |
| 插入複製的經文 | 一條可以點的提示條，點了才插入 |
| 歷史記錄 | 列出這個帳號在這台裝置上寫過的每一天，點一下切換過去 |
| 匯出全部 | 把所有寫過的日子整理成一份 Markdown，交給系統分享 |
| 同時存到我選的資料夾（僅 Android） | 選一個資料夾後，每天存檔會多存一份 `.md` 到那裡 |
| 朗讀控制 | 分頁右上角一顆播放鈕，可以在寫日記時繼續控制正在播放的讀經朗讀 |

## 行為規格

### 撰寫與自動儲存
- 打字後 2 秒沒有新的輸入，自動存到本機（`src/ui/useJournalEntry.ts:22,125-130`，`SAVE_DEBOUNCE_MS = 2_000`）。
- 文字框失去焦點（`onBlur`）、切換日期、或離開這個 hook（換頁/登出）時，會立刻把還沒存的內容存下來，不等 2 秒（`src/ui/useJournalEntry.ts:104-122`；`app/(tabs)/journal.tsx:107-111,194`）。
- 「儲存」按鈕會立即存檔並把狀態文字換成「已儲存 HH:MM」；已經是已儲存狀態時按鈕會停用（`src/ui/JournalSaveBar.tsx`）。
- 每篇最多 4000 個字（Unicode 字元計數），輸入框本身也限制 `maxLength={4000}`；後端超過會拒絕存檔（`server/journal.ts:23,118`；`app/(tabs)/journal.tsx:188`）。
- 未登入時看到「登入後才能查看和保存自己的日記。」，輸入框也不能編輯（`app/(tabs)/journal.tsx:183,189`）。

### 一天一篇
- 本機和伺服器都以「會員＋日期」為主鍵：同一天再寫，是更新同一筆，不會變成第二篇（`src/storage/journalStore.ts:85`；`server/journal.ts:53`）。
- 標題兩側「‹」「›」箭頭換到別的日期時編輯器內容跟著換；不能切到比今天（台北時間）更晚的日期，「›」箭頭會變灰且停用（`app/(tabs)/journal.tsx:124-134,164,174`）。
- 「歷史記錄」列出這個會員在這台裝置上寫過、且內容非空白的每一天，直接點一筆就切過去編輯（`src/storage/journalStore.ts:211-218`；`app/(tabs)/journal.tsx:209-221`）。

### 草稿與離線
- 每一次存檔都會先寫進本機 SQLite（`qingmu_journal_entries`），同一個交易裡再把這次要送出的內容放進一個離線佇列 `qingmu_journal_outbox`（同一天只留最新一筆，不會累積四十筆）（`src/storage/journalStore.ts:75-143`，模組頂端註解說明合併理由）。
- 沒有網路或沒登入時一樣可以打字、一樣會自動存到本機；畫面上會出現「尚未上傳」提示，且不會消失（見下一節）。

### 同步到伺服器（下載方向已接上，上傳方向目前沒有呼叫端）
- **下載/併入**：登入或切換帳號時，App 會向伺服器要最近 400 天的日記（`app/(tabs)/journal.tsx:34,138-153`；`server/journal.ts:25` 的 `MAX_RANGE_DAYS = 400` 剛好卡在這個範圍上），把「本機這台裝置還沒有排入離線佇列」的那些日子用伺服器版本覆蓋、標成 `CONFIRMED`；只要本機那天有還沒送出的編輯，一律保留本機內容不覆蓋（`src/storage/journalStore.ts:229-244` `adoptRemote`）。
- **上傳**：`src/storage/journalStore.ts` 的 `flush`/`flushOnce`（把離線佇列送到伺服器、處理 409 衝突）和 `src/services/journalApiClient.ts` 的 `saveEntry`（真正呼叫 `PUT /api/me/journal/:date`）都已經寫好並各自有測試，但目前在 `app/` 或 `src/` 裡找不到任何地方呼叫它們──只有 `tests/services/journalRoundTrip.test.ts` 這樣串起來測試過。也就是說目前這台裝置寫的日記**不會真的上傳到伺服器**，只有「把伺服器上其他裝置寫的內容併入本機」這個方向在跑。
- 因為上傳從未真的發生，畫面上「尚未上傳」（`syncStatus === 'PENDING_SAVE'`）在目前的正式流程裡，寫過的那一天會一直顯示，不會變成別的狀態；同一段程式碼裡準備好的衝突畫面「這一天的日記在其他裝置上已更新，你的內容尚未上傳。」與「仍要儲存」按鈕（`app/(tabs)/journal.tsx:202-207`；`src/ui/useJournalEntry.ts:151,158`）也因此在目前的正式流程中不會被觸發（它需要一次真正的上傳先失敗在 409，才會進入這個狀態）。這段邏輯本身（若真的上傳，遇到別裝置的更新時保留本機內容、由使用者決定要不要覆寫）在 `src/storage/journalStore.ts:180-198`、`server/journal.ts:99-149` 是完整且有測試的。

### 插入複製的經文
- 提示條顯示的是「插入剛複製的經文：（內容）」，必須點一下才會接到目前草稿最後一行；不點就只是留在剪貼簿/暫存狀態，不會自動出現在日記裡（`app/(tabs)/journal.tsx:199-201`；`src/ui/useJournalEntry.ts:132-135`）。

### 朗讀控制
- 分頁右上角的按鈕（`src/ui/ReaderAudioBridgeButton.tsx`）不會在日記頁另外播放什麼，它是讀經器朗讀播放器的遠端遙控：可以在寫日記的同時暫停/繼續/重試目前讀經器正在播放的那一章朗讀；沒有朗讀在播、或本章沒有朗讀時按鈕會停用。

### 同時存到我選的資料夾（僅 Android）
- 只有 Android 會出現「同時存到我選的資料夾」按鈕；iOS 因為沒有對應的長期資料夾授權 API，不會顯示（`src/ui/journalFolderSync.ts`；`app/(tabs)/journal.tsx:228`）。
- 第一次點下去會跳出系統的資料夾選擇器；選好後會立刻把這個帳號目前所有寫過的日子都補寫一份到這個資料夾，並回報「已寫入 N 天到你選的資料夾」（`app/(tabs)/journal.tsx:73-93`）。
- 每一天存成一個檔案 `YYYY-MM-DD.md`，檔頭有 `source: qingmu-journal` 的 front matter；之後每次存檔都會多寫一份到這個資料夾（`src/domain/journalMirror.ts`）。
- 如果資料夾裡已經有同名檔案、但不是這個 App 寫的（沒有那段 front matter），會跳過不覆寫，並回報「N 天因為資料夾裡已經有同名檔案而跳過」，避免蓋掉使用者自己原本的筆記（`src/domain/journalMirror.ts:36-59`；`app/(tabs)/journal.tsx:81,84`）。
- 資料夾寫入失敗（授權被收回、SD 卡拔掉等）不會影響日記本身的存檔──日記已經先存進本機，資料夾只是額外的一份拷貝（`src/services/journalFolderMirror.ts` 模組註解；`src/ui/useJournalEntry.ts:95,120`）。
- 「停止同步」只是清掉這個裝置記住的資料夾授權，已經寫出去的檔案留在原地不會被刪除（`app/(tabs)/journal.tsx:233-235`）。
- 選的資料夾用一段可讀的路徑顯示（例如「內部儲存空間」或「…/Documents/Obsidian」），不是原始的 `content://` 網址（`src/domain/folderPath.ts`）。
- 資料夾授權是每個會員各自存一份（用會員 ID 編碼成 key），同一支手機換帳號登入不會共用到別人選的資料夾（`src/services/journalFolderMirror.ts:33-36`）。

### 匯出全部與分享
- 「匯出全部」把這個會員寫過的所有日子（依日期排序、跳過完全空白的日子）整理成一份 Markdown，用「## YYYY年M月D日」分段；完全沒內容時輸出「（還沒有內容）」（`src/domain/journalExport.ts`）。
- 匯出的檔案名稱固定是英文 `qingmu-journal.md`（不用中文檔名，避免分享對象把檔名弄亂）（`src/ui/journalShare.ts:25-26`）。
- 分享的方式依序嘗試：先試著把檔案交給系統分享面板（可以存進「檔案」、雲端硬碟等）；不行的話改成分享純文字；還是不行就複製到剪貼簿。畫面上分別回報「已匯出 N 天」「已複製 N 天到剪貼簿」或「匯出失敗，請再試一次」（`src/ui/journalShare.ts:18-50`；`app/(tabs)/journal.tsx:160-161`）。
- 「匯出全部」按鈕只在這個會員已經有至少一篇日記時才會出現（`app/(tabs)/journal.tsx:223`）。

### 隱私（誰能看到日記）
- 伺服器上的每一個日記端點都只認「發這個請求的人自己」，沒有任何一條路徑可以指定「查別人的日記」；日記內容不會進計點、排行榜或稽核用的資料表，管理員能看到的日記就是零（`server/journal.ts` 檔頭註解與整份實作；沒有 memberId 以外的參數）。
- 日記文字只出現在 `journal_entries.body`（伺服器）與 `qingmu_journal_entries.body`（本機），修改記錄（mutation receipt）只存版本號和時間，不存內容本身（`server/journal.ts:18-21,144-146`）。

## 平台差異

| 項目 | Android | iOS |
| --- | --- | --- |
| 同時存到我選的資料夾 | 有（Storage Access Framework） | 沒有，改用「匯出全部」→ 系統分享面板存到「檔案」（`AGENTS.md` 第 6 點） |
| 鍵盤避讓 | 依鍵盤是否彈出切換 `KeyboardAvoidingView` 是否啟用 | 一律啟用 |
| 匯出、朗讀控制、插入經文 | 相同 | 相同 |

## 資料與後端

- 本機：SQLite 表 `qingmu_journal_entries`（目前內容）與 `qingmu_journal_outbox`（待上傳，見上「同步到伺服器」）（`src/storage/journalStore.ts`）。
- 伺服器：SQLite 表 `journal_entries`，以 `(member_id, task_date)` 為主鍵，`revision` 做樂觀鎖（`server/journal.ts:42-57`）。
- 端點（皆需登入）：`GET /api/me/journal?from=&to=`、`GET /api/me/journal/:date`、`PUT /api/me/journal/:date`（`server/routes.ts:521-548` 附近；沒有會員參數，一律用登入者自己的 memberId）。
- 傳輸層：`src/services/journalApiClient.ts`（目前只有 `listEntries`/`getEntry` 這兩個讀取方法有被呼叫；`saveEntry` 已寫好但沒有呼叫端，見上）。
- 資料夾同步：`src/services/journalFolderMirror.ts` + `src/domain/journalMirror.ts` + `src/ui/journalFolderSync.ts` + `src/domain/folderPath.ts`。
- 匯出：`src/domain/journalExport.ts` + `src/ui/journalShare.ts` + `src/ui/systemShare.ts`。
- `server/claudeCli.ts`（執行本機 Claude CLI 的沙盒）**與日記無關**：唯一呼叫端是 `server/nominationAssist.ts`，用來幫「提名獎品」估價與潤飾文字，跟日記是兩個功能。
- `src/ui/JournalPanel.tsx`（一個滑上來的日記面板元件，行為與分頁版一樣經由 `useJournalEntry`）目前沒有被任何畫面引用；找到的唯一使用者是它自己的測試（`tests/ui/journalQuoteOffer.test.ts`、`tests/ui/journalKeyboardAvoidance.test.ts`）。目前唯一上線的日記介面是分頁版 `app/(tabs)/journal.tsx`。

## 守住它的測試

- `tests/domain/journalExport.test.ts` — 匯出的 Markdown 依日期排序、跳過空白日、完全沒內容時顯示「（還沒有內容）」。
- `tests/domain/journalMirror.test.ts` — 資料夾檔名規則，以及「自己寫的檔案可以覆寫、別人的檔案要跳過」的判斷。
- `tests/server/journal.test.ts` — 伺服器端只認呼叫者自己的日記，沒有能指定「別人」的路由，內容不進計點/稽核資料表。
- `tests/services/journalRoundTrip.test.ts` — 把本機 store、傳輸層、伺服器三者串起來驗證：離線存檔、上傳後確認、真衝突回報為衝突而不是無限重試（目前這條串接只在測試裡跑過，見「同步到伺服器」一節）。
- `tests/storage/journalStore.test.ts` — 本機 SQLite 的交易與離線佇列合併行為（用真的 SQLite，不是假物件）。
- `tests/ui/journalEntryHook.test.ts` — `useJournalEntry` 的兩個防止漏字保護：debounce 還沒觸發就離開、切換日期後才回來的舊讀取不會蓋掉新內容。
- `tests/ui/journalFolderSync.test.ts` — 「同時存到我選的資料夾」只在 Android 提供。
- `tests/ui/journalKeyboardAvoidance.test.ts` — 面板在 Android 鍵盤彈出/收起時的避讓行為。
- `tests/ui/journalQuoteOffer.test.ts` — 讀經器複製的經文以提示條方式提供，不會自動插入。
- `tests/ui/journalSaveBar.test.ts` — 儲存列的三種狀態（沒內容/未儲存/已儲存）與已儲存時間的顯示。
- `.maestro/ios/41-journal.yaml` — iOS 端對端：確認畫面上不會出現「同時存到我選的資料夾」，且寫完一篇後「匯出全部」會出現。

## 相關文件

- 兩平台共通規則、iOS 資料夾同步限制的原因：repo 的 `AGENTS.md` 第 6 點。
- 讀經朗讀本身（跟讀朗讀、跟隨捲動）：`docs/superpowers/plans/2026-09-29-read-along-follow.md`（日記頁上的朗讀鈕只是這個播放器的遙控，行為定義在那裡）。

## 已知限制與待辦

- **上傳到伺服器目前沒有接上**：本機的離線佇列與傳輸層都寫好且有測試，但 App 裡沒有任何呼叫端會真的執行上傳；因此寫在一台裝置上的日記不會出現在另一台裝置上，「尚未上傳」會一直顯示，衝突畫面（「仍要儲存」）不會在正式流程中出現。這是目前找到最值得先確認方向的一點。
- `src/ui/JournalPanel.tsx` 是一個功能完整、但沒有被任何畫面引用的元件，只被自己的測試使用；如果不打算之後接上某個入口，可以考慮移除以免之後誤用。
- 沒有找到「日記可以設密碼或加密」之類的額外保護；隱私完全靠伺服器的存取控制（只認自己）。
