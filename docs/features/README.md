# 竹科聖經功能清單

> 使用者看得到的每個功能都在這裡有一列，詳細行為看「規格」欄的檔案。
> 依據：0.5.22 程式碼，2026-10-01 核對；正式成品與發布驗收另外綁定。
> **新增或改變功能的 PR，同一個 PR 更新這份清單和對應的規格**（規則在 [`AGENTS.md`](../../AGENTS.md)，守衛測試 `tests/tools/featureDocs.test.ts`）。

## 規格檔

| 檔案 | 範圍 |
|---|---|
| [announcements.md](announcements.md) | 公告分頁：青少｜主堂、下次聚會、服事、報名狀況、講道紀錄、常設資訊、主堂週刊 |
| [reader.md](reader.md) | 讀經頁：版面與沉浸模式、靈修分頁與接續靈修、譯本、字體、經節複製、預先載入、閱讀位置、載入失敗與重試 |
| [narration.md](narration.md) | 朗讀：播放、速度、接續讀經、背景播放、朗讀跟著走 (靈修朗讀見 reader.md) |
| [reading-plan.md](reading-plan.md) | 讀經計畫與每日完成：開啟日期、日期列、整份計畫清單、當日章節、完成打卡、靈修打勾、補登、撤銷、積分月曆 |
| [points.md](points.md) | 積分與社群：團體 (青少一起讀經、團體獎)、個人 (月曆、積分圖、目標獎品)、好友、全體 (管理)、兌換 |
| [journal.md](journal.md) | 靈修日記：寫、存、匯出、存到自選資料夾 (2026-10-14 起分頁列不顯示) |
| [reminders.md](reminders.md) | 讀經提醒與推播 |
| [account.md](account.md) | Google/Apple 登入 (含開機分流與登入中斷提示)、帳戶頁、青少/主堂、永久刪除帳號、登出、App 更新提示 |

## 公告

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 下次聚會 | 左邊深色日期塊 (月、日、星期)，右邊主題或兩堂各自的內容；下面服事名單、報名按鈕 | 分頁列「公告」 | Android、iOS | [announcements.md](announcements.md) |
| 報名狀況 | 已有幾人報名、有哪些朋友報名 | 公告的下次聚會卡片 | Android、iOS | [announcements.md](announcements.md) |
| 講道紀錄 | 一個主日一張卡，最新的一週標「上週」；每堂列名稱、講員和資料連結，同類兩份檔案編成 1、2；沒有內容的堂次收成一行 | 分頁列「公告」 | Android、iOS | [announcements.md](announcements.md) |
| 離線提示 | 抓不到最新公告時，小字註明目前顯示哪一週 | 公告分頁底部 | Android、iOS | [announcements.md](announcements.md) |
| 青少｜主堂 | 公告最上面兩個分頁，預設打開自己那一邊 | 分頁列「公告」 | Android、iOS | [announcements.md](announcements.md) |
| 主堂週刊 | 教會在 LINE 公布欄貼的週刊原圖，最新在上、留 8 週，點了全螢幕放大 | 公告「主堂」 | Android、iOS | [announcements.md](announcements.md) |

## 讀經

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 開啟日期 | 打開 App 自動落在今天；跨午夜回來會跟上今天，保留手選歷史日與朗讀；計畫還沒開始或已結束時落在最近的一天 | 分頁列「讀經」 | Android、iOS | [reading-plan.md](reading-plan.md) |
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
| 靈修分頁 | 章節籤最後一個「靈修」：傳道當天的靈修文、段首小灰字出處和詩歌 | 讀經頁章節籤 | Android、iOS | [reader.md](reader.md) |
| 接續靈修 | 預設關，選單或有期限的最後章底提示可開啟；經文念完接著念靈修，再播詩歌 | 更多閱讀工具、最後一章底 | Android、iOS | [reader.md](reader.md) |
| 靈修打勾 | 按葉子圈完成靈修，浮出不含分數的完成小字；滑到底展開大按鈕，月曆標「靈修」，不加積分或團體統計 | 讀經/靈修頁葉子圈、積分「自己」最上面的當天卡 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 補登和撤銷 | 今天和前 6 天可以補打卡；撤銷要先確認並收回積分 | 讀經頁、積分月曆 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 離線打卡與跨手機 | 沒網路先記住、連上後送出；回到前景/讀經頁時讀回另一支手機的完成與撤銷 | 讀經頁、積分頁 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 整份讀經計畫清單 | 分月顯示 9/1–12/31，今天標底色、讀完打勾，點一天就去讀；上緣可下拉關閉 | 讀經頁點日期、積分月曆的「整份計畫」 | Android、iOS | [reading-plan.md](reading-plan.md) |

## 朗讀

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 播放朗讀 | 播放這一章的朗讀，沒有朗讀或暫時失敗時會說明，能重試的有「重試」 | 讀經頁右下角播放鍵 | Android、iOS | [narration.md](narration.md) |
| 朗讀速度 | 0.75、1、1.25、1.5 倍，立即套用 | 更多閱讀工具 | Android、iOS | [narration.md](narration.md) |
| 接續讀經 | 念完一章自動接當天下一段，最後一段念完就停 | 更多閱讀工具 (⋯) | Android、iOS | [narration.md](narration.md) |
| 背景與鎖定畫面播放 | 離開讀經頁、關螢幕都繼續念，鎖定畫面可以控制 | 播放後自動 | Android、iOS | [narration.md](narration.md) |
| 朗讀跟著走 | 畫面跟著念到的經節走並反白；手指滑開就停，按「回到朗讀處」再跟上 | 朗讀時的讀經頁 | Android、iOS | [narration.md](narration.md) |
| 日記頁的朗讀控制 | 在日記頁控制同一段朗讀 (日記分頁 2026-10-14 起不在分頁列) | 日記頁播放鍵 | Android、iOS | [narration.md](narration.md) |
| 靈修朗讀 | Azure 男聲/女聲逐段朗讀、共用速度；單段失敗退回手機語音，念到的段落反白 | 靈修分頁 ▶ | Android、iOS | [reader.md](reader.md) |

## 積分

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 青少一起讀經 | 每天讀經人數的月曆 (2 人以上才顯示)，今天、昨天各幾人；主堂看「全教會一起讀經」 | 積分「自己」最上方「團體」 | Android、iOS | [points.md](points.md) |
| 團體獎 | 一個月 15 天讀經的人數夠了就累積一個月：懶骨頭 15 人 × 2 個月、沙發 20 人 × 4 個月；只有青少有 | 積分「團體」 | Android、iOS | [points.md](points.md) |
| 完成今日靈修/讀經 | 當天卡兩顆鈕，跟著月曆選的那天：左靈修葉子、右讀經書，未完成白底綠框，完成後填滿深綠白圖示 | 積分「自己」最上面的當天卡 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 積分月曆 | 點任一天看經文與狀態，未來/過期也能看；期限內可以補打卡；讀了靈修的日子標金色「靈修」 | 積分「自己」的「個人」 | Android、iOS | [reading-plan.md](reading-plan.md) |
| 匯出讀經卡 | 本月或本季匯出 A4 PDF，含讀經勾選、靈修標記與未完成天數，離線可分享/列印 | 積分「自己」的個人讀經月曆卡下排左邊「匯出讀經卡 ›」 | Android、iOS | [points.md](points.md) |
| 範圍切換 | 自己、好友兩個分頁；管理者從帳戶頁進來才多一個「全體 (管理)」 | 積分頁頂部 | Android、iOS | [points.md](points.md) |
| 自己的積分 | 總積分、梯隊、目標獎品進度、「總積分/每月」圖 (金色虛線是靈修) | 積分「自己」的「個人」 | Android、iOS | [points.md](points.md) |
| 目標獎品 | 從自己那一邊 (青少或主堂) 的獎品選一個，看還差幾分 | 積分「自己」 | Android、iOS | [points.md](points.md) |
| 好友 | 加好友後互相看積分（看不到對方的餘額和目標） | 積分「好友」 | Android、iOS | [points.md](points.md) |
| 好友 QR | 出示或掃描 QR 馬上互加好友 | 積分頁選單 | Android、iOS | [points.md](points.md) |
| 好友通知 | 有人加你好友時收到通知 | 系統通知 | Android、iOS | [points.md](points.md) |
| 全體排名 (管理) | 管理者從帳戶頁最下面進來，解鎖後看全體積分 | 帳戶頁「全體 (管理) ›」 | Android、iOS | [points.md](points.md) |
| 獎品與兌換 | 獎品清單和兌換紀錄在 Google 試算表；紙本兌換後同工寫一列，可兌換積分跟著扣 | 試算表；App 的積分「自己」和「我的領取紀錄」 | Android、iOS | [points.md](points.md) |

## 日記

| 功能 | 一句話 | 從哪裡進 | 平台 | 規格 |
|---|---|---|---|---|
| 靈修日記 | 每天一篇，**只存在自己的手機，不上傳伺服器**（隱私決定）；在讀經頁複製的經文可以一鍵插入 | 目前沒有入口 (2026-10-14 起分頁列不顯示；手機裡的日記都保留) | Android、iOS | [journal.md](journal.md) |
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
| Google 登入 | 用 Google 帳號登入，第一次登入自動建立帳號；測試機旗標、IP 或驗過的 token email 網域命中的新會員直接停用 | 開 App 時的登入畫面 | Android、iOS (iOS 需私有 OAuth 設定，TestFlight 真機另驗) | [account.md](account.md) |
| Apple 登入 | iPhone 原生授權，首次登入建立帳號；Android 不顯示 | 登入畫面 | iOS | [account.md](account.md) |
| 後台規則與文件 | 管理者解鎖後看所有後台規則和文件連結，失敗可重試 (試算表、讀經表等) | 帳戶頁「後台規則與文件」 | Android、iOS | [account.md](account.md) |
| 刪除帳號 | 二次確認後刪除伺服器個資並登出，無需寄信 | 帳戶頁「刪除帳號與資料」 | Android、iOS | [account.md](account.md) |
| 啟用碼 | 認不出 Google 帳號時，用一次性啟用碼綁定 | 登入畫面（需要時才出現） | Android、iOS | [account.md](account.md) |
| 帳戶頁 | 回前景更新名字、歸屬和提醒；進頁重驗管理資格；看自己的名字和小組、設定提醒、登出、刪除帳號與資料、看 App 版本 | 右上角頭像 | Android、iOS | [account.md](account.md) |
| 青少/主堂 | 新會員第一次登入選青少或主堂，之後可以在帳戶頁改 | 登入後第一個畫面、帳戶頁「我在哪裡聚會」 | Android、iOS | [account.md](account.md) |
| App 更新提示 | 有新版時提示更新：Play 裝的在 App 裡更新，側載的開安裝頁 | 開 App 或回到前景時自動出現 | 只有 Android | [account.md](account.md) |
| JS/圖片背景更新 | 同一商店版本背景下載，下次冷啟動套用；管理者可先收 preview | 自動；帳戶頁最下面的管理區 | Android, iOS | [account.md](account.md) |

## 其他文件放哪

| 內容 | 位置 |
|---|---|
| 現在的行為（這裡） | `docs/features/` |
| 技術規則、兩個平台怎麼改 | [`AGENTS.md`](../../AGENTS.md) |
| 設計討論與決定 | `docs/design/` |
| 實作計畫與驗證紀錄 | `docs/superpowers/plans/` |
