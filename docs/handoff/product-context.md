# Product context

## Owner與工作方式

產品owner是光佑，使用繁體中文。偏好自主完成、先查事實再問、只跑少量有意義的focused tests，並以實機證據確認手機行為。模型/worker採「足夠且便宜」原則；rights、ledger、migration由root嚴格review。使用Markdown檔交付長內容，不在chat貼巨型spec。

## 產品焦點

青牧讀經App聚焦「讀經+積分」。主導航只有讀經/積分；不做RPG、LINE、call、groups或admin website。Google登入首次建立member，不需要invite/group；session需durable，不採1小時timeout。身份以Google subject與backend admin allowlist為準，不信任email或frontend `isAdmin`。

## Reader

五版本：46和合本神版繁（預設）、40新譯本繁、111 NIV、406 ERV、114 NKJV。翻譯與字級按人保存。工具列固定48dp audio slot、2–3字今日章節縮寫與`...`；正常audio loading只顯示icon。

連續播放預設ON並記住設定：按播放後依序走完今日剩餘章節，自動換頁/音訊，最後停止；遇到沒有音訊的章節必須停下提示，不能略過。OFF停止後續自動前進，不中斷目前播放；播放中重新ON只重新arm下一個EOF，不seek/restart；idle ON不自動播放。

Bible cache按exact SDK request key保存30分鐘；首頁可見後只preload目前版本/今日內容，concurrency2、dedup，舊response不能改UI。Native content store必須走相同fetch adapter；不批量offline audio。

## Points、charts與social

台北calendar date每日完成1點/人，active entitlement唯一；只允許今日與前6個日曆日補登。undo/recomplete不重複；revision+operationId transaction，timeout沿用ID；已花掉的credit不可undo（`POINTS_ALREADY_SPENT`）。Total/月是active earned entitlement總和；wallet是immutable ledger總和；兌換只扣wallet，不降低earned，未用餘額永久carry。

圖表採Garmin慣例週/月/年/全部，daily/weekly/monthly bucket；切tab回目前period，左右箭頭看歷史，axes與單行labels可見。一般profile只顯示total+梯隊，不顯示exact rank。梯隊按active production members計算，N<10或score0為null；同分同梯隊。Admin rank用competition ranking 1,1,3；zero/inactive unranked。

自己/admin可見private wallet、target、history；好友只見name/total/tier/chart，backend必須省略private。好友QR是`qingmu://friend/add?token=opaque`，5分鐘、hash/random；掃碼立即建立canonical雙向friendship，拒絕self/expired，移除時撤銷自己的active QR，舊claim receipt不可復活關係。

Admin scope必須Google allowlist+真實biometric，logout/background/離開scope清除unlock。Catalog可編輯/archive；現場兌換是找學生→選reward→確認交付→atomic wallet debit+receipt；每operation一個獎品，可重複兌換；reverse需reason且exactly once。保留audit，不刪QA交易。

獎品由admin預先設定，使用者從dropdown選擇。介面以`72/120 分`這類正面分數呈現，不寫「還差幾分」、不加鼓勵口號，並保持compact。管理功能留在原生App，不另開admin網站。資料結構與完整端點規則以[Detailed Implementation Design Spec v1.0](../design/reading-gamification-v1.md)為準，這裡不重複schema。

## Reminder與已取消方向

保留既有讀經reminder；移除group/RPG/call/meeting通知，deeplink回home。不要自動把舊關係轉friend。舊「每日兩次密碼錯誤永久ban」方案已取消，改為Google-bound admin+native biometric。
