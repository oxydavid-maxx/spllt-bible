# Acceptance status

## 已驗證

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
- 讀經reminder修復存在，但沒有一份可支撐「完整通知交付全通過」的root receipt。

## 尚未完成

- 兩個獨立真實Google帳號的friend QR、visibility與removal未在手機完整驗收。不可用fake identity或test bypass代替。
- 全產品並未全部qualification；publish前需把同一candidate與full-scope結果重新綁定。
- Main未merge，latest APK未public release。

下一session應從本handoff、versioned spec與已保存proof開始，只針對剩餘acceptance做reconciliation；不要重新開始Bible/audio POC研究，也不要重跑已綁定的整套證據。
