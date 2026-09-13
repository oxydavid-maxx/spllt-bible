# 共同開發

請在 Issue 說明預期行為、實際行為、App 版本、Android 版本與重現步驟。截圖請遮去帳號、群組與其他個資；不要貼登入 token、邀請碼或 service-account 檔案。

## Pull request

1. Fork repository，從預設分支建立自己的工作分支。
2. 一個 PR 處理一個可描述的問題；說明行為變更與驗證方式。
3. 執行 `npm run typecheck` 與受影響的 Vitest 測試。
4. 涉及播放、通知、權限、Google 登入或原生畫面時，補上裝置驗證與仍未驗證的部分。

請使用自己的本機測試資料、Google/Firebase project 與 YouVersion App Key。測試用字串不得被拿去建立正式身份或呼叫正式服務。

## 原生建置與歷史工具

- `android/` 和 `ios/` 由 Expo prebuild 生成，不存放正式簽章資料。
- `scripts/*.ps1` 是 Windows 開發工具，部分路徑可由環境變數配置；主要開始方式仍為 README 的 Expo 指令。
- 部分舊 candidate/spec 檢查反映早期 fixture 階段，不是 release readiness 判定。
- `tests/ui/fullscreenReaderPadding.test.ts` 需要 Chrome；請依檔案中的可配置路徑設定瀏覽器。
- `tests/candidate.test.ts` 依賴生成的 Android 設定與早期 fixture/秘密掃描規則，不適合作為目前乾淨 clone 的通用通過條件；重整此檢查也是可協作項目。
- 不把沒有執行的檢查標為通過，也不為了讓檢查變綠而刪除驗收條件。

## 內容與資料

保留譯本、出版者及錄音的正確對應與版權說明。缺少某個章節/錄音時回報真實狀態，不猜測媒體網址、不跨譯本冒用音訊。

請勿加入私人交付紀錄、正式資料庫、使用者螢幕錄影、私密金鑰或未獲准公開的附件。涉及額外服務、公開範圍或授權的變更，請先在 Issue 討論。
