# Acceptance status

## 已驗證

- 0.2.12/code14（8c29b89）真機：冷啟開讀經器，朗讀鈕直接為「播放」（0.2.9–0.2.11 曾因伺服器 6 h 快取超過 5 min validUntil 而每次顯示「重試」，logcat `rejected:EXPIRED`；修法＝快取壽命綁 validUntil，並把 5 min 再確認週期改為 24 h、預熱每小時——錄音網址是內容雜湊且 CDN 自報可快取 5 天，5 min 是我方發明的假期限）；註腳面板（詩96:9）點灰底／「關閉」／返回鍵三種方式皆關閉且讀經器保留；積分頁上方合併為單一 compact 區塊。後端已同步快取修正。
- 0.2.8/code10（9e6768b）真機：朗讀中第 2→4 節灰底跟著換、頁面不捲動；積分頁目標獎品環形 5/75、獎品架、週/月/年切換 <0.6 s；提醒滾輪設 06:30 即存（伺服器 reading_time=06:30、系統鬧鐘 06:30）。後端已同步 verseTiming 與提醒預設。
- 0.2.7/code9（c239a3e）真機：讀經日曆月/年/週三檢視、七欄不折行、預設選今天；首頁無同步字樣、撤銷為小字連結並先確認；工具列滑動開關開/關兩態且切換不啟動播放；管理分頁「全體（管理）」。
- 0.2.6/code8（88b589d）真機：連讀開/關兩態、48dp、切換不觸發播放、「連讀是什麼？」說明；切日與重開後完成狀態正確；提醒開啟正確排程、關閉清除並與伺服器同步。

- 五版本在真機顯示正確的1TI.2/PSA.93；ERV明確無audio。
- 連續播放自然鏈1TI.2→1TI.3→PSA.93並在最後停止；OFF→ON rearm通過。
- 字級、翻譯、連續播放設定持久化。
- 積分完成3→4、restart仍4、undo回3。2026-09-15真機結果是9/9允許、9/8阻擋、9/16未來日期阻擋；「9/14時最早可補9/8」只是規則範例，不是該次真機日期。
- 月/年/全部顯示3；週顯示2（保留合法舊9/17 credit）。
- Backend verified-cache stale-serve/single refresh、404/410 invalidation、cap8 dedup與audio transient retry邊界已有proof。
- Admin真實fingerprint、catalog create、redeem、reverse exact once在0.2.3完成。QA reward已inactive，該redemption已REVERSED；保留audit，不再重跑交易。Exact audit identifiers只保存在local handoff evidence。
- 0.2.5在真機rapid text→numeric→BACK回原Create bounds，reopen/hide與REVERSED history多次UI dump穩定。

## 有限證據

- 一次preload約1.215秒（settings→first paragraph），不是tap-to-content絕對benchmark，也不代表所有冷啟動；首次uncached仍受upstream影響。
- 讀經reminder：0.2.6已驗排程/取消/同步；實際通知交付與點入沿用2026-09-15證據（reminder程式碼自5cea282後未變）。

## 尚未完成

- 兩個獨立真實Google帳號的friend QR、visibility與removal未在手機完整驗收。不可用fake identity或test bypass代替。
- 9/14、9/17兩筆舊完成紀錄已判定為QA遺留，待產品owner在App內按「撤銷」清除（正式撤銷交易，保留稽核）。
- Main已merge至88b589d；public release見repo Releases。

下一session應從本handoff、versioned spec與已保存proof開始，只針對剩餘acceptance做reconciliation；不要重新開始Bible/audio POC研究，也不要重跑已綁定的整套證據。
