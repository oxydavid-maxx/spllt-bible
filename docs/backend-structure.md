# 後端結構與資料流

依據：`c2a8d7a1847388d1c8372f9030a8bdbbba6ce17b` 的原始碼，2026-10-21 盤點。這是程式現況，不是正式環境設定或部署證明；功能決定以 [功能清單](features/README.md) 的規格為準。

| 盤點範圍 | 數量 | 計數方式 |
|---|---|---|
| 後端模組 | 53 | `server/` 直下的 `*.ts`，包含 CLI、測試專用及保留模組 |
| 後端檔案宣告的表 | 33 | `server/*.ts` 中 `CREATE TABLE` 表名去重，不把重複 schema 算兩次 |
| 共用 schema 的表 | 1 | `src/storage/schema.ts` 的 `completions`，由 `server/db.ts` 執行 |
| 本文件資料表列 | 34 | 上述聯集；不含 SQLite 內部表、測試 fixture 額外建表或舊資料庫才有的提名表 |

`tests/tools/backendStructureDocs.test.ts` 只讀原始碼，逐一要求模組的責任/使用者與資料表的內容/寫入/讀取/刪帳列，不會匯入或啟動後端。它擋漏列，不判斷敘述是否正確；改程式時仍須人工核對受影響列。

## 入口與儲存邊界

- `npm run server` 執行 [http.ts](../server/http.ts)：組裝資料庫、認證、外部 adapter、LINE webhook 與選配 worker。只有直接執行此檔才監聽 HTTP、安裝 NAT64 fallback；匯入 `createHttpServer` 不會自行 listen。
- [db.ts](../server/db.ts) 用 Node `DatabaseSync` 開啟 SQLite；未指定檔名時是 `:memory:`。建庫套用共用完成紀錄 schema、相容性加欄、各領域 schema 與讀經計畫。`createApiHandler` 再建立報名、靈修完成、歸屬與裝置版本 schema。
- `http.ts` 依序交給公開聖經 adapter、公開詩歌播放器、驗簽的 LINE webhook，最後才是 [routes.ts](../server/routes.ts) 的 API。不是所有 HTTP 請求都進會員路由。
- 會員 API 的 Bearer 經 [authBoundary.ts](../server/authBoundary.ts) 驗證，接受裝置 session、舊簽名 session 或 Google ID token；接著檢查會員存在且啟用。測試 fixture 是另外的明確模式。管理能力由私人設定與試算表管理者合併，每次查詢重新解出。
- SQLite 以外還有檔案與記憶體資料，見「非資料表儲存」；不要把所有內容都當成資料庫表。

## 模組清單

每列對應一個 `server/*.ts`。下欄省略同目錄的 `server/` 前綴；「型別」代表編譯期引用，不代表執行呼叫。一般測試引用不重複列；只有測試使用的模組會明寫。函式位置可直接從第一欄同名檔案查閱。

| 模組 | 負責什麼 | 被誰使用 |
|---|---|---|
| `server/accountDeletion.ts` | `deleteMemberAccount` 在單一交易清除會員資料、關聯與含會員 ID 的 JSON 回應；保留公共內容 | `routes.ts` 的 `DELETE /api/me` |
| `server/adminLinks.ts` | 每次讀取選配文件清單，只接受 HTTPS 連結；檔案缺損回空陣列 | `routes.ts` 管理文件 API |
| `server/apnsSender.ts` | 透過 `@parse/node-apn` 傳 iOS 可見通知，自訂資料放 `body`；辨識失效 token | `remoteConfiguration.ts` 延遲載入；`scripts/ios/make-friend-apns.ts`；`friendPush.ts`、`http.ts`、`routes.ts` 僅引用 sender 型別 |
| `server/appleTokens.ts` | AES-256-GCM 封存/解開 Apple refresh token；交換 authorization code、撤銷 Apple token | `http.ts` 組裝 token client；`routes.ts` 登入與刪帳 |
| `server/appleVerifier.ts` | 用 Apple JWKS 驗 ID token 的簽名、issuer、audience、必要 claims 與選配 nonce | `http.ts`、`appleTokens.ts`；`routes.ts` 引用身分型別 |
| `server/authBoundary.ts` | 驗 fixture、Google、裝置/舊 session，回傳會員身分或認證錯誤 | `routes.ts` |
| `server/bulletinAccess.ts` | 簽發與驗證週刊相容 cookie，供不帶圖片 Bearer 的舊版 App 使用 | `routes.ts` 的週刊清單/圖片路徑 |
| `server/bulletins.ts` | 聚合同發送者、時間相近的 A4 圖為週刊；檔案儲存、保留最近 8 週、讀清單與原圖 | `http.ts`、`routes.ts`、`bulletinsResize.ts`；`lineWebhook.ts` 引用圖片型別；`scripts/ios/make-bulletin-fixture.ts`、`scripts/ios/check-bulletin-requests.ts` |
| `server/bulletinsImage.ts` | 尋找與載入純 JS `jimp-compact`，提供週刊圖片工具型別 | `bulletinsResize.ts` 尋找套件；`scripts/ios/make-bulletin-fixture.ts`、`scripts/ios/check-bulletin-viewer.ts` 載入工具 |
| `server/bulletinsResize.ts` | 以 worker thread 串行製作 720/1080/1440 寬週刊副本，存原圖旁；等待超時或不可解碼退回原圖 | `routes.ts`；`scripts/ios/make-bulletin-fixture.ts` 預製 fixture 副本 |
| `server/claudeCli.ts` | 隔離 Claude CLI 工作目錄與環境、限制輸出/逾時，將失敗分類 | `tools/announce/classify.ts`、`tools/announce/review.ts`；不是 HTTP 請求內的背景估價服務 |
| `server/clientInstalls.ts` | 驗證 App 安裝/版本表頭；每安裝只留最新一列，內容與日期相同不重寫 | `routes.ts` 記錄/管理清單；`rewardSheetStats.ts` 查最近安裝 |
| `server/communityProgress.ts` | 從已啟用會員完成紀錄算跨成員里程與匿名人數，供舊社群呈現 | `routes.ts` 的 `/api/points/community` |
| `server/congregation.ts` | 建立/讀寫青少與主堂歸屬；舊會員遷入青少，尚未選擇讀回 null；產生群體統計條件 | `routes.ts`、`devotionProgress.ts`、`rewardSheet.ts`、`rewardSheetStats.ts` |
| `server/contentCapabilities.ts` | 解析章節能力查詢，結合 registry、閘門與提供者狀態 | `routes.ts` 的內容能力 API |
| `server/contentRegistry.ts` | 保存章節音訊觀測資料與有效期限，按譯本/USFM 查能力證據 | `contentCapabilities.ts` |
| `server/db.ts` | 建庫、加欄、回填舊 operation fingerprint、建立計畫與選配種子資料；提供關閉函式 | `http.ts`；其他 API 模組引用資料庫/種子型別 |
| `server/devotional.ts` | 解析靈修原文與詩歌連結、讀每日文字檔、查快取歌名/頻道；提供公開 YouTube 播放器頁 | `routes.ts`、`http.ts`、`lineWebhook.ts`、`devotionalAudio.ts` |
| `server/devotionalAudio.ts` | Azure Speech 合成段落、以內容雜湊快取 MP3、全程序串行佇列、雙聲音預熱 | `http.ts` 啟動/收文預熱；`routes.ts` 音訊 API |
| `server/devotionProgress.ts` | 靈修完成讀寫、群體每日讀經人數/團體獎與歷史分數；靈修不寫積分帳 | `routes.ts`；`rewardSheetStats.ts` 取每月讀經天數 |
| `server/eventRegistrations.ts` | 驗表單同步 key 或 Google 身分與 audience；解析日期、比對姓名、替換報名與總數，只回自己的好友 | `http.ts` 組裝同步身分；`routes.ts` 同步/會員報名 API |
| `server/fcmAuth.ts` | 讀服務帳號、簽 JWT 換 Google OAuth access token 並快取 | `remoteConfiguration.ts` |
| `server/fcmSender.ts` | 呼叫 FCM HTTP v1，傳聚會或一般 data-only 訊息並要求 provider message ID | `remoteConfiguration.ts` |
| `server/fixtureVersionNotice.ts` | 從 App 設定產生高一版的 Android/TestFlight 測試更新資訊 | `http.ts` 的 fixture 分支 |
| `server/friendPush.ts` | 加好友後非同步通知 QR 擁有人所有有效裝置；Android FCM、iOS APNs；失效 APNs token 撤銷 | `routes.ts`；`http.ts`、`remoteConfiguration.ts` 引用 sender 型別 |
| `server/gamification.ts` | 積分 schema、讀經計畫、完成交易、得分/錢包、個人/好友權限、圖表、QR、目標與重放收據 | `db.ts`、`routes.ts`、`rewardSheetStats.ts`、`scripts/migrate-gamification.ts`；`journal.ts` 僅引用錯誤型別 |
| `server/genericChapterAudio.ts` | 即時問 YouVersion 章節音訊 metadata、解析時間/歸屬、記憶體快取與去重、有限並行預熱 | `routes.ts` |
| `server/googleVerifier.ts` | 用 Google JWKS 驗 ID token；提供指定 audience 與同步腳本用的任意 audience 驗證 | `http.ts` 注入認證函式 |
| `server/groups.ts` | 建立小組/RPG profile 種子；依連結與聚會狀態投影可公開給會員的資料 | `http.ts`、`routes.ts`；`membership.ts` 留有未使用的 import；現行主要 UI 不提供小組入口 |
| `server/http.ts` | 組裝服務、分流 HTTP、可選啟動聚會 worker、停止時先收 worker 再關資料庫 | `npm run server` 直接執行；`scripts/server-smoke.ts` 匯入測試服務 |
| `server/importMeetingSchedules.ts` | CLI 讀既有資料庫與 JSON；預設 dry-run，`--apply` 必須匹配輸入 SHA-256 | 直接以 `tsx server/importMeetingSchedules.ts` 執行；無其他產品模組匯入 |
| `server/journal.ts` | 建立舊日記表，只提供本人日期/區間讀取；目前沒有寫入函式 | `db.ts`、`routes.ts`；日記不上傳的產品決定見 [journal.md](features/journal.md) |
| `server/legacyPointMigration.ts` | 對舊 point events/完成紀錄做來源與目標快照驗證，套用有效得分、期初錢包及遷移收據 | `scripts/migrate-gamification.ts`；`gamification.ts` 匯出/使用遷移相關定義 |
| `server/lineContent.ts` | 換取短效 LINE token、只 GET 圖片內容與群組摘要 | `http.ts` 注入週刊 collector 與群組目錄 |
| `server/lineGroups.ts` | 首次查群組名稱，依名稱前綴辨別用途；群組 ID/名稱存選配 JSON，查不到不接收內容 | `http.ts` 建立目錄；`lineWebhook.ts` 引用目錄型別並使用注入介面 |
| `server/lineWebhook.ts` | 驗 raw body HMAC 簽名；只收認得的公布欄靈修/圖片，靈修以暫存檔 rename 寫入 | `http.ts` 的 `/api/line/webhook` |
| `server/meetingSchedules.ts` | 補聚會欄位、驗匯入時間/來源/修訂、套用或 dry-run，讀會員聚會提醒快照 | `db.ts`、`importMeetingSchedules.ts`、`reminderPreferences.ts`；`remoteReminders.ts` 引用狀態型別 |
| `server/membership.ts` | 啟用碼雜湊、種子與交易式認領；綁定 Google 身分到會員 | `http.ts`、`routes.ts` |
| `server/mobileSessions.ts` | 裝置 session 隨機 token/雜湊、啟用檢查與撤銷；記舊 session 撤銷 | `db.ts`、`routes.ts` |
| `server/nat64Fallback.ts` | 對僅有 IPv4 的全位址 DNS 查詢追加 NAT64 位址；保留原 IPv4 優先，安裝一次 | `http.ts` 的直接執行分支；關閉旗標是 `QINGMU_NAT64_FALLBACK=0` |
| `server/officialBibleAdapter.ts` | 將允許的公開聖經請求轉到官方 API/網站並驗內容身分；有限記憶體快取、stale 退路與 CORS | `http.ts`，在會員 API 前分流 |
| `server/operationFingerprint.ts` | 以固定 JSON 陣列順序綁會員/計畫/日期/狀態，產生舊完成操作的內部 fingerprint | `db.ts` 回填；`tests/baseline/db.ts`、`tests/baseline/deployedDb.ts` |
| `server/reminderPreferences.ts` | 現行提醒偏好與裝置登記/撤銷，generation 防舊資料覆蓋新資料 | `routes.ts` |
| `server/reminders.ts` | 另一套偏好/裝置/到期與傳送實作，保留程式 | 僅 `tests/server/reminders.test.ts`；`http.ts`/`routes.ts` 未接此實作 |
| `server/reminderWorker.ts` | 查到期、有正式排程來源的 Android 聚會事件，串行 tick 並可 start/stop | `http.ts`，tick 呼叫 `remoteReminders.ts` |
| `server/remoteConfiguration.ts` | 由選配設定組 FCM/APNs sender 與狀態，APNs 延遲載入，未設 sender 不傳送 | `http.ts` |
| `server/remoteReminders.ts` | 重查聚會、偏好與裝置；先 claim 再傳，SENT/UNKNOWN 防重送，送出前再查啟用狀態 | `reminderWorker.ts`；`routes.ts` 做裝置快照授權；`http.ts`、`remoteConfiguration.ts` 引用 sender 型別 |
| `server/rewardSheet.ts` | 套用獎品/兌換同步、穩定姓名標籤、各邊上架狀態與舊目標遷移，呼叫管理者勾選同步 | `gamification.ts` 建 schema/扣兌換分；`routes.ts` 同步/獎品/目標/紀錄 |
| `server/rewardSheetStats.ts` | 產生青少/主堂統計列、每月讀經天數、積分/餘額、管理者與最近手機資訊 | `routes.ts` 的試算表同步回應 |
| `server/routes.ts` | API 路由、認證與欄位驗證、管理授權、領域服務呼叫、相容回應及錯誤格式 | `http.ts` |
| `server/session.ts` | 建立/驗證有期限的 `qms_` 簽名 session；不存資料庫 | `authBoundary.ts`、`mobileSessions.ts`、`routes.ts` |
| `server/sheetAdmins.ts` | 解析試算表勾選，授權/撤銷及記錄變更；不能撤銷私人設定管理者 | `rewardSheet.ts`、`rewardSheetStats.ts`、`routes.ts` |
| `server/testLabNetwork.ts` | 依內建網段辨識測試機來源位址，作為 Google 首次建員停用訊號之一 | `routes.ts` 首次 Google 建員 |

## 資料表清單

「誰寫」指目前可達的產品/工具寫入與必要建庫遷移；刪帳清理統一另列，不把它混成正常業務寫入。模組名稱皆指 `server/`，另註的共用 schema/CLI 除外。

刪帳依據是 [accountDeletion.ts](../server/accountDeletion.ts) 的 `OWNERS`、`member_id` fallback、JSON 精確值掃描及署名替換；不是外鍵級聯。以下「刪本人」只描述伺服器 SQLite。資料庫交易不會連帶修改外部 Google 試算表、LINE 或私人設定。

| 資料表 | 存什麼/定義來源 | 誰寫 | 誰讀 | 刪除帳號時怎麼處理 |
|---|---|---|---|---|
| `members` | 會員 ID、顯示名、小組、停用時間；`db.ts`/`mobileSessions.ts` | `db.ts` 種子、`membership.ts` 認領、`routes.ts` 首次登入/測試機停用 | `routes.ts`、身分/session、小組、好友/積分/群體/同步/提醒模組 | 最後刪本人整列 |
| `identity_bindings` | provider/subject 到會員綁定；`db.ts` | `membership.ts`、`routes.ts` 首次 Google/Apple 綁定 | `http.ts` 注入的身分解析、`membership.ts`、`routes.ts` | 依 `member_id` 刪本人 |
| `apple_refresh_tokens` | 加密的 Apple refresh token；`db.ts` | `routes.ts` Apple code 交換成功後封存 | `routes.ts` 刪帳前解密並嘗試 Apple revoke | 依 `member_id` 刪本人；有 token 且可撤銷但外部 revoke 失敗則 API 回 503，尚不執行本機刪除 |
| `member_invites` | 一次性啟用碼雜湊、預定會員/小組、到期與使用時間；`db.ts` | `membership.ts` 種子與認領 | `membership.ts` | 依 `member_id` 刪本人 |
| `member_group_profiles` | 小組/RPG 名稱、連結、聚會及其 revision/source；`db.ts`/`meetingSchedules.ts` | `db.ts`、`groups.ts` 種子、`meetingSchedules.ts` 匯入 | `groups.ts`、`meetingSchedules.ts`、`reminderWorker.ts`、`remoteReminders.ts`；保留 `reminders.ts` 也讀 | 依 `member_id` 刪本人 |
| `completions` | 每會員/計畫/日完成狀態、revision、同步狀態、operation；`src/storage/schema.ts`，`db.ts` 執行 | `gamification.ts` 完成/撤銷交易 | `gamification.ts`、`routes.ts`、`devotionProgress.ts`、`communityProgress.ts`、`rewardSheetStats.ts`、`legacyPointMigration.ts` | 依 `member_id` 刪本人 |
| `operations` | 完成操作回應與 command fingerprint；`db.ts` | `gamification.ts`；`db.ts` 回填舊 fingerprint | `gamification.ts` 重放、`legacyPointMigration.ts` 驗來源 | 解析 `response_json`/`command_fingerprint`，內含精確等於會員 ID 的 JSON 字串值才刪該列 |
| `point_events` | 舊版完成/撤銷計分事件與 policy；`db.ts` | `gamification.ts` 同步寫相容事件 | `routes.ts` 舊報表、`legacyPointMigration.ts` | 依 `member_id` 刪本人 |
| `reminder_preferences` | 讀經/聚會開關、時間、提前量與 generation；`db.ts`/`reminderPreferences.ts` | `reminderPreferences.ts`；保留 `reminders.ts` 有另一實作 | `reminderPreferences.ts`、`remoteReminders.ts`、`reminderWorker.ts`；`reminders.ts` | 依 `member_id` 刪本人 |
| `device_delivery_tokens` | installation、會員、平台、推播 token、binding/generation 與撤銷時間；`db.ts`/`reminderPreferences.ts` | `reminderPreferences.ts` 登記/撤銷；`friendPush.ts` 撤銷失效 APNs token；保留 `reminders.ts` 有另一實作 | `routes.ts`、`friendPush.ts`、`remoteReminders.ts`、`reminderWorker.ts`；`reminders.ts` | 依 `member_id` 刪本人 |
| `reminder_deliveries` | 聚會送達 claim、狀態、provider ID、分類錯誤；`db.ts`/`meetingSchedules.ts` | `remoteReminders.ts`；保留 `reminders.ts` 有另一實作 | `remoteReminders.ts` 防重送；`reminders.ts` | 依 `member_id` 刪本人 |
| `auth_sessions` | 裝置 token 雜湊或舊 session 撤銷紀錄；`mobileSessions.ts` | `mobileSessions.ts` | `mobileSessions.ts`，由認證/路由呼叫 | 依 `member_id` 刪本人 |
| `reading_days` | 每日計畫、USFM 章節、來源 revision/digest；`gamification.ts` | `gamification.ts` 建庫種子/新版計畫同步 | `gamification.ts`、`routes.ts`、`devotionProgress.ts` | 公共計畫保留 |
| `daily_point_entitlements` | 每會員每天的有效得分、完成 revision、policy、遷移來源；`gamification.ts` | `gamification.ts`、`legacyPointMigration.ts` | `gamification.ts` 的總分/圖表、`devotionProgress.ts`、`legacyPointMigration.ts` | 依 `member_id` 刪本人 |
| `wallet_entries` | 讀經與舊兌換增減/遷移期初帳；`gamification.ts` | `gamification.ts` 完成/撤銷；`legacyPointMigration.ts` 期初帳；現行無 App 兌換寫入口 | `gamification.ts` 餘額、`legacyPointMigration.ts` | 依 `member_id` 刪本人 |
| `rewards` | 獎品、成本、上架、revision、更新者與選配歸屬；`gamification.ts`/`rewardSheet.ts` 加欄 | `rewardSheet.ts` 同步 | `rewardSheet.ts`、`gamification.ts` 目標/個人投影、`routes.ts` | 公共獎品保留；`updated_by` 是被刪會員時改成 `deleted` |
| `reward_targets` | 本人目標獎品與更新時間；`gamification.ts` | `gamification.ts` 選目標；`rewardSheet.ts` 舊目標遷移 | `gamification.ts` 個人投影 | 依 `member_id` 刪本人 |
| `redemptions` | 舊 App 兌換快照、完成/撤銷與操作者；`gamification.ts` | 現行後端沒有新增/撤銷兌換路由；歷史列保留 | `gamification.ts`，`routes.ts` 與試算表紀錄合併回應 | 刪本人領取列；其他人的列保留，該管理者的 `confirmed_by` 改 `deleted`、`reversed_by` 改 NULL |
| `friend_tokens` | QR token 雜湊、擁有人與到期/撤銷；`gamification.ts` | `gamification.ts` 簽發及刪好友時撤銷 | `gamification.ts` claim | 依 `owner_member_id` 刪本人 |
| `friendships` | 排序後兩位會員的雙向關係、建立者與 operation；`gamification.ts` | `gamification.ts` 加/刪好友 | `gamification.ts`、`eventRegistrations.ts` | `member_low` 或 `member_high` 是本人就刪 |
| `mutation_receipts` | actor/operation、payload hash、結果 JSON；`gamification.ts` | `gamification.ts` 好友 claim | `gamification.ts` 重放 | 刪本人 actor；其他列若 `result_json` 含精確會員 ID 值也刪 |
| `migration_receipts` | migration ID、輸入 digest、結果 JSON 與時間；`gamification.ts` | `legacyPointMigration.ts` | `legacyPointMigration.ts` 重放/驗證 | 無會員欄，通常保留；`result_json` 若含精確會員 ID 值才刪 |
| `journal_entries` | 舊日記 body、日期、plan/revision、operation；`journal.ts` | 目前沒有產品寫入函式；`PUT /api/me/journal/:date` 回 405 | `journal.ts`，路由只供本人 GET 舊資料 | 依 `member_id` 刪本人；不表示 App 日記正在上傳 |
| `event_registrations` | 報名日期與已匹配的會員，不存原始未匹配姓名；`eventRegistrations.ts` | `eventRegistrations.ts` 表單同步替換 | `eventRegistrations.ts` 的本人/好友查詢 | 依 `member_id` 刪本人 |
| `event_registration_totals` | 各活動日期去重總人數，含未匹配者；`eventRegistrations.ts` | `eventRegistrations.ts` 同步 | `eventRegistrations.ts` | 無會員欄，保留總數，不因刪帳重算 |
| `form_sync_audience` | 首次核准同步腳本的 audience 與時間；`eventRegistrations.ts` | `eventRegistrations.ts` 身分驗證的首次釘選 | `eventRegistrations.ts` | 整合設定保留，不屬會員資料 |
| `devotion_completions` | 每會員每日靈修完成與時間；`devotionProgress.ts` | `devotionProgress.ts` 完成/取消 | `devotionProgress.ts`、`routes.ts`；不寫入得分帳 | 依 `member_id` 刪本人 |
| `member_affiliations` | 青少/主堂選擇及時間；`congregation.ts` | `congregation.ts` 舊會員初始化/會員選擇 | `congregation.ts` 及群體 SQL、`rewardSheet.ts`、`rewardSheetStats.ts`、`routes.ts` | `member_id` fallback 刪本人 |
| `client_installs` | 每安裝最近會員、平台/版本/build/OTA 與最後日期；`clientInstalls.ts` | `clientInstalls.ts`，由認證後的路由記錄 | `clientInstalls.ts` 最近裝置投影，供管理清單與統計 | 依 `member_id` 刪本人 |
| `reward_sheet_sync` | 青少/主堂最近同步時間；`rewardSheet.ts` | `rewardSheet.ts` | `rewardSheet.ts` 決定用同步或舊獎品 | 無會員欄，保留 |
| `sheet_redemptions` | 各邊試算表列號對應的會員兌換、分數與日期；`rewardSheet.ts` | `rewardSheet.ts` 每次整邊替換 | `rewardSheet.ts`、`gamification.ts` 算餘額/紀錄 | `member_id` fallback 刪本人；不會清除外部試算表列 |
| `member_sheet_labels` | 不撞名且穩定的會員試算表標籤；`rewardSheet.ts` | `rewardSheet.ts` 首次分配 | `rewardSheet.ts`、`rewardSheetStats.ts` | `member_id` fallback 刪本人；不會改外部試算表 |
| `sheet_admins` | 試算表授權的管理者與時間；`sheetAdmins.ts` | `sheetAdmins.ts` 授權/撤銷 | `sheetAdmins.ts`，供路由能力與統計 | 依 `member_id` 刪本人 |
| `sheet_admin_changes` | 管理者 grant/revoke、當時姓名標籤與時間；`sheetAdmins.ts` | `sheetAdmins.ts` | 目前無產品讀取 API；保留變更紀錄 | 依 `member_id` 刪本人 |

刪帳另外防守舊資料庫可能存在的 `reward_nominations` 及其子表：刪本人建立的提名/關聯票、清除決策署名。這些不是目前 `CREATE TABLE` 宣告的表，故不列入 34 張現行 schema 清單。

## 主要資料流

下列是程式路徑，不表示本次實際對外呼叫過。App 的傳輸封裝在 `src/services/`；[routes.ts](../server/routes.ts) 是會員 API 路由正本。

| 起點/請求 | 路由與模組 | 儲存與結果 |
|---|---|---|
| App Google/Apple 登入、啟用碼認領 | `http.ts` → `routes.ts` 的 `/api/session/google`、`/api/session/apple[/challenge]`、`/api/onboarding/claim` → verifier、`membership.ts`、`mobileSessions.ts` | `members`、`identity_bindings`、`auth_sessions`；Apple 可選 `apple_refresh_tokens`；啟用碼用 `member_invites`，challenge nonce 暫存在記憶體 |
| App 取計畫/完成/撤銷 | `GET /api/me/reading-days`、`PUT /api/me/completions/:plan/:date` → `gamification.ts` | 讀 `reading_days`；交易寫 `completions`、有效得分、錢包、相容 `point_events`、`operations`，用 expected revision/operation fingerprint 擋衝突與錯誤重放 |
| App 個人/好友/全體積分、圖表 | `/api/points/people`、`/api/points/profiles/:id` → `gamification.ts`，路由套 scope 與管理權限 | 讀會員、好友、有效得分、錢包、目標/獎品；好友回應移除 private，只有全體管理清單附歸屬/最近手機 |
| App 歸屬、團體與靈修完成 | `/api/me/congregation`、`/api/points/group`、`/api/me/devotions[/date]`、`/api/me/score-history` → `congregation.ts`/`devotionProgress.ts` | `member_affiliations`、`completions`、`devotion_completions`、得分帳；靈修不計分，群體人數低於隱私門檻不呈現 |
| App 看經文/聽章節 | 公開經文請求由 `http.ts` → `officialBibleAdapter.ts`；會員 `/api/content-capabilities` → `contentCapabilities.ts`/`genericChapterAudio.ts` | 官方聖經 API/網站與 YouVersion 章節音訊 metadata；有限記憶體快取，不寫 SQLite；App 播放來源音訊，不由這裡建立音訊資料表 |
| App 取靈修/週刊 | `/api/devotional/:date`、`/api/bulletins[/:date/:index]` → `devotional.ts`、`bulletins.ts`/`bulletinsResize.ts` | 讀檔，圖片回原圖或手機副本；需會員驗證，舊週刊圖片可用簽名 cookie；詩歌公開播放器頁只含 video ID |
| App 加/刪好友 | `/api/friends/qr`、`/api/friends/claim`、`DELETE /api/friends/:id` → `gamification.ts` | `friend_tokens`、`friendships`、claim 的 `mutation_receipts`；新成立時另觸發好友推播，不把推播成敗當 claim 結果 |
| App 提醒設定/裝置登記 | `/api/me/reminders`、`/api/me/reminders/device-token[/revoke]` → `reminderPreferences.ts`；裝置 validate/revoke 走路由與 `remoteReminders.ts` | `reminder_preferences`、`device_delivery_tokens`；讀經本機通知由 App 排程，後端 worker 是另一條聚會路徑 |
| App 永久刪帳 | `DELETE /api/me` → `routes.ts` 確認，選配 Apple revoke → `accountDeletion.ts` | 本文逐表清理，交易失敗回滾；外部資料來源不在此交易內 |

### LINE webhook 與週刊

`LINE → POST /api/line/webhook → http.ts (raw body 上限/保留原 bytes) → lineWebhook.ts (HMAC 驗簽) → lineGroups.ts → lineContent.ts (群組摘要)`。只有辨識成公布欄的群組可進下游；查不到名稱就略過，其他訊息不存也不回覆。

| 接收內容 | 後續路徑 | 出口/儲存 |
|---|---|---|
| 符合靈修格式的文字 | `devotional.ts` 解析 → `lineWebhook.ts` 寫暫存檔並 rename → `onSaved` | 每日文字檔；觸發 `devotionalAudio.ts` 預熱，不使用 SQLite |
| LINE 原生圖片 | 非同步 `bulletins.ts` → `lineContent.ts` GET message content → A4/同人/時間聚合 | 週刊日期資料夾、頁面 JPEG、`meta.json`；保留 8 週。請求手機圖時才由 `bulletinsResize.ts` 製作副本 |

### Google 試算表進出

| 外部入口 | 後端處理 | 回到外部/提供 App |
|---|---|---|
| `tools/rewards/reward-sheet.gs` → `POST /api/integrations/reward-sheet` | `routes.ts` → 同步專用 key 或指定 Google 身分/audience 檢查 → `rewardSheet.ts` 交易套用獎品/兌換、分配標籤、`sheetAdmins.ts` 處理管理勾選 | 回傳各邊姓名標籤、拒絕列、舊獎品與 `rewardSheetStats.ts` 統計；腳本寫回試算表。App 從獎品/目標/領取紀錄/個人積分 API 讀 SQLite 投影 |
| 表單同步腳本 → `POST /api/integrations/form-registrations` | 相同整合授權邊界 → `eventRegistrations.ts` 姓名/日期匹配、替換昨天起的資料 | 寫會員報名與日期總數；`GET /api/me/event-registrations?date=...` 只回本人狀態、總數、好友姓名 |

一般管理者 session 不能替代整合授權。`form_sync_audience` 只釘選腳本 audience；不是會員管理名單。缺少一邊的獎品同步不覆寫那邊；未傳 admins 的舊腳本也不改管理權限。

### 靈修語音合成

`http.ts 啟動時最近貼文，或 LINE onSaved → warmDevotionalAudio → readDevotional → speechUnits → devotionalAudio.ts → Azure Speech → MP3 快取`。兩種聲音依序預備，整個程序共用一條合成佇列；同一日期/段落/聲音/文字用 SHA-256 檔名，已存在的 MP3 直接讀、不排合成。

`App GET /api/devotional/:date/audio/:index?voice=... → routes.ts` 驗日期、聲音與段落 → 同一 synthesize/cache → `audio/mpeg`。內容、段落編號或聲音不同就有不同快取鍵；失敗退回手機語音是 App 的行為，見 [reader.md](features/reader.md)，不是後端生成另一份音檔。

### 推播與提醒

| 觸發 | 模組鏈 | 邊界與紀錄 |
|---|---|---|
| 新好友 claim 成立 | `routes.ts` 非同步 → `friendPush.ts` → `remoteConfiguration.ts` 提供的 Android FCM sender 或 iOS APNs sender | 讀 QR 擁有人有效裝置；FCM data-only，APNs 可見 alert + body 資料；沒有 sender 就略過，推播失敗不回滾好友；沒有好友推播收據表，APNs unregistered 撤銷 token |
| 聚會到期 (目前產品關閉) | `http.ts` 選配 worker → `reminderWorker.ts` → `remoteReminders.ts` → `fcmSender.ts`/`fcmAuth.ts` → FCM | 只查 Android；檢查正式來源排程/啟用/偏好/版本/期限，先寫 `reminder_deliveries` CLAIMED，成功記 SENT/provider ID，無法確定記 UNKNOWN 且不盲重送；`http.ts` 非 fixture 預設停用聚會提醒與自動 worker |
| 每日讀經提醒 | App 的 reminder runtime/本機排程 | 後端保存偏好與登記，不由聚會 worker 逐日推讀經提醒；平台差異見 [reminders.md](features/reminders.md) |

## 非資料表儲存

| 類別 | 內容 | 寫/讀模組 | 刪帳邊界 |
|---|---|---|---|
| 靈修文字與 MP3 | 日期文字檔、內容雜湊音檔 | `lineWebhook.ts`、`devotional.ts`、`devotionalAudio.ts` | 公共靈修內容，不依會員刪 |
| 週刊原圖/副本/metadata | 日期目錄下 JPEG 與 JSON | `bulletins.ts`、`bulletinsResize.ts` | 公共週刊，不依會員刪 |
| 群組目錄 | 群組 ID → 名稱的選配 JSON | `lineGroups.ts` | 非會員表；不存群組訊息或會員資料 |
| 管理文件與服務設定 | 選配連結清單、各服務憑證/設定 | `adminLinks.ts`、`http.ts`、`remoteConfiguration.ts` 等 | 刪帳不修改設定檔或外部帳戶；公開 repo 不放實際設定值 |
| 記憶體 | 聖經/章節音訊 metadata、歌名、Apple challenge、未貼文回覆節流、LINE token、合成/縮圖去重佇列 | 各 adapter/路由/collector | 不宣稱永久儲存；程序重啟即失去；不等同 SQLite 表 |

## 維護時核對

新增模組或表先更新對應列，並核對 caller、讀寫及刪帳行為；表名涵蓋守衛不能取代這些語意核對。畫面的既有設計原因與缺口另見 [畫面設計原因盤點](design/screen-rationale-inventory.md)。
