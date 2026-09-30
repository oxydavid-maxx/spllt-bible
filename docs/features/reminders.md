# 讀經提醒與推播

> 狀態：已上線（0.5.21，僅讀經提醒；聚會提醒程式碼仍在但正式版關閉，見下）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

讀經提醒是手機自己排的每日本機通知，提醒還沒完成的讀經任務；點下去會直接打開 App 到那一天的讀經頁。「聚會提醒」的程式碼還在，但正式版的介面和伺服器目前都把它關掉了。

## 從哪裡進

帳戶頁（點右上角帳戶圖示 `AccountEntryButton` 進入 `AccountSurface`）裡的「提醒」卡片（`src/ui/ReminderSettings.tsx`，由 `src/ui/accountSurfaceComponent.tsx:33-42` 掛上）。

## 功能一覽

| 功能 | 使用者看到什麼 |
| --- | --- |
| 讀經提醒開關 | 「提醒」卡片裡「讀經提醒」一列的開關 |
| 提醒時間 | 兩個滾輪（時、分，分以 5 分鐘為一格），放手就生效 |
| 通知權限 | 開啟提醒時系統詢問；被拒絕會顯示提示文字和「開啟系統設定」按鈕 |
| 點提醒通知 | 打開 App，直接跳到通知所指那一天的讀經頁 |
| 完成當天讀經 | 當天的提醒被取消 |
| 登出 | 這支手機的推播裝置登記被撤銷 |

聚會提醒（`meetingEnabled`/`meetingAdvanceMinutes`）的畫面欄位在 `src/ui/ReminderSettings.tsx` 裡還存在，但帳戶頁用 `showMeeting={false}` 一律不顯示（`src/ui/accountSurfaceComponent.tsx:41`），伺服器也可以用環境變數強制關閉（見「已知限制」），所以不列進上表。

## 行為規格

### 開啟與時間設定
- 「讀經提醒」是一列可以點的開關（`accessibilityRole="switch"`），開/關直接送出新的偏好設定（`src/ui/ReminderSettings.tsx:42-45`）。
- 提醒時間用兩個滾輪選時、分（分鐘以 5 分為一格），手放開即送出新時間，沒有另外的「儲存」步驟（`src/ui/TimeWheelPicker.tsx`：模組註解「every settle commits immediately」）。
- 沒有存過設定的會員，讀經提醒預設是開的，時間預設 06:30；曾經存過（即使是關掉）一律照存的值（`server/reminderPreferences.ts:34-48`）。

### 通知權限
- 只有在讀經提醒（或聚會提醒）被打開時才會跳出系統通知權限詢問；兩者都關著就不會問（`src/services/reminderRuntime.ts:219-226`）。
- 會員登入後，如果讀經提醒是開的，也會要求通知權限，兩個平台都一樣（`AGENTS.md` 第 5 點）。
- 拒絕權限：畫面顯示「通知權限被拒絕；其他功能仍可使用」，並出現「開啟系統設定」按鈕，點下去開系統的 App 通知設定頁（`src/ui/reminderSettingsModel.ts:23`；`src/ui/accountSurfaceComponent.tsx:40`）。

### 提醒怎麼排、怎麼取消
- 每次設定變更或重新整理，App 會依讀經排程排出本機通知，最多往後排 60 天（`src/services/reminderScheduler.ts:47` `MAX_PENDING_READING_REMINDERS = 60`）；iOS 系統本身最多能排 64 個本機通知，60 是為了留一點餘裕（`AGENTS.md` 第 10 點）。
- 提醒的觸發時間固定用台北時區換算（`src/services/reminderScheduler.ts:77`：`${taskDate}T${readingTime}:00+08:00`）。
- 那一天的讀經被標記「已完成」後，當天的提醒會被取消；如果又取消完成，提醒會重新排回去（`src/services/reminderCompletion.ts`；`src/services/reminderRuntime.ts:284` 用完成狀態過濾掉已完成的日子）。

### 點提醒之後
- 點下讀經提醒通知，會打開 App 並直接跳到通知所指那一天的讀經頁（`/today`），不會做其他事（`src/services/ReminderNotificationBridge.tsx:38`：`openReadingDate: taskDate => { setSelectedReadingDate(taskDate); router.push('/today'); }`）。
- 待確認：目前程式碼裡沒有找到「在通知上直接標記完成」的動作按鈕或處理邏輯；要標記完成，需要先進 App 再操作。

### 登出與裝置撤銷
- 登出時，這支手機在伺服器登記的推播裝置會被標記撤銷；如果當下撤銷失敗（例如離線），撤銷請求會留在裝置上的佇列裡，等 App 下次回到前景自動重試（`src/services/reminderLifecycle.ts`；`src/services/reminderDeviceRevokeQueue.ts`；`src/services/ReminderNotificationBridge.tsx:19-25`）。
- 讀經提醒本身是本機排定的通知，不需要裝置登記；裝置登記是給 App 內的其他推播用的（例如好友加入通知，見「相關文件」），但只要登入就會盡力嘗試登記一次，登出時一併撤銷（`src/services/reminderRuntime.ts:235-239` 註解）。

### 讀經計畫結束時
- 待確認：程式碼裡沒有找到「計畫結束」的專屬處理。提醒完全依賴伺服器 `/api/me/reading-days` 回傳的排程；沒有更多日子可排時，就沒有更多提醒被建立（`src/services/reminderRuntime.ts:265-278`）。

### 聚會提醒（程式碼仍在，正式版目前關閉）
- 帳戶頁不會顯示「聚會提醒」欄位（`showMeeting={false}`，見上）；伺服器另外可以用環境變數 `QINGMU_DISABLE_MEETING_REMINDERS=true` 強制讓 API 回傳 `meetingEnabled: false, meetings: []`，跟使用者實際存的值無關（`server/routes.ts:351,715,726`）。
- 就算重新打開，聚會提醒目前只會送到 Android 裝置：伺服器尋找待送對象時只查 `platform='ANDROID'` 的裝置登記（`server/remoteReminders.ts:40`）。iOS 的裝置登記雖然可以用 `platform: 'IOS'` 存進資料庫（`server/routes.ts:731`），但聚會提醒的送出邏輯沒有接上 iOS。
- 後端有一個背景 worker（`server/reminderWorker.ts`，每 15 秒一次）會找到期的聚會提醒並透過 FCM 送出，但要環境變數 `QINGMU_REMINDER_WORKER_AUTOSTART=true` 才會啟動（`server/remoteConfiguration.ts:35-44`）。

## 決定（為什麼這樣做）

**刻意不做：**

- **聚會提醒目前不對外開放**：精簡功能時的產品決定，把小組/RPG、LINE、通話與聚會提醒等入口都收起來，主導覽只留讀經、積分；程式碼還留著，只是還沒清乾淨。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL01、§4.7）
- **讀經提醒最多只排 60 則，不是排到系統上限**：iOS 系統本身待發通知有數量上限（常見說法是 64 個），特意留一點餘裕。（來源：[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 10 點）
- **iPhone 的推播一律送「看得到的通知」，不像 Android 那樣用背景資料訊息**：`expo-notifications` 在 iOS 上只把 `userInfo.body` 交給 JS，而且 iOS 對背景資料推播的優先權低、系統可能直接不送達。（來源：[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 9 點；[../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) §1 第 3 項）

- **iPhone 推播由後端直接送 APNs（用現成套件），App 不加裝 Firebase iOS SDK**：避免多裝一套原生 SDK 拖慢啟動、增加安裝檔大小。（來源：[../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) §6 方案 A）
- **舊的聚會通知或小組深連結被點到時，一律導向讀經入口，不會重新打開已經移除的功能**。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §4.7）

## 平台差異

| 項目 | Android | iOS |
| --- | --- | --- |
| 讀經提醒本機通知上限 | 60 篇 | 60 篇（系統本身上限 64） |
| 推播訊息格式 | FCM data-only（`server/fcmSender.ts`） | APNs 可見通知，自訂資料放在 `body` 裡（`server/apnsSender.ts`；`AGENTS.md` 第 9 點） |
| 聚會提醒送達（若重新開啟） | 會送 | 不會送：伺服器只查 Android 裝置登記 |

## 資料與後端

- 使用者偏好設定：`reminder_preferences` 表（讀經開關、時間、聚會提前分鐘數、`preference_generation` 版本號防止舊寫入蓋掉新的）（`server/reminderPreferences.ts`）。
- 裝置推播登記：`device_delivery_tokens` 表，登入時登記 `installationId`＋`token`＋平台，登出時撤銷（`server/reminderPreferences.ts`；端點 `POST /api/me/reminders/device-token`、`POST /api/me/reminders/device-token/revoke`）。
- 使用者端點（需登入）：`GET`/`PUT /api/me/reminders`、`POST /api/me/reminders/device-token[/revoke]`（`server/routes.ts:711-739`）。
- 裝置端點（不需登入 session，只認裝置憑證表頭 `x-qingmu-installation-id`/`x-qingmu-device-token`）：`POST /api/device/reminders/validate`、`POST /api/device/reminders/revoke`（`server/routes.ts:361-387`），用於背景收到聚會推播時二次確認還有效。
- 聚會提醒送達鏈：`server/reminderWorker.ts`（背景輪詢到期事件）→ `server/remoteReminders.ts`（判斷是否該送、避免重送）→ `server/fcmSender.ts` ＋ `server/fcmAuth.ts`（FCM v1 API、用 Google 服務帳號簽章換存取權杖）。iPhone 的可見推播走 `server/apnsSender.ts`（需要 `QINGMU_APNS_KEY_FILE`/`QINGMU_APNS_KEY_ID`/`QINGMU_APNS_TEAM_ID` 才會載入），但目前只有好友加入推播接了它，聚會提醒沒有接上（見上）。
- 待確認/釐清：`server/reminders.ts` 定義了一套幾乎一樣的偏好設定/裝置登記/到期判斷邏輯，但沒有被 `server/routes.ts` 引用，只有它自己的測試 `tests/server/reminders.test.ts` 會呼叫；正式路徑走的是本節列出的 `reminderPreferences.ts`＋`remoteReminders.ts`。

## 守住它的測試

- `tests/services/reminderScheduler.test.ts` — 讀經提醒排程規則：往後最多排幾天、60 篇上限、時間格式。
- `tests/services/reminderRuntime.test.ts` — 整個提醒生命週期（啟動、存偏好、reconcile）串起來的行為。
- `tests/services/reminderLifecycle.test.ts` — 登出/過期時裝置登記與已排通知的清理。
- `tests/services/reminderDelivery.test.ts` — 背景任務收到聚會推播資料的解析與呈現邏輯。
- `tests/services/reminderDevice.test.ts` — 裝置登記/撤銷的持久化與版本比對。
- `tests/services/reminderDeviceRevokeQueue.test.ts` — 撤銷失敗時排隊、下次重試的行為。
- `tests/services/reminderRevokeQueueWiring.test.ts` — 撤銷佇列與登出流程接線是否正確。
- `tests/services/reminderReconciler.test.ts` — 決定哪些提醒要新增/取消/不變的核心比對邏輯。
- `tests/services/reminderCompletion.test.ts` — 完成一天讀經後提醒被取消、取消完成後提醒重新排入。
- `tests/services/reminderNotificationEntry.test.ts` — 點通知後的導向邏輯（讀經頁/好友列表/聚會）與去重。
- `tests/services/reminderExpiryLifetime.test.ts` — 登入過期（非登出）時提醒設定和裝置登記不會被誤清除。
- `tests/services/reminderPreferenceIntents.test.ts` — 連續存多次偏好設定時，只有最新的意圖會真的送出。
- `tests/services/reminderTokenEvents.test.ts` — 推播權杖變動事件觸發的重新登記行為。
- `tests/services/reminderApiClient.test.ts` — 提醒偏好設定與裝置登記的 HTTP 傳輸層。
- `tests/services/configuredReminderHeadless.test.ts` — 背景收到聚會推播時，向伺服器二次驗證是否仍有效。
- `tests/services/configuredReminderHeadlessWiring.test.ts` — 背景任務註冊與驗證函式的接線。
- `tests/services/configuredReminderDeviceRevoke.test.ts` — 撤銷裝置登記的傳輸細節（表頭、逾時、狀態碼對應）。
- `tests/services/completionControllerReminder.test.ts` — 完成/取消完成與提醒排程共用同一個儲存回呼。
- `tests/ui/reminderSettings.test.ts` — 「提醒」卡片文字（權限、遠端狀態、讀取中）依狀態正確顯示。
- `tests/ui/accountReminderPatch.test.ts` — 帳戶頁的開關/時間變更會呼叫對的存檔函式。
- `tests/ui/reminderAuthorityBoundary.test.ts` — 換帳號或過期時，舊帳號的提醒設定不會套用到新帳號。
- `tests/ui/reminderRecoverySurface.test.ts` — 讀取或存檔失敗時的重試按鈕與錯誤訊息。
- `tests/ui/reminderRootEntry.test.ts` — App 啟動時通知回應（冷啟動點擊）的處理入口。
- `tests/baseline/reminderPreferences.ts` — 舊版資料格式的基準測試資料。
- `tests/reminderDeployment.test.ts` — 舊版與新版資料庫並存時，提醒相關端點仍能正常運作。
- `tests/server/reminders.test.ts` — 針對 `server/reminders.ts`（未被正式路由使用，見上）自身的偏好與裝置撤銷邏輯。
- `tests/server/reminderWorker.test.ts` — 背景 worker 用假時鐘找到期事件並送出，不需要真的 HTTP 呼叫。
- `tests/integration/reminderWorkerBackend.test.ts` — worker 與正式後端接起來，在到期時間真的透過注入的傳輸送出。

## 相關文件

- 好友加入的推播通知（`FRIEND_ADDED`）在另一份文件說明：[points.md](points.md)（本文件只連結，不重複描述其行為；本文件的 `ReminderNotificationBridge.tsx`/`reminderNotificationEntry.ts` 也處理這類通知的點擊導向，但內容判讀與呈現規則以 points.md 為準）。
- iOS 特有的通知細節（64 通知上限、APNs 資料放在 `body`、通知權限請求時機）：repo 的 `AGENTS.md` 第 5、9、10 點。

## 已知限制與待辦

- 聚會提醒目前在正式介面（`showMeeting={false}`）與可用時的伺服器環境變數（`QINGMU_DISABLE_MEETING_REMINDERS`）都可以被關閉；就算重新打開，目前的送達邏輯只查 Android 裝置，iOS 收不到。
- 沒有找到「在通知上直接標記完成」的功能；點通知只會打開 App 到當天的讀經頁，完成與否要回到 App 內操作。
- 沒有找到「讀經計畫結束後」提醒的專門處理；提醒完全依賴伺服器回傳的排程長度，計畫外沒有排程就沒有更多提醒。
- `server/reminders.ts` 是一份沒有被正式路由使用的重複邏輯，只被自己的測試引用，不是目前的實際行為來源；如果不打算之後切換過去，可以考慮移除以免之後誤用。
