# 青牧讀經 Gamification — Detailed Implementation Design Spec v1.0

**狀態：待實作**  
**基準版本：`spllt-bible` 公開原始碼 `c89b6d8`**  
**本次交付：Android App、對應後端、資料遷移、實機驗收及公開 APK**

本規格整合這波全部 12 項修改。第 10 項採最新決定：**掃碼即建立雙向好友，自己、好友及管理者共用固定的少數頁型。**

## 1. 產品範圍、畫面與權限

### 1.1 需求對照

| ID | 項目 | 本次結果 |
|---|---|---|
| CL01 | 功能收斂 | 移除小組/RPG、LINE、通話、聚會提醒及相關入口；主導覽只留讀經、積分 |
| CL02 | Compact UI | 移除鼓勵口號、重複說明及不必要留白 |
| CL03 | 獎品目標 | 使用預設獎品目錄下拉選擇，正面顯示分數及進度 |
| CL04 | 積分計算 | 每日進度完成得 1 分，同一人同一天最多一份有效得分 |
| CL05 | 回補期限 | 台北時間今天及前 6 個日曆天，窗口外仍可閱讀經文 |
| CL06 | 點數結轉 | 未使用餘額全部保留，無季度清零或零頭限制 |
| CL07 | 積分紀錄 | 月積分柱狀圖、歷來總積分、所屬梯隊 |
| CL08 | 完整排名 | 指定 Google 帳號授權，進入時使用系統生物辨識解鎖 |
| CL09 | App 內兌獎 | 光佑在同一 App 設定獎品及現場兌換，不建管理網站 |
| CL10 | 好友 | 掃有效 QR 即成為雙向好友，無等待接受步驟 |
| CL11 | 經文加速 | 有期限的手機快取及當日章節預載 |
| CL12 | 消除閃動 | 音訊槽位固定大小，正常載入不顯示文字、不推動章節按鈕 |

以下功能不在本次範圍：聊天、共同任務、RPG 重組、LINE 同步、通話、獎品庫存系統、推播好友動態、獨立管理網站。

Google 登入仍是基礎身分機制；沒有好友也能正常讀經。

### 1.2 固定頁型

主導覽只有：

```text
[讀經] [積分]
```

頁面實作採以下共用元件，不為自己、好友與管理者各做一套：

| 頁型 | 用途 |
|---|---|
| `ReadingHome` | 日期、當日章節、完成狀態 |
| 既有全螢幕閱讀器 | 經文、音訊、當日章節切換、更多設定 |
| `PeopleList` | 好友名單或管理者全部名單 |
| `ScoreProfile` | 本人、好友或管理者選中的個人積分 |
| `ActionSheet` | 我的 QR、掃碼、帳戶、選獎品、編輯獎品、兌換確認 |

`ActionSheet` 是共用容器，內容依操作替換，不增加主導覽頁籤。

### 1.3 積分頁導航

頂部範圍選擇：

```text
[自己] [好友] [全部🔒]
```

- **自己**：直接顯示自己的 `ScoreProfile`。
- **好友**：先顯示 `PeopleList`，點人名進入同一個 `ScoreProfile`。
- **全部**：只有管理者顯示入口。解鎖後顯示同一個 `PeopleList`，增加名次欄。
- 點開好友或全部名單中的使用者，不切換為另一套積分介面。
- 返回清單時保留原清單位置。
- 好友清單依建立好友關係的時間由新到舊排序，不標名次。
- 全部清單依總積分由高到低排序；同分並列，並列內用 member ID 作穩定排序。

### 1.4 共用個人積分頁

由上至下：

1. 顯示名稱。
2. 歷來總積分及梯隊。
3. 最近六個月份的積分柱狀圖。
4. 私有區塊：可兌換餘額、目標獎品、兌換進度。
5. 管理者操作：現場兌換。

| 內容/操作 | 本人 | 好友 | 管理者 |
|---|---:|---:|---:|
| 顯示名稱、總積分、梯隊 | ✓ | ✓ | ✓ |
| 月積分柱狀圖 | ✓ | ✓ | ✓ |
| 可兌換餘額、目標獎品 | ✓ | — | ✓ |
| 領取紀錄 | ✓ | — | ✓ |
| 修改目標獎品 | ✓ | — | — |
| 建立/撤銷兌換 | — | — | ✓ |
| 設定獎品 | — | — | ✓ |

後端直接省略無權查看的私有欄位，不能先傳回資料再由畫面隱藏。

### 1.5 畫面文案與互動規則

- 使用「總積分」「可兌換積分」「目標獎品」「72/120 分」。
- 移除「持續累積中」「每次讀經，都往前一點」及「還差幾分」。
- 文字說明只保留操作必要資訊，例如「超過補登期限」「好友碼已過期」。
- 按鈕及可點控制項至少 48 dp。
- 私有區塊無權限時整段移除，不留空白占位。
- 圖表使用實際資料；正式版本不帶示例點數或示例獎品。
- 沒有獎品目標時顯示「選擇獎品」；沒有可選獎品時顯示「尚未設定獎品」。
- 不把 API error code、資料表名稱或開發狀態放入使用者畫面。

## 2. 領域模型、資料結構與計算規則

### 2.1 共通格式

| 類型 | 格式 |
|---|---|
| 會員及操作 ID | UUID |
| 讀經日期 | `YYYY-MM-DD`，語意時區為 `Asia/Taipei` |
| 月份 | `YYYY-MM` |
| 新增系統時間欄位 | UTC epoch milliseconds |
| 點數 | 非負整數；帳本異動量可為正負整數 |
| API 欄位 | 新 API 使用 camelCase；既有相容 API 保留原欄位 |
| 帳戶識別 | 經後端驗證的 Google `provider + subject`，映射到 member ID |

不能使用顯示名稱、前端傳入的 Email 或 `isAdmin` 判定管理權限。

### 2.2 既有資料保留策略

保留：

- `members`
- `identity_bindings`
- `auth_sessions`
- `completions`
- `point_events`
- `operations`
- 讀經提醒設定
- 本機每帳號的譯本與字體偏好

舊小組資料不轉成好友。

既有 `members.group_id` 保留為相容欄位，不再參與權限或積分計算。新會員使用唯一的相容值 `unassigned:<memberId>`，避免未分組會員因共用 group ID 而互相看到資料。

不為這次功能移除重建會員表或更換 member ID。

### 2.3 新增資料結構

#### A. `reading_days`

統一讀經排程來源。

| 欄位 | 說明 |
|---|---|
| `task_date` | 主鍵，同一天只有一份有效每日進度 |
| `plan_id` | 原始讀經表識別 |
| `references_json` | 當日經文引用陣列 |
| `source_revision` | 來源版本 |
| `source_digest` | 來源內容雜湊 |
| `updated_at` | 更新時間 |

規則：

- 匯入既有九月資料，保留原 plan ID。
- 不自行新增未排定日期。
- 同一天出現多份衝突排程時拒絕匯入。
- 已有完成紀錄的日期不可任意更換 plan ID。
- 經文引用修正不會讓同一天重新取得積分。
- 本次不新增讀經表管理畫面，沿用現有來源更新流程。

#### B. `daily_point_entitlements`

表示某會員某一天目前有效的讀經得分。

| 欄位 | 說明 |
|---|---|
| `member_id`、`task_date` | 複合主鍵，防止同日跨 plan 重複得分 |
| `plan_id` | 對應完成紀錄 |
| `amount` | 該份權益的固定點數 |
| `active` | 是否有效 |
| `completion_revision` | 對應完成版本 |
| `source_policy_version` | 新制或舊資料來源政策 |
| `first_awarded_at` | 新制首次確認給分時間；舊資料不可偽造 |
| `updated_at` | 最後更新時間 |
| `migration_id` | 舊資料開帳時填入 |

新制 `amount=1`。既有合法舊額度按遷移結果保留，不重新乘上新制點數。

#### C. `wallet_entries`

可兌換餘額的不可覆寫異動帳本。

| 欄位 | 說明 |
|---|---|
| `entry_id` | 主鍵 |
| `member_id` | 點數歸屬會員 |
| `kind` | 異動種類 |
| `delta` | 正負異動量，不可為零 |
| `task_date` | 讀經異動時填入 |
| `redemption_id` | 兌換異動時填入 |
| `operation_id` | 操作追蹤 |
| `created_at` | 寫入時間 |
| `migration_id` | 舊資料開帳時填入 |

`kind`：

- `LEGACY_OPENING_CREDIT`
- `READING_CREDIT`
- `READING_REVERSAL`
- `REDEMPTION_DEBIT`
- `REDEMPTION_REVERSAL`

不直接修改或刪除已成立的帳本列；更正使用對應反向異動。

#### D. `rewards`

| 欄位 | 說明 |
|---|---|
| `reward_id` | 主鍵 |
| `name` | 獎品名称 |
| `cost_points` | 正整數 |
| `active` | 是否可選及兌換 |
| `revision` | 樂觀鎖版本 |
| `created_at`、`updated_at` | 時間 |
| `updated_by` | 管理者 member ID |

下架使用 `active=false`，不刪除歷史獎品。

#### E. `reward_targets`

| 欄位 | 說明 |
|---|---|
| `member_id` | 主鍵，每人一個目前目標 |
| `reward_id` | 目標獎品 |
| `updated_at` | 更新時間 |

目標下架後保留原選擇供顯示，但要求本人重新選擇；不能偷偷替換成其他獎品。

#### F. `redemptions`

| 欄位 | 說明 |
|---|---|
| `redemption_id` | 主鍵 |
| `member_id` | 領取學生 |
| `reward_id` | 獎品識別 |
| `reward_name_snapshot` | 交付當時名稱 |
| `cost_points_snapshot` | 實際扣點 |
| `reward_revision` | 確認時的目錄版本 |
| `status` | `COMPLETED` 或 `REVERSED` |
| `confirmed_by`、`confirmed_at` | 交付確認者及時間 |
| `reversed_by`、`reversed_at` | 撤銷資訊 |
| `operation_id` | 原始操作 |
| `reversal_operation_id` | 撤銷操作 |

每次操作兌換一份獎品。點數足夠可再次兌換，不設每季次數上限。

#### G. `friend_tokens`

| 欄位 | 說明 |
|---|---|
| `token_hash` | 主鍵，只保存隨機 token 的 SHA-256 |
| `owner_member_id` | 出示 QR 的會員 |
| `created_at` | 簽發時間 |
| `expires_at` | 五分鐘後失效 |
| `revoked_at` | 提前撤銷時間 |

同一個有效 QR 可供不同朋友掃描。它不是登入 token，也不包含 Email。

#### H. `friendships`

| 欄位 | 說明 |
|---|---|
| `member_low`、`member_high` | 依 member ID 固定排序的複合主鍵 |
| `created_at` | 關係建立時間 |
| `created_by` | 掃碼者 |
| `operation_id` | 建立操作 |

一列代表雙向好友，不能分別保存兩個方向而產生單邊狀態。

#### I. `mutation_receipts`

用於新好友及兌換等寫入 API。

| 欄位 | 說明 |
|---|---|
| `actor_member_id`、`operation_id` | 複合主鍵 |
| `operation_type` | 操作類型 |
| `payload_hash` | 綁定實際操作內容 |
| `entity_type`、`entity_id` | 對應資源 |
| `result_json` | 已成立操作的收據 |
| `created_at` | 完成時間 |

相同 ID、相同內容不可再次產生異動；相同 ID、不同內容回傳衝突。

既有完成操作仍保留 `operations` 相容機制。

### 2.4 分數定義

```text
歷來總積分
  = 所有 active 每日得分權益的 amount 合計

某月積分
  = task_date 屬於該月份的 active 權益合計

可兌換積分
  = wallet_entries.delta 合計
```

重要規則：

- 兌換只改可兌換餘額，不降低歷來總積分或月柱狀圖。
- 撤銷讀經完成會撤銷對應得分，因此會修正總積分及原月份。
- 完成→撤銷→再完成，最後仍只有同一天一份有效得分。
- Carry over 不建立新的得分事件；不在跨季時複製餘額。
- 季度以台北時間的曆年季度作統計標籤，但錢包持續存在，不做季度清零工作。

### 2.5 梯隊及完整名次

排行榜計分基礎為歷來總積分，不使用可兌換餘額。

有效梯隊母體：

- 正式環境會員。
- 帳號啟用。
- 歷來總積分大於零。

定義：

```text
N = 有效母體人數
H = 總積分嚴格高於此人的人數

N < 10 或此人總積分 = 0：
  band = null

其他：
  band = min(5, 1 + floor(5 × H / N))
```

- 同分的 `H` 相同，因此同分同梯隊。
- 一般個人頁只取得 `band`，不取得 `H` 或確切名次。
- 管理者完整排名採競賽排名：`rank=H+1`，例如 `1、1、3`。
- 停用及零分會員保留管理查詢能力，但不列入有效梯隊；名次欄顯示「—」。
- 樣本不足時顯示「—」，不產生虛構梯隊。

## 3. API、權限與核心交易流程

### 3.1 共通 API 規則

- 使用 HTTPS。
- 會員身分只從已驗證的 bearer session 取得。
- 新 API 不接受前端指定的 actor 身分。
- 私人 API 回應使用 `Cache-Control: no-store`。
- 新寫入操作都攜帶 UUID `operationId`。
- 網路逾時後重試必須沿用原 operation ID。
- 同一交易內保存業務異動與操作收據。
- 錯誤回應格式：

```ts
interface ApiError {
  error: {
    code: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}
```

前端依 `code` 映射成簡短中文，不直接顯示原始錯誤碼或 stack。

### 3.2 API 清單

| 方法/路徑 | 用途 | 權限 |
|---|---|---|
| `POST /api/session/google` | Google 驗證及建立持續登入 | 有效 Google token |
| `GET /api/me/profile` | 本人資料及能力旗標 | 本人 |
| `GET /api/me/reading-days` | 排程、完成狀態及可補登範圍 | 本人 |
| `PUT /api/me/completions/:planId/:taskDate` | 完成或撤銷 | 本人 |
| `GET /api/points/people?scope=friends|all` | 共用人員清單 | 好友範圍或管理者 |
| `GET /api/points/profiles/:memberId` | 共用個人積分資料 | 本人、好友或管理者 |
| `GET /api/rewards` | 有效獎品目錄 | 已登入會員 |
| `PUT /api/me/reward-target` | 修改本人目標 | 本人 |
| `GET /api/me/redemptions` | 本人領取紀錄 | 本人 |
| `POST /api/friends/qr` | 簽發本人 QR token | 本人 |
| `POST /api/friends/claim` | 掃碼建立雙向好友 | 掃碼者 |
| `DELETE /api/friends/:memberId` | 解除好友 | 關係其中一方 |
| `POST /api/admin/rewards` | 建立獎品 | 管理者 |
| `PATCH /api/admin/rewards/:rewardId` | 修改或下架獎品 | 管理者 |
| `GET /api/admin/redemptions` | 查詢領取紀錄 | 管理者 |
| `POST /api/admin/redemptions` | 確認交付及扣點 | 管理者 |
| `POST /api/admin/redemptions/:id/reverse` | 撤銷及返還點數 | 管理者 |

`reading-days` 查詢採 `from/to`，單次最多 62 天。個人積分查詢採 `anchorMonth`，固定回傳以該月結束的六個月份；不接受未來月份。

V1 人員清單一次回傳輕量資料，前端用 `FlatList` 虛擬化；不把所有人的月圖及私有資料放進名單回應。

### 3.3 共用資料介面

```ts
type ScoreScope = 'me' | 'friends' | 'all';

interface MonthPoints {
  month: string;
  earnedPoints: number;
}

interface PersonListItem {
  memberId: string;
  displayName: string;
  earnedTotal: number;
  rank?: number | null; // 僅管理者 all 範圍
}

interface ScoreProfile {
  memberId: string;
  displayName: string;
  earnedTotal: number;
  band: number | null;
  months: MonthPoints[];

  private?: {
    redeemableBalance: number;
    targetReward: {
      rewardId: string;
      name: string;
      costPoints: number;
      active: boolean;
      revision: number;
    } | null;
  };

  permissions: {
    canEditTarget: boolean;
    canRedeem: boolean;
  };
}

interface ViewerCapabilities {
  canViewAllScores: boolean;
  canManageRewards: boolean;
  canRedeemRewards: boolean;
}
```

投影規則：

- 本人：完整本人資料，可修改本人目標。
- 好友：只回傳公開成績欄位，不回傳 `private`。
- 管理者在 `all` 範圍：可回傳私有區塊及兌換操作權限。
- 不可查看的會員回傳 `404 MEMBER_NOT_ACCESSIBLE`，不回傳任何姓名或分數。
- 一般帳號請求 `scope=all` 回傳 `403 ADMIN_REQUIRED`。

### 3.4 Google 登入流程

1. 驗證 Google token 的 issuer、audience、subject 等既有條件。
2. 查詢 `identity_bindings`。
3. 已存在：沿用 member ID。
4. 不存在：同一交易內建立會員及 Google binding。
5. 既有停用帳號不得因再次登入而重建成新帳號。
6. 建立或沿用既有 `qmd_` 持續裝置 session。
7. 一般使用不再套用一小時登入期限。

不採用「第一個登入者自動成為 admin」。

管理者 Google subject 在部署時由既有已驗證身分設定，保存於私有部署設定，不提交公開 repository。後端每次管理請求都由 member binding 檢查授權。

### 3.5 完成讀經交易

請求沿用既有完成命令及 revision 契約：

```json
{
  "operation_id": "uuid",
  "expected_revision": 3,
  "status": "COMPLETED"
}
```

處理順序：

1. 驗證登入身分及命令格式。
2. 查已存在的 operation。
   - 相同操作已成立：回傳收據或目前衝突狀態，不重新給分。
   - ID 被不同內容重用：回傳 `409 OPERATION_ID_REUSED`。
3. 開始 `BEGIN IMMEDIATE`。
4. 在交易內讀取目前 completion、得分權益及錢包狀態。
5. 核對 `expected_revision`。
6. 驗證日期有實際排程，且在伺服器台北日期的合法窗口內。
7. 依狀態轉換更新 completion 及點數。
8. 保存 operation 收據。
9. Commit；任何一步失敗整筆 rollback。

狀態轉換：

| 原狀態 | 新狀態 | 點數結果 |
|---|---|---|
| 未完成 | 完成 | 建立/啟用每日權益，錢包加該權益點數 |
| 完成 | 完成 | 無新得分 |
| 完成 | 未完成 | 停用每日權益，錢包扣回 |
| 未完成 | 未完成 | 無點數異動 |
| 撤銷後再完成 | 完成 | 恢復原權益，不增加第二份每日權益 |

撤銷若造成餘額小於零：

- 不更新 completion。
- 不寫帳本異動。
- 回傳 `409 POINTS_ALREADY_SPENT`。
- 顯示「這筆積分已用於兌換，請聯絡光佑處理。」

未成功送達伺服器的離線完成，在同步時重新檢查窗口。已過期限不補發分數；舊經文仍可閱讀。

### 3.6 好友 QR 交易

QR payload：

```text
qingmu://friend/add?token=<opaque-token>
```

- Token 使用足夠長度的隨機值；後端只保存 hash。
- 有效五分鐘。
- 我的 QR 畫面可見且剩餘時間不足一分鐘時自動更新。
- Scanner 只接受此 App 支援的格式，不開啟任意 QR 網址。
- 只掃 QR，不要求麥克風或通訊錄權限。

掃碼請求：

```json
{
  "operationId": "uuid",
  "token": "opaque-token"
}
```

交易：

1. 驗證掃碼者已登入。
2. 查 operation receipt。
3. 驗證 token 存在、未撤銷、未過期，且持有人帳號有效。
4. 拒絕自己的 QR。
5. 將兩個 member ID 排成 canonical pair。
6. `INSERT ... ON CONFLICT DO NOTHING` 建立雙向關係。
7. 保存收據並 commit。
8. 成功後直接開啟對方的共用積分頁。

不增加接受邀請或同工核准步驟。

移除好友：

- 刪除該 pair，新的資料請求立即失去權限。
- 撤銷移除者尚有效的 QR token，避免被移除的人用舊 QR 立即重新加入。
- 重送之前的成功 claim 不得重新建立已解除的關係。
- 顯示中的好友資料在下一次刷新或重新進頁時清除；不保存好友資料供離線瀏覽。

### 3.7 現場兌換交易

請求：

```json
{
  "operationId": "uuid",
  "memberId": "recipient-id",
  "rewardId": "reward-id",
  "expectedRewardRevision": 4
}
```

處理：

1. 後端驗證操作者是管理者。
2. 查相同操作是否已成立。
3. 開始交易，重新讀取獎品及學生餘額。
4. 確認獎品仍有效、revision 相符、餘額足夠。
5. 建立 `redemptions`，保存名稱及價格快照。
6. 寫入負數 `REDEMPTION_DEBIT`。
7. 保存收據並 commit。
8. 回傳兌換收據及最新餘額。

前端不可指定實際扣點金額，必須由後端依獎品資料計算。

若請求逾時：

- 顯示「尚未確認，點此重試」。
- 沿用原 operation ID。
- 不能重新建立另一筆交付。
- 未確認操作只保存必要識別及請求資料，綁定該管理者帳號；不保存整份排名。

撤銷兌換：

- 管理者輸入撤銷理由。
- 原子更新狀態及返還原快照點數。
- 一筆兌換只能返還一次。
- 不改歷來讀經所得。
- 已撤銷後重送原兌換操作只回傳該筆目前狀態，不再次扣款。

### 3.8 錯誤對應

| 錯誤 | 畫面行為 |
|---|---|
| `AUTH_REQUIRED/AUTH_INVALID` | 回登入處理 |
| `ADMIN_REQUIRED` | 不開放全部或管理操作 |
| `MEMBER_NOT_ACCESSIBLE` | 清除該人的資料，返回清單 |
| `OUTSIDE_COMPLETION_WINDOW` | 顯示超過補登期限 |
| `UNSCHEDULED_DAY` | 不提供完成得分 |
| `REVISION_CONFLICT` | 讀回最新狀態，不盲目覆寫 |
| `FRIEND_QR_EXPIRED` | 請對方重新開啟 QR |
| `SELF_FRIEND_NOT_ALLOWED` | 顯示這是自己的好友碼 |
| `INSUFFICIENT_POINTS` | 顯示餘額不足，不建立兌換 |
| `REWARD_CHANGED` | 更新獎品資料後重新確認 |
| `OPERATION_ID_REUSED` | 停止重送，記錄診斷 |
| 網路逾時 | 保留原 operation ID，提供重試 |

## 4. 原生端實作、快取、預載與相容處理

### 4.1 原生套件

維持 Expo SDK 56 與目前 YouVersion 1.5.0。

依目前 bundled manifest：

- `expo-camera ~56.0.8`
- `expo-local-authentication ~56.0.5`
- 沿用既有 `expo-secure-store` 與 `react-native-svg`

新增 QR 產生與掃描適配層，不在業務元件內自行實作 QR 編碼演算法。

### 4.2 系統生物辨識

原生端設置單一 `AdminUnlockGuard`：

```text
LOCKED → AUTHENTICATING → UNLOCKED
                    ↘ CANCELLED/FAILED → LOCKED
```

規則：

- 只有後端已授予管理能力的帳號能啟動此流程。
- 驗證成功後才請求「全部」名單或進入其受保護內容。
- 取消、未設定、不支援或失敗都不放行。
- 不建立共用密碼輸入框或自訂永久封鎖流程。
- 離開管理範圍、App 進入背景、登出或切換帳號後清除解鎖狀態。
- 排名資料不寫入永久快取。
- Pixel 使用指紋作實機验收；系統可接受的生物辨識方式依平台強度設定處理，不冒稱只能接受特定感測器。

後端 Google 身分授權與原生生物辨識是兩個不同邊界。不得用 `biometricsPassed=true` 或 `isAdmin=true` 之類前端參數取得管理權限。

### 4.3 前端資料生命週期

- 請求鍵包含登入 member ID、scope、查看對象及月份範圍。
- 切換帳號後，舊回應不得更新新帳號畫面。
- 進入頁面、回到前景及下拉刷新時重新查詢。
- 好友與全部名單不作跨登入的永久儲存。
- 本人離線完成先顯示待同步，不把未確認點數當成可兌換餘額。
- 操作完成後刷新受影響資料：
  - 完成讀經：本人總分、月圖、餘額、梯隊。
  - 選獎品：本人私有區塊。
  - 兌換：學生餘額及領取紀錄。
  - 加/刪好友：好友名單及該對象權限。
- 不因兌換重新改寫月積分或總積分。

### 4.4 經文快取

只對成功且可供 SDK 儲存的公開 Bible JSON 回應：

```http
Cache-Control: public, max-age=1800
```

保留：

- 版本、章節身分核對。
- 原文、合併節號、註腳及版權資訊。
- 失敗回應的 `no-store`。
- 所有會員、好友、排名及兌換回應的 `no-store`。

不單純刪除 `Cache-Control`；SDK 在缺少有效設定時有自己的預設保存期限，必須明訂 30 分鐘。

快取鍵沿用 SDK 的 API host、版本及完整 request path/query，避免不同譯本或不同內容選項共用錯誤內容。

### 4.5 預載

預載來源必須進入閱讀器实际使用的 native content store。

觸發條件：

1. 首頁已顯示。
2. 登入/偏好狀態已確定。
3. 已取得選定日期的排程。
4. 目前譯本有效。

策略：

- 目前要讀的章節優先。
- 背景最多兩個請求。
- 預載當日所有引用到的章節，不預載全部譯本或整本聖經。
- 日期或譯本改變後停止舊佇列；旧回應不得切換目前畫面。
- 閱讀器與預載使用同一個 `fetchBibleContent` 適配層及相同請求鍵。
- 相同正在進行的請求合併，避免預載與點擊同時重抓。
- 預載失敗不彈出打斷讀經的訊息；點開時仍可正常重新請求。
- 既有音訊查詢及串流不改為批次下載錄音。

使用 SDK internal context 的部分集中在一個適配模組，並以 1.5.0 的實際 request shape 做契約測試，不能散落在各頁面。

### 4.6 音訊工具列穩定性

`ChapterAudioControls` 的外框始終為：

```text
width: 48 dp
height: 48 dp
flexShrink: 0
```

涵蓋未 focus、查詢中、可播放、暫停、重試及無錄音狀態。

| 狀態 | 顯示 |
|---|---|
| 未 focus | 保留空槽位，不進入無障礙焦點 |
| 尚未取得來源 | 固定槽位內的 loading 圖示 |
| 可播放 | 播放按鈕 |
| 播放中 | 暫停按鈕 |
| 可重試錯誤 | 重試按鈕 |
| 明確無錄音 | 無錄音圖示及正確無障礙標籤 |

- 正常查詢不顯示「正在取得本章語音」。
- 保留既有播放、暫停、來源更新及 EOF 重播機制。
- 背景音訊查詢失敗不推動或遮擋經文。
- 使用者操作播放失敗時，以不參與工具列布局的短提示呈現。
- 狀態改變不得改變章節按鈕及更多按鈕的位置或工具列高度。

### 4.7 舊入口與提醒

- 移除小組頁、群體進度卡、LINE/通話連結及聚會設定。
- 關閉聚會提醒排程及發送，取消本 App 已排程的聚會通知。
- 保留每日讀經提醒及原設定。
- 舊聚會通知或小組深連結被點擊時，導向讀經入口，不重新開啟已移除功能。
- 舊 group/progress API 不再回傳其他小組成員資料。
- 舊版 App 的個人讀經及登入可維持相容，但新增好友/兌獎功能必須使用新版。

## 5. 遷移、驗證、派工與交付控制

### 5.1 唯一來源與整合方式

- 從公開 repo `c89b6d8` 建立隔離分支。
- 公開原始碼為本波實作來源。
- 既有建置目錄及正式後端存在差異，先列出必要保留項再做差異整合。
- 不從 `qm-ux` 整包覆蓋正式後端。
- 私有資料庫、Google 設定、FCM 設定、簽章及憑證不進公開 repo。
- 不為此次工作新增另一套後台或監督框架。

### 5.2 舊積分開帳演算法

目前舊系統沒有完整的歷年政策及每次發點金額紀錄，因此新總積分的開帳定義為：

> 遷移當下能核對成立的有效舊積分，加上切換後的新得分。

不能把所有歷史 `COMPLETED` 次數當成曾授予點數，也不能用曾出現過的最高總分開帳。

步驟：

1. 暫停舊版發點 writer，取得一致性資料庫快照。
2. 記錄來源版本、schema/data digest、有效政策 tuple 及切換時間。
3. 以 `point_event.event_id` 對應 `operation.operation_id`。
4. 驗證 operation 內的 member、plan、date、status、revision。
5. 用結構化欄位重新組合 completion key，不使用冒號字串切割推測 member ID。
6. 依同一 completion 的 revision 排序，判定最後有效授點事件。
7. `COMPLETED` 對應已確認的舊點數；其他狀態為零。
8. 沒有授點事件的完成紀錄不自動補發。
9. 每個正額權益建立一次 opening credit，原日期作月桶依據。
10. 同一交易內寫入 migration receipt。
11. 比對每位會員開帳總分及餘額，與凍結舊服務的有效計算一致後才提交。

不把匯入時間偽裝成原始得分時間。

以下情況停止遷移並保留診斷，不自行猜測：

- 缺少可核對的 operation。
- 相同 completion/revision 出現衝突。
- 無法證明適用的舊政策或 rate。
- 同一會員同一天有跨 plan 多筆正額，與新唯一性衝突。
- 重建後的舊額度與凍結服務結果不一致。
- migration ID 已存在，但來源 digest 不同。

遷移重跑必須是 no-op，不重複開帳。不得追溯套用新的回補期限扣掉合法舊積分。

### 5.3 測試與验收

| 測試群組 | 必須涵蓋 |
|---|---|
| 身分 | 首次 Google 建會員、既有 member ID 保留、停用帳號不重建、持續登入不變 |
| 權限 | 本人/好友/admin 資料裁切；偽造 scope/member ID/admin 旗標無法越權 |
| 好友 | 掃碼即雙向成立、重掃、自掃、過期、撤銷、移除後舊 claim 不復活 |
| 完成 | 新完成、重按、撤銷、再完成、revision 衝突、同日跨 plan 不重領 |
| 回補 | 今天、前 6 天、前 7 天、未來日、未排定日、跨月跨年及台北午夜 |
| 離線 | 待同步不增加可用餘額；過期 outbox 拒絕；已成功操作跨截止日重送不重領 |
| 統計 | 月桶按 task date、總分一致、撤銷修正、兌獎及 carry over 不重算所得 |
| 梯隊 | 人數不足、零分、同分、邊界比例、停用帳號、一般 API 無精確名次 |
| 兌換 | 多次兌換、餘額不足、獎品下架/改價、重按、並行扣款、撤銷只返還一次 |
| UI | 同一清單/個人頁元件、私有區塊裁切、空/錯誤狀態、48 dp、無水平溢出 |
| 生物辨識 | 成功、取消、失敗、未設定、背景重新解鎖、帳號切換 |
| 閱讀器 | 五譯本、原故障章節、合併節號、字體/譯本記憶及音訊回歸 |
| 效能 | 預載命中、本機快取命中、期限到期、失敗不快取、譯本/日期切換及請求去重 |
| 遷移 | 開帳一致、重跑不重複、壞資料停止、session/提醒/偏好保留 |

實機證據要求：

- 好友使用兩個獨立帳號驗證雙向關係。
- 指紋成功驗證使用實際裝置，不以 mock 成功代替。
- 五譯本選章實際顯示。
- 錄製首次開章及切章，核對 loading/ready 時章節按鈕位置相同。
- 比較同一 Pixel、相同網路與章節的點擊至首段可見時間。
- 證明預載命中時不再對該 passage 發出新網路請求。
- 不能只因 API 200 或單元測試通過，就宣稱手機結果通過。

測試採變更相關的 focused pack。修正後重跑受影響證據，不無條件反覆跑整套測試。

### 5.4 派工與防止範圍偏移

每個工作包都必須具備：

- 對應的 CL 編號。
- 允許修改的子系統。
- 明確輸入、輸出與驗收條件。
- 不得碰觸的資料及功能。
- 完成時的 diff、測試結果及限制。

模型使用原則：

- 有完整契約的 UI、文件及測試整理，優先使用低成本模型。
- 預設先以 Luna 處理足夠明確的 bounded task。
- 權限、帳本、遷移等修改由我審查；若低成本模型無法通過既定驗收，再針對該工作包升級。
- 不因單一工作卡住，就把所有子任務全部升級。
- 更換 session 時傳遞精簡工作包與證據，不重新讀完整長對話。

執行時的判斷規則：

| 發現的問題 | 處理方式 |
|---|---|
| 直接阻擋這 12 項驗收 | 找原因、修正、繼續 |
| 非本次範圍的 minor issue | 記錄後跳過 |
| 想增加新功能或新管理流程 | 不自行加入 |
| 想改已正常的第三方播放/閱讀架構 | 必須證明是本次問題的必要修正 |
| 相同問題反覆失敗 | 停止重試，由我核對最早出錯邊界及重新分派 |
| 出現資料或權限一致性問題 | 停止發布，不能用 UI 隱藏掩蓋 |

本波不新增聊天、RPG、活動管理、社群動態或通用後台。

### 5.5 發布與回復

順序：

1. 完成 schema、權限、交易及遷移演練。
2. 完成共用 UI、好友與兌換。
3. 完成原生掃碼、指紋、快取/預載及音訊槽位。
4. 凍結同一個整合候選。
5. 執行對應測試與實機验收。
6. 備份正式資料，執行可核對的遷移。
7. 部署後端並建置正式簽章 APK。
8. 核對建置輸入、APK 雜湊、簽章及實際安裝檔。
9. 更新 GitHub 原始碼、release notes 與公開下載連結。

回復原則：

- 尚未接受新制寫入前，可回復成匹配的舊程式與資料快照。
- 已接受新好友、得分或兌換後，不直接還原舊快照丟掉新資料；先停止相關寫入，再修復或前向部署。
- 任何回復都保留已成立兌換及積分帳本。

最終交付收據需包含：

- 原始碼 commit。
- 遷移 ID 與核對結果。
- 測試及實機验收摘要。
- APK SHA-256 與簽章。
- 安裝版本核對。
- 公開下載連結。
- 真實尚未完成事項。

**完成的判準是同一版本的 App、後端、資料及實機結果一致；規格、mock、build 成功或子任務回報本身都不算交付完成。**
