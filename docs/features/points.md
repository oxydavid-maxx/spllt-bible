# 積分與社群

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

積分頁顯示自己讀經累積的分數、走勢與目標獎品，可以加好友互相看進度，管理者可以看全體排名、發獎品、開提名投票；還有一塊看全團契一起讀了多少的進度，不排名也不能失敗。

## 從哪裡進

- 底部導覽「積分」分頁（`app/(tabs)/progress.tsx`）。
- 頁面上方三個範圍分頁：「自己」「好友」「全體（管理）」。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 範圍切換 | 上方「自己/好友/全體（管理）」分頁；「全體」只有管理者能看到入口，且要先解鎖 |
| 自己的積分 | 總積分、梯隊（滿 10 人才分）、目標獎品進度條、累積走勢或讀經日曆 |
| 目標獎品 | 從獎品目錄選一個要換的獎品，進度以「已累積/所需」分數呈現 |
| 好友清單 | 加好友後可以看到彼此的積分（不含對方的餘額、目標獎品等私人資料） |
| 好友 QR | 出示或掃描 QR code 立即互相加好友，不需要對方同意 |
| 好友新增推播 | 對方掃你的 QR 加你好友時，你會收到「XX 已加你為好友」的通知 |
| 全體排名（管理） | 管理者用裝置生物辨識解鎖後可看到所有人排名 |
| 現場兌換（管理） | 管理者幫學生兌換獎品、查看/撤銷兌換紀錄 |
| 提名獎品投票 | 開放投票期間內，每人可以提一個獎品構想並投最多 3 票；管理者核准後變成正式獎品 |
| AI 估價與說明建議 | 系統背景幫忙把「多少/多久」換算成大約分數，並在說明不清楚時提供改寫建議 |
| 一起走過（社群進度） | 6 人以上才顯示：目前一起在讀的書，章節被讀過幾人次，沒有排名也不會顯示 0 |

## 行為規格

### 範圍與權限
來源：`app/(tabs)/progress.tsx:270-295`、`src/services/adminUnlockGuard.ts`、`server/gamification.ts:526-529`

- 「自己」永遠可見；「好友」需要先加好友才有內容；「全體（管理）」只有 `adminMemberIds` 名單內的帳號才會看到分頁，其他人完全看不到這個分頁（`getViewerCapabilities`，`gamification.ts:526-529`）。
- 進入「全體」前要求裝置生物辨識（Face ID/指紋/解鎖圖案），解鎖狀態只保留在這次畫面停留期間，切到背景或換帳號會清空重新要求（`createAdminUnlockGuard`，`adminUnlockGuard.ts:9-27`；`clearProtectedState`，`progress.tsx:127-142`）。
- 解鎖失敗或取消：顯示「需要完成身分驗證才能查看全體。」，停留在原分頁。

### 自己的積分卡片
來源：`src/ui/gamification/ScoreProfile.tsx`、`src/ui/gamification/RewardGoalCard.tsx`、`server/gamification.ts:560-578`

- 有目標獎品時，最上方是目標獎品卡片：獎品名稱、進度「已累積/所需 分」的橫條，寫法固定是「72/120 分」這種分數格式，不寫「還差 N 分」。可以兌換時顯示「可以兌換了‧主日找輔導領取」。
- 沒有設定目標時顯示「選一個目標獎品」與說明文字，並在下方列出總積分與梯隊。
- 梯隊：全體中，啟用帳號且積分大於 0 的人數要滿 10 人才開始分梯隊，不足時顯示「滿 10 人開始分梯隊」；滿足後分 1 到 5 梯隊，積分排前面的梯隊數字較小（`calculateBand`，`src/domain/gamificationV1.ts:104-109`）。
- 已兌換掉的分數會在有目標獎品時顯示「可兌換 {餘額} 分‧已兌換 {已兌換} 分」（`earnedTotal - redeemableBalance`，`RewardGoalCard.tsx:37,54`）。
- 有多個現行獎品且目標不是唯一選項時，下方出現一排可以左右滑動的獎品架，點其他獎品可以直接把目標換成它（`shelfOffersAChoice`，`RewardGoalCard.tsx:44,64-75`）。

### 累積走勢/讀經日曆圖表
來源：`src/ui/gamification/ScoreProfileChart.tsx`、`server/gamification.ts:340-513`

- 有「週/月/年/全部」四個範圍可切換，各自有上一期/下一期箭頭（未來的期間不能切過去）。
- 自己的積分頁固定顯示「走勢」（累積積分折線圖，點折線上的點可以看某一天/期累積多少分）；好友的頁面另有「走勢/日曆」切換，日曆檢視是月曆網格，綠色格代表那天有讀，深色代表整週（週日到週六）都讀了的「完整週」。
- 舊版沒有回傳圖表資料時（相容舊伺服器/舊快取），退回顯示「近六個月」的六格月柱狀簡表，不會被誤讀成每日資料（`isLegacyFallback`，`ScoreProfileChart.tsx:264-271`）。
- 兌換與撤銷兌換不影響走勢或總積分：圖表只統計 `daily_point_entitlements` 表裡生效中的完成記錄，跟錢包餘額是分開算的（`docs/design/score-profile-chart.md`「Aggregation rules」）。

### 好友：加好友與查看
來源：`src/ui/gamification/FriendQrPanel.tsx`、`src/services/gamificationQr.ts`、`server/gamification.ts:596-634`

- 我的好友 QR 每 5 分鐘過期一次，快過期（剩不到 1 分鐘）時自動重新產生一個（`FRIEND_TOKEN_TTL_MS = 5 分鐘`，`gamification.ts:30`；`FriendQrPanel.tsx:23`）。
- 掃到有效 QR 立刻成為雙向好友，不需要對方額外確認（`claimFriend`，`gamification.ts:605-622`）；掃到過期或已撤銷的 QR 顯示「這不是青牧好友碼，請重新掃描。」或對應錯誤訊息。
- 移除好友是雙向移除，且會同時撤銷這位使用者當時尚未過期的所有好友 QR（`removeFriend`，`gamification.ts:624-634`）。
- 好友清單只顯示對方的暱稱與總積分，不含對方的可兌換餘額、目標獎品等私人欄位（`getScoreProfile` 只在 `viewerId === memberId` 或管理者時才附加 `private`，`gamification.ts:566,576`）。
- 好友被停用帳號（`disabled_at`）時，非管理者看不到這位好友（`canViewMember`，`gamification.ts:536-539`）。

### 好友新增推播
來源：`src/services/friendPush.ts`、`server/friendPush.ts`、`src/domain/friendNotificationText.ts`

- 通知文字固定是標題「竹科聖經」、內容「{對方暱稱} 已加你為好友」，兩平台文字相同（`friendAddedNotificationText`，`friendNotificationText.ts:6-8`）。
- App 在前景時：好友清單立刻更新，若「我的好友 QR」面板正開著，會多顯示一行「✓ {暱稱} 已加你為好友」。
- App 在背景或未開啟時（僅 Android）：只有在使用者已經允許通知的情況下才會發出一則本機通知，從不主動要求開啟通知權限；點通知會開啟積分頁的好友清單。
- 同一位好友加入的推播 30 秒內視為重複，只處理一次，不會重複跳出（`DUPLICATE_WINDOW_MS = 30000`，`friendPush.ts:33`）。

### 管理者：獎品與兌換
來源：`src/ui/gamification/RewardControls.tsx`、`src/ui/gamification/RedemptionList.tsx`、`server/gamification.ts:636-760`

- 管理者可以直接新增/編輯/下架獎品（名稱、所需分數）；下架的獎品不會再出現在任何人的獎品架或兌換清單。
- 兌換由管理者在學生面前操作：選獎品、確認交付，扣的分數立刻反映在該學生的可兌換餘額；餘額不足時伺服器拒絕（`INSUFFICIENT_POINTS`，`gamification.ts:733`）。
- 撤銷兌換必須填撤銷理由才能送出（`REVERSAL_REASON_REQUIRED`，`gamification.ts:748`），撤銷會把分數還給該學生的可兌換餘額。
- 撤銷理由等審核相關欄位（`confirmedBy`/`reversedBy`/`reversalReason`）只在管理者查看時附帶，一般成員自己查看兌換紀錄看不到是哪位輔導處理的（`projectMemberRedemption`，`src/domain/gamificationV1.ts:152-162`）。
- 兌換/撤銷若送出時沒有網路，會先存在本機待送出佇列（`gamificationPendingStore.ts`），之後在「尚未確認操作」清單中可以手動重試。

### 提名獎品投票
來源：`src/ui/gamification/NominationBanner.tsx`、`src/ui/gamification/NominationBoard.tsx`、`server/rewardNominations.ts`、`server/nominationAssist.ts`

- 只有管理者能開一輪投票，設定幾天後截止（7/14/30 天三個選項）；同一時間只能有一輪在進行（`ROUND_ALREADY_OPEN`，`server/rewardNominations.ts:276`）。
- 投票期間內（`VOTING`）：每人限提 1 個構想（`MAX_OPEN_PER_MEMBER = 1`），限投 3 票（`VOTES_PER_MEMBER = 3`，`rewardNominations.ts:28,39`），可以隨時取消一票再投別的。截止時間一到，即使伺服器整週沒有重啟，下次任何人查看都會自動變成「投票結束，等輔導決定」（`DECIDING`，`viewRound`，`rewardNominations.ts:178-186`）。
- 提名一定要填「多少/多久」（如「2 小時」「1 杯」），最長 20 字，只有本人可以事後修改（`MAX_QUANTITY_LENGTH = 20`，`rewardNominations.ts:32`）。
- 自己的構想可以在投票期間內隨時撤回，撤回後名額就空出來可以再提一個新的。
- 已婉拒（DECLINED）的構想只有提名者本人能看到；已移除（REMOVED，管理者移除或本人自己撤回）的構想誰都看不到（`listNominations`，`rewardNominations.ts:202-218`）。
- 管理者核准時要輸入這個獎品要花多少積分，才會真的變成一個新的獎品並連結回這個提名（`decideNomination`，`rewardNominations.ts:491-529`）；婉拒、移除則不會建立獎品。
- 投票倒數文字：截止前一天顯示「投票今天截止」，其餘顯示「投票還有 N 天（M/D 截止）」（`describeDeadline`，`src/domain/nominationRound.ts:13-20`）。
- 投票的加入/取消本身不需要重試機制，靠資料庫的組合鍵天然去重（`setVote`，`rewardNominations.ts:444-479` 的說明註解）。

### AI 估價與說明改寫（背景工作）
來源：`server/nominationAssist.ts`

- 每個提名建立後，伺服器每 20 秒的背景排程會挑一個還沒處理過的提名，請 AI 依「多少/多久」估算新台幣價格，並用「電影票＝300元＝目前 75 分」的匯率換算成分數，四捨五入到 5 分的倍數（`ANCHOR_TWD = 300`、`ROUND_POINTS_TO = 5`，`nominationAssist.ts:36-40,145-153`）。
- 換算後的分數只在成員自己有填「多少/多久」且能被合理估價時顯示「約 N 分」；估不出來（描述太模糊，如「很久」）時不顯示分數，只在提名者自己看得到的地方顯示一句提醒，例如：「小提醒：「很久」估不出分數，要不要寫多久？例如 1 小時」。
- 估價結果如果超過目前最貴獎品的 10 倍，一律視為不可用、不顯示（`MAX_MULTIPLE_OF_DEAREST = 10`，`nominationAssist.ts:43,150-152`），避免離譜金額誤導投票。
- 如果附了補充說明，AI 還會檢查文字是否清楚，不清楚時只有提名者自己會看到一則改寫建議，可以選擇「採用」直接換成建議文字，或「維持我寫的」；AI 沒有否決權，兩個選項最後都會送出提名者自己的文字。
- 這個背景工作呼叫 AI 失敗時最多重試一次（`MAX_ATTEMPTS = 2`，`nominationAssist.ts:49`），失敗訊息只記錄分類代碼，不記錄提名內容或錯誤細節，避免學生寫的內容被寫進伺服器紀錄。

### 一起走過（社群進度）
來源：`src/ui/gamification/CommunityProgress.tsx`、`server/communityProgress.ts`

- 團契啟用帳號數要超過 6 人才會顯示這一整塊（`MIN_MEMBERS_FOR_BOOK_SECTION = 6`，`communityProgress.ts:33`）；6 人以下完全不顯示。
- 「目前一起讀完 {書名}」卡片：計畫排定的每一章，只要有任何一個人讀過就點亮，顯示讀過的人數（不是排名，只是人次）；沒有人讀過的章不顯示 0，維持空白，避免看起來像記分板（`buildBookGoal`，`communityProgress.ts:116-154`；`readers: number | null`，注解說明見 `CommunityChapter`）。
- 這個進度沒有期限、不會失敗：一章只要曾經有人讀過就永遠點亮，不會因為進度落後而顯示警示或倒數。
- 「到目前一起讀了 N 天次」這行數字，要團契啟用帳號數與有得過分的人數都達到 10 人才顯示，避免人少時被反推算出某個人的完成天數（`MIN_MEMBERS_FOR_SHARED_COUNT = 10`，`communityProgress.ts:24,183-189`）。

### 遮蔽與隱私
來源：`src/domain/masking.ts`、`src/services/profileCache.ts`

- 目前程式碼中 `maskForViewer`（把非本人的暱稱遮成「O＋中間字＋O」的形式）已實作，但目前沒有任何畫面呼叫它——好友清單與排名目前是直接顯示暱稱全名，未套用遮蔽（見「已知限制與待辦」）。
- 本機積分快取只會存「自己」的資料，且存檔與讀取兩處都各自檢查一次 `memberId` 是否等於目前登入帳號，換帳號時不會把前一個人的積分秀給下一個登入的人看到（`createProfileCache`，`profileCache.ts:20-46`）。

## 決定（為什麼這樣做）

**刻意不做：**

- **不做聊天、共同任務、獎品庫存系統、推播好友動態、獨立管理網站**：這波功能收斂時就把這些排除在範圍外，維護者在同一個 App 裡設定獎品和現場兌換。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1）
- **加好友不需要對方同意，掃到有效 QR 就立刻雙向成立**：沒有等待接受的步驟。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL10）
- **錢包餘額不會季度歸零，也沒有使用期限**：沒兌換掉的分數全部保留。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL06）
- **好友之間沒有聊天或私訊，也不交換電話、LINE 等聯絡資料**：這是給青少年用的功能，刻意把好友關係限制在「看得到彼此讀經進度」而已。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)「兒童與青少年」）
- **管理者身分不是「誰先登入誰就是」**：由維護者在私有部署設定裡逐一指定，不會進公開原始碼；後端每次管理請求都靠這份綁定檢查授權。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §3.4）

- **進度用「已累積/所需」的分數格式呈現（例如「72/120 分」），不寫「還差幾分」「持續累積中」等鼓勵口號**：這是精簡文案的產品決定。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.5）
- **兌換與撤銷兌換不影響走勢圖或總積分**：兩本帳故意分開算，讓兌換不會使歷史紀錄「倒退」。（來源：[../design/score-profile-chart.md](../design/score-profile-chart.md)「Aggregation rules」）
- **舊版伺服器沒有回傳圖表資料時，退回誠實的「近六個月」六格簡表，不會把月資料誤讀成日資料**。（來源：[../design/score-profile-chart.md](../design/score-profile-chart.md)「UI behavior」）
- **好友 QR 的相機掃描畫面不會被存檔或上傳；AI 估價只會拿到提名的「多少/多久」與說明文字，不會附上提名者的姓名或帳號資料**。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)）

## 平台差異

- 好友 QR 掃描：Android 用系統內建的條碼掃描器（`CameraView.launchScanner`，不需要另外要求相機權限，掃描介面由系統提供）；iOS/其他平台用 App 內建相機畫面，第一次使用需要跳出相機權限請求（`src/ui/gamification/FriendQrPanel.tsx:72-104`）。
- 其餘功能（範圍切換、積分卡片、圖表、兌換、提名投票、社群進度）兩平台共用同一份程式碼與畫面。

## 資料與後端

- 積分帳本分兩層：`daily_point_entitlements`（誰在哪天有一份「生效中」的得分，完成打卡時寫入、撤銷時標記失效）與 `wallet_entries`（每一筆加減錢包餘額的紀錄：讀經得分、讀經撤銷、兌換扣分、撤銷兌換退分）。總積分只加總 `daily_point_entitlements`，可兌換餘額只加總 `wallet_entries`，兩者故意分開算，兌換不會讓總積分或走勢圖倒退（`server/gamification.ts:322-330`）。
- 獎品（`rewards`）、目標設定（`reward_targets`）、兌換紀錄（`redemptions`）、好友碼（`friend_tokens`）、好友關係（`friendships`）都是各自獨立的表，變更一律走同一套「操作收據」（`mutation_receipts`）機制防止重複送出時被算兩次（`writeMutationReceipt`/`readMutationReceipt`，`gamification.ts:584-594`）。
- 提名投票另成一組表：`reward_nominations`、`reward_nomination_votes`、`reward_nomination_rounds`、`reward_nomination_assists`（AI 估價/改寫結果），定義在 `server/rewardNominations.ts`、`server/nominationAssist.ts`。核准提名會呼叫跟管理者手動新增獎品「同一個」建立函式（`insertReward`，`gamification.ts:669-674`），確保兩條路徑做出來的獎品資料一致。
- 主要 API：`GET /api/points/profiles/:memberId`（含 `chartRange`/`chartAnchor`）、`GET /api/points/people`、`GET /api/points/community`、`GET/POST /api/rewards`、`GET/POST /api/rewards/nominations`、`GET /api/rewards/nominations/history`、`GET/POST /api/me/redemptions`、`POST /api/me/reward-target`、`POST /api/friends/qr`、`POST /api/friends/claim`、管理者專用的 `/api/admin/rewards`、`/api/admin/rewards/nomination-rounds`、`/api/admin/rewards/nominations`、`/api/admin/redemptions`（`server/routes.ts`）。
- 舊版點數資料以 `server/legacyPointMigration.ts` 一次性搬進現有帳本（寫入 `LEGACY_OPENING_CREDIT` 錢包紀錄），搬移後現行帳本即為唯一計分依據。

## 守住它的測試

| 測試檔 | 內容 |
|---|---|
| `tests/domain/gamificationV1.test.ts` | 分數/梯隊/圖表相關的共用工具函式 |
| `tests/domain/masking.test.ts` | 暱稱遮蔽函式本身的規則（目前未被畫面呼叫） |
| `tests/domain/nominationRound.test.ts` | 提名投票倒數文字 |
| `tests/domain/points.test.ts` | 舊版點數帳本計算（legacy，未接畫面） |
| `tests/domain/gamification.test.ts` | 舊版每週共同目標計算（legacy，未接畫面） |
| `tests/server/gamificationV1.test.ts` | 積分、兌換、好友、目標獎品的後端規則 |
| `tests/server/gamificationMigration.test.ts` | 舊點數資料搬移到新帳本 |
| `tests/server/communityProgress.test.ts` | 一起走過（社群進度）人數門檻與計算 |
| `tests/server/scoreProfileChart.test.ts` | 積分走勢圖後端聚合（週/月/年/全部） |
| `tests/server/rewardNominations.test.ts` | 提名/投票/管理者決定的完整規則 |
| `tests/server/nominationRounds.test.ts` | 提名投票輪次開關與截止規則 |
| `tests/server/nominationQuantity.test.ts` | 提名「多少/多久」欄位規則 |
| `tests/server/nominationAssist.test.ts` | AI 估價、四捨五入、上限、說明改寫規則 |
| `tests/server/nominationAssistRoutes.test.ts` | AI 估價相關路由行為 |
| `tests/integration/nominationAssistShutdown.test.ts` | AI 估價背景工作的關閉流程 |
| `tests/server/friendPush.test.ts` | 好友新增推播（後端發送規則） |
| `tests/services/friendPush.test.ts` | 好友新增推播（App 端接收與去重規則） |
| `tests/services/profileCache.test.ts` | 本機積分快取的帳號隔離規則 |
| `tests/ui/gamificationApiClient.test.ts` | 積分 API client 的請求/解析規則 |
| `tests/ui/gamificationComponents.test.ts` | 積分頁各元件整合 |
| `tests/ui/gamificationNativeComponents.test.ts` | 積分頁原生元件整合 |
| `tests/ui/gamificationProgressRoute.test.ts` | 積分頁路由整合行為 |
| `tests/ui/gamificationProgressSecurity.test.ts` | 積分頁隱私欄位過濾規則 |
| `tests/ui/gamificationSecurity.test.ts` | 積分相關安全規則 |
| `tests/ui/gamificationPendingStore.test.ts` | 兌換/撤銷待送出佇列的安全儲存 |
| `tests/ui/scoreProfileChart.test.ts` | 積分走勢圖/日曆檢視 UI |
| `tests/ui/rewardGoalCard.test.ts` | 目標獎品卡片 UI |
| `tests/ui/communityBookGoal.test.ts` | 一起讀完一本書卡片 UI |
| `tests/ui/nominationBoard.test.ts` | 提名板 UI（提名、投票、管理者操作） |
| `tests/ui/actionSheetDismissal.test.ts` | 操作面板（ActionSheet）點外部關閉規則 |
| `tests/ui/friendPushBridge.test.ts` | 好友推播事件橋接 |
| `tests/ui/progressFriendPush.test.ts` | 積分頁收到好友推播時的畫面反應 |
| `tests/ui/progressModel.test.ts` | 舊版進度顯示模型（legacy，未接畫面） |

## 相關文件

- `docs/design/reading-gamification-v1.md`：原始設計規格（範圍收斂決定 CL01-CL12、資料模型、API 細節）。只連結參考，不照抄——現況已多出這份設計沒有的功能，見下方差異說明。
- `docs/design/score-profile-chart.md`：積分走勢圖的資料模型與聚合規則設計文件。

**現況與 v1 設計文件的差異：**
- v1 設計文件（CL09）只寫「維護者在同一 App 設定獎品及現場兌換」，沒有提名投票、AI 估價、說明改寫；提名投票整套（`server/rewardNominations.ts`、`server/nominationAssist.ts`）是後來加上去的，目前不在 v1 文件範圍內。
- 「一起走過」社群進度（`CommunityProgress.tsx`、`server/communityProgress.ts`）也是 v1 文件之外的後續功能。
- `docs/design/score-profile-chart.md` 描述的是長條圖（bar chart）搭配零基線；目前實際程式碼（`ScoreProfileChart.tsx`）是累積折線圖（走勢）加上另一個月曆熱度網格（日曆），並非長條圖。

## 已知限制與待辦

- `src/domain/masking.ts` 的暱稱遮蔽函式（`maskForViewer`）目前沒有任何畫面在用：好友清單與排名都是顯示完整暱稱，未套用遮蔽。是否要在某個範圍（例如全體排名）套用遮蔽，待產品決定。
- `src/ui/progressModel.ts`、`src/ui/ProgressCard.tsx`（連同 `src/domain/points.ts`、`src/domain/gamification.ts` 的每週共同目標/舊點數帳本邏輯）目前沒有被任何現行畫面使用；積分頁改用 `ScoreProfile` 為主體後，這組舊元件與舊後端端點 `GET /api/progress`（`server/routes.ts`）只剩測試與（可能的）舊版 App 相容用途，是否要正式退役待技術決定。
