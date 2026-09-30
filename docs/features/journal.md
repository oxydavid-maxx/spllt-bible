# 靈修日記

> 狀態：0.5.22 程式碼｜平台：Android、iOS（差異見「平台差異」）｜2026-10-01 核對

## 一句話

登入會員每天可以寫一篇私人的靈修日記。日記只存在自己的手機，不會上傳到教會伺服器；可以整份匯出，Android 另外可以存到自己選的資料夾。

## 從哪裡進

底部分頁「日記」（`app/(tabs)/journal.tsx`）。從讀經頁切過去，編輯器帶出目前閱讀的日期；從其他頁切過去，帶出台北時間今天（`app/(tabs)/_layout.tsx` 的 `setJournalEntryDate`）。日記日期不會改變讀經日期或正在朗讀的章節。

讀經器複製經文後，日記顯示「插入剛複製的經文：…」；點一下才會插入，不會自動貼上。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 隱私與保存提醒 | 「日記只存在這支手機，不會上傳。換手機或重裝前，請先「匯出全部」。」兩平台都顯示 |
| 寫日記 | 多行文字框，最多 4000 字，兩秒沒動作自動存到手機 |
| 儲存狀態 | 「尚未儲存/已儲存 HH:MM」和「儲存」按鈕；沒有上傳狀態 |
| 換日期 | 標題兩側 ‹/›；不能切到未來 |
| 插入經文 | 點提示條，把剛複製的經文接到草稿最後一行 |
| 歷史記錄 | 列出這個帳號在這支手機寫過的日子，點一天回去編輯 |
| 匯出全部 | 整理成一份 Markdown，交給系統分享 |
| 同時存到我選的資料夾 | 僅 Android；每次保存多寫一份 `.md` 到自選資料夾 |
| 朗讀控制 | 右上角播放鈕控制讀經頁的同一個播放器 |

## 行為規格

### 撰寫、儲存與離線

- `useJournalEntry` 在停止輸入 2 秒後存到本機；按儲存、失去焦點、換日期或離開 hook 時立即保存還沒存的內容。切換日期/帳號時，舊資料不會顯示在新日期下。
- 本機 SQLite 以會員＋日期為主鍵；同一天再寫會更新原筆資料。每次保存只有本機寫入，沒有上傳佇列或網路傳輸。
- `JournalSaveBar` 顯示尚未儲存或已儲存的台北時間；已儲存時按鈕停用。沒有內容時不顯示儲存列。
- 輸入框以 `maxLength={4000}` 限制長度。未登入時不可編輯，顯示「登入後才能查看和保存自己的日記。」；已登入但離線仍可寫、存、匯出。
- 歷史記錄只列目前會員在這支手機的非空白日記，最新日期在上。往後的箭頭在今天停用。
- 從 0.5.21 升級時，保留所有日記文字、帳號、日期與儲存時間；移除舊 `qingmu_journal_outbox`，把歷史上傳狀態改成本機已保存。日記資料本身不刪除。

### 插入經文與朗讀

- 提示條必須點一下才把經文接在草稿最後一行；不點就不修改日記。
- `ReaderAudioBridgeButton` 控制讀經器既有播放器，不在日記頁另開播放；沒有可控制的朗讀時停用。

### 同時存到我選的資料夾（僅 Android）

- 只有 Android 提供資料夾選擇器（Storage Access Framework），iOS 改用匯出全部存到「檔案」。
- 選好資料夾會先把目前帳號已有的日記補寫進去，之後每次存檔多寫一份 `YYYY-MM-DD.md`，檔頭有 `source: qingmu-journal`。
- 同名檔若不是 App 寫的會跳過，不覆蓋使用者自己的筆記，畫面回報跳過數量。授權被收回或寫入失敗不影響日記本體，因為本機已先保存。
- 資料夾授權依會員分開保存，畫面顯示可讀路徑。更換資料夾重新補寫；停止同步只忘記授權，已寫出去的檔案保留。

### 匯出全部

- 依日期排序，以「## YYYY年M月D日」分段，跳過空白日；完全沒內容時為「（還沒有內容）」（`journalExport.ts`）。
- 有日記時顯示「匯出全部」。匯出前先保存編輯器，分享檔名固定為 `qingmu-journal.md`。
- 依序嘗試檔案分享、純文字分享、複製到剪貼簿；分別顯示「已匯出 N 天」「已複製 N 天到剪貼簿」或「匯出失敗，請再試一次」（`journalShare.ts`）。

### 隱私與舊版相容

- 新版日記畫面、hook、store 都不呼叫網路，不下載遠端日記，也沒有上傳/衝突處理。教會管理者看不到手機上的內容。
- 舊版 0.5.21 仍會呼叫 `GET /api/me/journal?from=&to=`。後端保留 GET 清單/單日回應，空清單與空日記都回 200；有歷史資料時只讀呼叫者自己的資料，管理員也不能讀別人。
- 後端 `PUT /api/me/journal/:date` 回 405、`JOURNAL_LOCAL_ONLY`，不解析或寫入日記內容。伺服器的寫入實作已移除，既有表/資料保留以免破壞相容。
- 系統備份使用使用者自己的帳號，不經過教會伺服器：Android Google 備份可能在重裝時還原；iPhone 的 Documents/SQLite 隨 iCloud/電腦備份，通常要整支手機還原才回來。換手機/重裝前仍建議先匯出。
- 日記不上傳的行為與 Play 隱私政策/資料安全表一致；上架填寫 App Store 隱私標籤時，留在手機的日記不算由 App 收集。

## 決定（為什麼這樣做）

刻意不做：

- **日記不上傳到教會伺服器**：這是年輕人寫給自己的私人內容。換手機或重裝不會從伺服器取回，要保存就用匯出全部或 Android 自選資料夾。（維護者 2026-09-30 確認，原本開發時也是此決定）
- **保留使用者自己的 Google/iCloud 系統備份，不排除日記**：系統備份在本人帳號，教會看不到，與不傳教會伺服器是兩個邊界。（維護者 2026-09-30 同意）
- **移除舊上傳路徑與上傳提示，加入隱私/匯出提醒**：避免已保存在本機的日記被誤認為尚未保存；守衛測試擋住再次接上網路傳輸。（維護者 2026-09-30 同意）
- **舊文件寫反的地方以本節為準**：2026-09-19 commit 曾寫「伺服器是日記唯一的本體」，隱私政策曾寫日記存在伺服器，已在 2026-09-30 改正。
- **iPhone 不提供長期自選資料夾同步**：iOS 沒有 Android 對應授權，使用匯出全部 → 檔案。（`AGENTS.md` 第 6 點）

## 平台差異

| 項目 | Android | iOS |
|---|---|---|
| 自選資料夾 | 有 | 改用匯出全部 → 檔案 |
| 系統備份 | Google，重裝可能還原 | iCloud/電腦，整支手機還原時回來 |
| 鍵盤避讓 | 依鍵盤是否彈出啟用 | 一律啟用 |
| 隱私提醒、儲存、匯出、經文、朗讀 | 相同 | 相同 |

## 資料與後端

- 本機日記：`src/storage/journalStore.ts` 的 `qingmu_journal_entries`；與完成記錄共用一個 SQLite 連線（`mobileDatabase.ts`）。
- 本機保存：`src/ui/useJournalEntry.ts`；主畫面 `app/(tabs)/journal.tsx`。`JournalPanel.tsx` 是未被現行畫面引用的舊面板，仍共用同一個本機 hook。
- 額外資料夾副本：`journalFolderMirror.ts`、`journalMirror.ts`、`journalFolderSync.ts`、`folderPath.ts`。
- 匯出：`journalExport.ts`、`journalShare.ts`、`systemShare.ts`。
- 後端僅留 `server/journal.ts` 的舊版讀取與 schema；`routes.ts` 拒絕 PUT，沒有日記儲存函式。
- `server/claudeCli.ts` 只服務提名獎品的估價/潤飾，與日記無關。

## 守住它的測試

| 測試 | 內容 |
|---|---|
| `tests/tools/journalPrivacy.test.ts` | 禁止日記傳輸/上傳實作，失敗訊息指向本文件「決定」；隱私提示與無上傳狀態 |
| `tests/storage/journalStore.test.ts` | 本機保存、帳號隔離、0.5.21 升級保住文字並移除佇列 |
| `tests/server/journal.test.ts` | 舊版 GET 相容、PUT 拒絕且不保存內容、既有資料不被刪除 |
| `tests/ui/journalEntryHook.test.ts` | 自動/手動保存、換日期/離開前保存、資料夾失敗仍保住內容 |
| `tests/ui/journalSaveBar.test.ts` | 儲存列狀態與台北時間 |
| `tests/domain/journalExport.test.ts` | 匯出排序與空白日 |
| `tests/domain/journalMirror.test.ts` | 資料夾副本不覆蓋外來檔案 |
| `tests/ui/journalFolderSync.test.ts` | 自選資料夾只在 Android 提供 |
| `tests/ui/journalQuoteOffer.test.ts` | 經文提示需點一下才插入 |
| `tests/ui/journalKeyboardAvoidance.test.ts` | 鍵盤避讓 |
| `.maestro/ios/41-journal.yaml` | iOS 日記操作與匯出入口 |

## 相關文件

- [AGENTS.md](../../AGENTS.md)：兩平台規則與 iOS 資料夾限制。
- [narration.md](narration.md)：日記頁控制的同一個朗讀播放器。
- [privacy-policy.md](../play/privacy-policy.md)：對外隱私政策。

## 已知限制與待辦

- 換手機或重裝不保證會還原，請先匯出；系統備份由使用者控制。
- 日記未另設密碼或加密，使用手機與系統本身的保護。
- `JournalPanel.tsx` 目前只由自己的測試引用，現行介面是日記分頁。
