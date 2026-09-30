# 竹科聖經功能清單

> 使用者看得到的每個功能都在這裡有一列，詳細行為看「規格」欄的檔案。
> 依據：0.5.21＋0.5.22 候選的程式碼，2026-09-30 核對；版本號在發布時才更新。
> **新增或改變功能的 PR，同一個 PR 更新這份清單和對應的規格**（規則在 [`AGENTS.md`](../../AGENTS.md)，守衛測試 `tests/tools/featureDocs.test.ts`）。

## 規格檔

| 檔案 | 範圍 |
|---|---|
| [announcements.md](announcements.md) | 公告分頁：下次聚會、服事、報名狀況、上次講道、以前的主日、常設資訊 |
| [reader.md](reader.md) | 讀經頁：版面與沉浸模式、譯本、字體、經節複製、預先載入、閱讀位置、載入失敗與重試 |
| [narration.md](narration.md) | 朗讀：播放、速度、連讀、背景播放、朗讀跟著走 |
| [reading-plan.md](reading-plan.md) | 讀經計畫與每日完成：開啟日期、日期列、整份計畫清單、當日章節、完成打卡、補登、撤銷、積分月曆 |
| [points.md](points.md) | 積分與社群：自己、好友、全體（管理）、目標獎品、兌換、提名投票、一起走過 |
| [journal.md](journal.md) | 靈修日記：寫、存、匯出、存到自選資料夾 |
| [reminders.md](reminders.md) | 讀經提醒與推播 |
| [account.md](account.md) | 登入、帳戶頁、登出、App 更新提示 |

## 公告

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 下次聚會 | 下次主日的日期、主題或兩堂各自的內容、服事名單、報名按鈕 | 分頁列「公告」 | Android、iOS | [announcements.md](announcements.md) |
| 報名狀況 | 已有幾人報名、有哪些朋友報名 | 公告的下次聚會卡片 | Android、iOS | [announcements.md](announcements.md) |
| 上次講道與以前的主日 | 日期/講員/標題在上、連結按鈕在下；不是今年的日期顯示年份 | 分頁列「公告」 | Android、iOS | [announcements.md](announcements.md) |
| 離線提示 | 抓不到最新公告時，小字註明目前顯示哪一週 | 公告分頁底部 | Android、iOS | [announcements.md](announcements.md) |

## 讀經

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 開啟日期 | 打開 App 自動落在今天；計畫還沒開始或已結束時落在最近的一天 | 分頁列「讀經」 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 日期列 ‹ › | 換到前一個或下一個排定讀經日，沒有就變灰 | 讀經頁頂部 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 當日章節 | 一排標籤對應當天每段經文，點哪段讀哪段 | 讀經頁日期列下方 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 自由閱讀 | 換到計畫以外的書卷和章 | 讀經頁「選擇其他章節」 | Android、iOS | [reader.md](reader.md) |
| 譯本選擇 | 5 個譯本，中文和英文分組，每個帳號各記一份 | 更多閱讀工具 → 選擇譯本 | Android、iOS | [reader.md](reader.md) |
| 字體設定 | 字級、字型、行距 | 更多閱讀工具 → 調整字體 | Android、iOS | [reader.md](reader.md) |
| 經節複製 | 選經文後複製到剪貼簿 | 在經文上選取 | Android、iOS | [reader.md](reader.md) |
| 沉浸模式 | 往下捲收起工具列，專心讀經；往上捲一段、捲到章首或章尾、按返回鍵、點收合的細條會叫回來 | 讀經頁捲動經文 | Android、iOS | [reader.md](reader.md) |
| 預先載入 | 背景先抓今天的經文，換章不用等 | 自動 | Android、iOS | [reader.md](reader.md) |
| 閱讀位置記憶 | 記住每個帳號每一天讀到哪裡，回來接著讀 | 自動 | Android、iOS | [reader.md](reader.md) |
| 載入失敗與重試 | 失敗時顯示說明和「重試」，回到前景自動再試 | 讀經頁載入經文時 | Android、iOS | [reader.md](reader.md) |
| 在 YouVersion 開啟、版本資訊 | 用 YouVersion 開同一章；看譯本的出版和版權資訊 | 更多閱讀工具 | Android、iOS | [reader.md](reader.md) |
| 完成打卡 | 讀完按圓圈打卡；讀到最後一段時圓圈展開成按鈕 | 讀經頁右下角 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 補登和撤銷 | 今天和前 6 天可以補打卡；撤銷要先確認並收回積分 | 讀經頁、積分月曆 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 離線打卡與跨手機 | 沒網路先記住、連上後送出；另一支手機完成的日子也顯示已完成 | 讀經頁、積分頁 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 整份讀經計畫清單 | 分月顯示 9/1–12/31，今天標底色、讀完打勾，點一天就去讀 | 讀經頁點日期、積分月曆的「整份計畫」 | Android、iOS | [reading-plan.md](reading-plan.md) |

## 朗讀

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 播放朗讀 | 播放這一章的朗讀，沒有朗讀或暫時失敗時會說明，能重試的有「重試」 | 讀經頁右下角播放鍵 | Android、iOS | [narration.md](narration.md) |
| 朗讀速度 | 0.75、1、1.25、1.5 倍，立即套用 | 更多閱讀工具 | Android、iOS | [narration.md](narration.md) |
| 連讀 | 念完一章自動接當天下一段，最後一段念完就停 | 更多閱讀工具 | Android、iOS | [narration.md](narration.md) |
| 背景與鎖定畫面播放 | 離開讀經頁、關螢幕都繼續念，鎖定畫面可以控制 | 播放後自動 | Android、iOS | [narration.md](narration.md) |
| 朗讀跟著走 | 畫面跟著念到的經節走並反白；手指滑開就停，按「回到朗讀處」再跟上 | 朗讀時的讀經頁 | Android、iOS | [narration.md](narration.md) |
| 日記頁的朗讀控制 | 在日記頁控制同一段朗讀 | 日記頁播放鍵 | Android、iOS | [narration.md](narration.md) |

## 積分

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 積分月曆 | 點任一天看經文與狀態，未來/過期也能看；期限內可以補打卡 | 積分「自己」最上方 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 範圍切換 | 自己、好友、全體（管理）三個分頁 | 積分頁頂部 | Android、iOS | [points.md](points.md) |
| 自己的積分 | 總積分、梯隊、目標獎品進度、累積走勢或讀經日曆 | 積分「自己」 | Android、iOS | [points.md](points.md) |
| 目標獎品 | 選一個想換的獎品，看還差幾分 | 積分「自己」 | Android、iOS | [points.md](points.md) |
| 好友 | 加好友後互相看積分（看不到對方的餘額和目標） | 積分「好友」 | Android、iOS | [points.md](points.md) |
| 好友 QR | 出示或掃描 QR 馬上互加好友 | 積分頁選單 | Android、iOS | [points.md](points.md) |
| 好友通知 | 有人加你好友時收到通知 | 系統通知 | Android、iOS | [points.md](points.md) |
| 提名獎品投票 | 開放期間提獎品構想、最多投 3 票，管理者核准後變成獎品 | 積分頁提名提示條、選單 | Android、iOS | [points.md](points.md) |
| AI 估價與說明建議 | 自動把提名換算成大約分數，說明不清楚時給改寫建議 | 提名板 | Android、iOS | [points.md](points.md) |
| 一起走過 | 6 人以上才顯示的團契共讀進度，沒有排名 | 積分「自己」下方 | Android、iOS | [points.md](points.md) |
| 全體排名（管理） | 管理者解鎖後看全體積分 | 積分「全體（管理）」 | Android、iOS | [points.md](points.md) |
| 現場兌換（管理） | 管理者當面幫學生兌換獎品、查看或撤銷紀錄 | 積分頁選單（管理） | Android、iOS | [points.md](points.md) |

## 日記

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 靈修日記 | 每天一篇，**只存在自己的手機，不上傳伺服器**（隱私決定）；在讀經頁複製的經文可以一鍵插入 | 分頁列「日記」 | Android、iOS | [journal.md](journal.md) |
| 歷史記錄 | 列出寫過的日子，點一天回去編輯 | 日記頁 | Android、iOS | [journal.md](journal.md) |
| 匯出全部 | 把全部日記整理成一份 Markdown，用系統分享存起來或傳出去 | 日記頁「匯出全部」 | Android、iOS | [journal.md](journal.md) |
| 同時存到我選的資料夾 | 每次存檔另外寫一份 Markdown 到自選資料夾 | 日記頁 | 只有 Android | [journal.md](journal.md) |

## 提醒

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 讀經提醒 | 每天在選的時間提醒還沒完成的讀經，點通知直接開到那天 | 帳戶頁「提醒」 | Android、iOS | [reminders.md](reminders.md) |
| 聚會提醒 | 程式還在，但目前正式版關閉 | 不顯示 | 關閉中 | [reminders.md](reminders.md) |

## 帳號與更新

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| Google 登入 | 用 Google 帳號登入，第一次登入自動建立帳號 | 開 App 時的登入畫面 | Android（iOS 待第二階段） | [account.md](account.md) |
| 啟用碼 | 認不出 Google 帳號時，用一次性啟用碼綁定 | 登入畫面（需要時才出現） | Android、iOS | [account.md](account.md) |
| 帳戶頁 | 看自己的名字和小組、設定提醒、登出、申請刪除資料 | 右上角頭像 | Android、iOS | [account.md](account.md) |
| App 更新提示 | 有新版時提示下載安裝檔 | 開 App 或回到前景時自動出現 | 只有 Android | [account.md](account.md) |

## 其他文件放哪

| 內容 | 位置 |
|---|---|
| 現在的行為（這裡） | `docs/features/` |
| 技術規則、兩個平台怎麼改 | [`AGENTS.md`](../../AGENTS.md) |
| 設計討論與決定 | `docs/design/` |
| 實作計畫與驗證紀錄 | `docs/superpowers/plans/` |
