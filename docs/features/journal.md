# 靈修日記

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

登入會員每天可以寫一篇私人的靈修日記。**日記只存在自己的手機，不會上傳到伺服器**（隱私決定，見「決定」）；可以整份匯出，Android 另外可以同步存到自己選的資料夾。

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
- 本機以「會員＋日期」為主鍵：同一天再寫，是更新同一筆，不會變成第二篇（`src/storage/journalStore.ts:85`）。
- 標題兩側「‹」「›」箭頭換到別的日期時編輯器內容跟著換；不能切到比今天（台北時間）更晚的日期，「›」箭頭會變灰且停用（`app/(tabs)/journal.tsx:124-134,164,174`）。
- 「歷史記錄」列出這個會員在這台裝置上寫過、且內容非空白的每一天，直接點一筆就切過去編輯（`src/storage/journalStore.ts:211-218`；`app/(tabs)/journal.tsx:209-221`）。

### 草稿與離線
- 每一次存檔都會先寫進本機 SQLite（`qingmu_journal_entries`），同一個交易裡再把這次要送出的內容放進一個離線佇列 `qingmu_journal_outbox`（同一天只留最新一筆，不會累積四十筆）（`src/storage/journalStore.ts:75-143`，模組頂端註解說明合併理由）。
- 沒有網路或沒登入時一樣可以打字、一樣會自動存到本機；畫面上會出現「尚未上傳」提示，且不會消失（見下一節）。

### 伺服器：照決定不上傳（還留著的舊程式）
- **日記內容不會送到伺服器**：App 裡沒有任何地方呼叫上傳（`src/storage/journalStore.ts` 的 `flush`/`flushOnce`、`src/services/journalApiClient.ts` 的 `saveEntry`）。這是刻意的，見「決定」。2026-09-30 查過正式伺服器，`journal_entries` 是 0 筆。
- 上傳和衝突處理的程式（`flush`、`saveEntry`、`PUT /api/me/journal/:date`、409 衝突時的「仍要儲存」畫面）是更早的設計留下來的，只在 `tests/services/journalRoundTrip.test.ts` 裡串起來過。**不要把它接上**；它跟決定衝突，待清理（見「已知限制與待辦」）。
- 登入或切換帳號時，日記頁仍會向伺服器要最近 400 天的日記並併入本機（`app/(tabs)/journal.tsx:34,138-153`；`src/storage/journalStore.ts:229-244` `adoptRemote`）。因為伺服器上沒有日記，拿回來是空的；這也是舊設計留下來的，待清理。
- 「尚未上傳」提示（`syncStatus === 'PENDING_SAVE'`，`app/(tabs)/journal.tsx:207`）因此在寫過的日子會一直顯示。它跟決定不一致，會讓人以為還沒存好，待修。

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
- 日記文字只存在手機的本機資料庫（`qingmu_journal_entries.body`，`src/storage/journalStore.ts`），不會送到伺服器，所以教會的管理者看不到任何人的日記。
- Android：正式版開著系統備份（產生的 `AndroidManifest.xml` 是 `android:allowBackup="true"`，沒有排除規則）。使用者手機若開著 Google 備份，日記可能隨 App 資料備份到**使用者自己的** Google 帳號，重裝時也可能被系統還原。這不經過本 App 的伺服器。
- 伺服器端留著的日記端點（見上一節）本身也只認「發請求的人自己」，內容不進計點、排行榜或稽核用的資料表（`server/journal.ts`）。

## 決定（為什麼這樣做）

刻意不做：

- **日記不上傳到伺服器**：日記是年輕人寫給自己的私人內容，不放到教會的伺服器。代價是換手機或重裝 App 時，日記不會從伺服器回來；要保存就用「匯出全部」，Android 也可以用「同時存到我選的資料夾」。（來源：維護者 2026-09-30 確認，當初開發時就是這樣定的；正式伺服器 `journal_entries` 0 筆）
- **舊文件寫反的地方，以本節為準**：2026-09-19 的 commit 說明寫「伺服器是日記唯一的本體」，`docs/play/privacy-policy.md` 原本也寫日記存在伺服器（已在 2026-09-30 改正）。
- **iPhone 沒有「同時存到我選的資料夾」**：iOS 沒有 Android 那種長期的資料夾權限，改用「匯出全部」存到「檔案」。（來源：[AGENTS.md](../../AGENTS.md) iOS 注意事項第 6 點）

## 平台差異

| 項目 | Android | iOS |
| --- | --- | --- |
| 同時存到我選的資料夾 | 有（Storage Access Framework） | 沒有，改用「匯出全部」→ 系統分享面板存到「檔案」（`AGENTS.md` 第 6 點） |
| 鍵盤避讓 | 依鍵盤是否彈出切換 `KeyboardAvoidingView` 是否啟用 | 一律啟用 |
| 匯出、朗讀控制、插入經文 | 相同 | 相同 |

## 資料與後端

- 本機：SQLite 表 `qingmu_journal_entries`（日記本身）與 `qingmu_journal_outbox`（舊設計的待上傳佇列，照決定不會送出）（`src/storage/journalStore.ts`）。
- 伺服器（舊設計留下，照決定不使用；正式伺服器 0 筆）：SQLite 表 `journal_entries`（`server/journal.ts:42-57`），端點 `GET /api/me/journal?from=&to=`、`GET /api/me/journal/:date`、`PUT /api/me/journal/:date`（`server/routes.ts`）。
- 傳輸層：`src/services/journalApiClient.ts`（登入時的下載用到 `listEntries`；`saveEntry` 照決定不接上）。
- 資料夾同步：`src/services/journalFolderMirror.ts` + `src/domain/journalMirror.ts` + `src/ui/journalFolderSync.ts` + `src/domain/folderPath.ts`。
- 匯出：`src/domain/journalExport.ts` + `src/ui/journalShare.ts` + `src/ui/systemShare.ts`。
- `server/claudeCli.ts`（執行本機 Claude CLI 的沙盒）**與日記無關**：唯一呼叫端是 `server/nominationAssist.ts`，用來幫「提名獎品」估價與潤飾文字，跟日記是兩個功能。
- `src/ui/JournalPanel.tsx`（一個滑上來的日記面板元件，行為與分頁版一樣經由 `useJournalEntry`）目前沒有被任何畫面引用；找到的唯一使用者是它自己的測試（`tests/ui/journalQuoteOffer.test.ts`、`tests/ui/journalKeyboardAvoidance.test.ts`）。目前唯一上線的日記介面是分頁版 `app/(tabs)/journal.tsx`。

## 守住它的測試

- `tests/domain/journalExport.test.ts` — 匯出的 Markdown 依日期排序、跳過空白日、完全沒內容時顯示「（還沒有內容）」。
- `tests/domain/journalMirror.test.ts` — 資料夾檔名規則，以及「自己寫的檔案可以覆寫、別人的檔案要跳過」的判斷。
- `tests/server/journal.test.ts` — 伺服器端只認呼叫者自己的日記，沒有能指定「別人」的路由，內容不進計點/稽核資料表。
- `tests/services/journalRoundTrip.test.ts` — 舊設計的上傳串接（本機 store、傳輸層、伺服器）。照決定 App 不走這條，待和舊程式一起清理。
- 還沒有測試守住「日記不上傳」這個決定（見「已知限制與待辦」）。
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

- 「尚未上傳」提示跟「不上傳」的決定不一致，寫過的日子會一直顯示，讓人以為還沒存好。應拿掉，或改成說明日記只存在這支手機。
- 舊的上傳程式、伺服器的日記端點、登入時的下載請求都還在，容易讓人以為上傳是「沒做完」。應清理，並加一條守衛測試：日記的程式不准呼叫網路，有人想接上時測試會失敗、訊息指向「決定」。
- 換手機或重裝時，日記不一定回得來（要看使用者有沒有匯出、有沒有開資料夾同步或 Android 系統備份）；日記頁上沒有提醒這一點。
- `src/ui/JournalPanel.tsx` 沒有被任何畫面使用，只被自己的測試引用。
- 日記存在 App 的本機資料裡，沒有另外設密碼或加密。
