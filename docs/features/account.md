# 帳戶、登入與 App 更新提示

> 狀態：已上線（0.5.21）｜平台：Android、iOS（差異見「平台差異」）｜依據：main 1e00ca5 的程式碼，2026-09-30 核對

## 一句話

用 Google 帳號登入建立或找回身份，帳戶頁能看到自己的資料、調整讀經提醒、登出或申請刪除資料；App 開機或回到前景時會順便檢查有沒有新版本可以更新（目前只有 Android 會被提醒）。

## 從哪裡進

- 還沒登入、或登入過期時：`app/sign-in.tsx`（`src/ui/SignInScreen.tsx`）。整個 App 在路由層就被鎖住——`src/ui/AppStack.tsx` 用 `Stack.Protected` 把 `(tabs)`、`account` 都鎖在「已登入」條件下，只要不是已登入（或正在還原登入狀態），只有 `sign-in` 這條路可以進。
- 已登入時：多個分頁工具列右上角的圓形帳戶圖示（`src/ui/AccountEntryButton.tsx`，例如公告分頁、讀經精讀器、日記分頁），按下進入 `app/account.tsx`（`src/ui/accountSurfaceComponent.tsx`）。
- App 更新提示：不用進任何分頁，App 一啟動、或從背景回到前景時就會自己彈出（`src/ui/UpdatePrompt.tsx`，在 `app/_layout.tsx` 最外層渲染，蓋在包括登入畫面之上）。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| Google 登入 | 一個「用 Google 登入」大按鈕；第一次登入自動建立帳號 |
| 帳號啟用碼（備援路徑） | 伺服器認不出這個 Google 身份時，改顯示「輸入一次性啟用碼」欄位 |
| 帳戶頁 | 頭像或姓名字首圖示、姓名、所屬小組名稱、讀經提醒設定、登出、申請刪除帳號與資料 |
| 登出 | 一個按鈕，清掉本機登入狀態並讓裝置端 session 失效 |
| App 更新全螢幕提示 | 開機/回前景時蓋在畫面上的卡片：版本號、更新按鈕、（非強制時）稍後按鈕 |
| 公告分頁常駐更新卡片 | 手機落後時公告分頁最上方一直顯示，直到更新完成 |
| 讀經分頁一行更新提示 | 讀經精讀器的更多工具面板裡一行可關掉的提示 |

## 行為規格

### Google 登入（`src/ui/GoogleLoginCard.tsx`、`src/services/googleNative.ts`、`src/services/apiClient.ts`、`server/routes.ts`）

- 沒有設定 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_CLIENT_ID` 時，畫面顯示「正式登入尚未連接」，不出現登入按鈕；設了測試旗標 `EXPO_PUBLIC_QINGMU_FIXTURE=true` 時則顯示「目前是測試身份」，兩者都不會呼叫 Google。
- 正常路徑：呼叫 `react-native-nitro-google-signin`（`GoogleOneTapSignIn`）取得 Google ID token，中途沒有存好的憑證會自動改試「建立帳號」再改「明確登入」；使用者取消時顯示「你取消了登入。」，裝置沒有 Google Play 服務時顯示「這台裝置沒有可用的Google服務。」，其他失敗一律顯示「登入沒有完成，請稍後再試。」。
- 拿到 ID token 後呼叫 `POST /api/session/google`（帶 `persistentDevice: true`，即 `session_type: 'device'`）。目前正式環境的組態（`googleAudience` 已設定且沒有 `fixtureToken`）會把 `autoProvisionGoogleMembers` 設成 `true`（`server/http.ts`），所以**新的 Google 身份第一次登入就會自動建立會員**，不會走到下面的啟用碼畫面——這與 `SignInScreen.tsx` 上寫的「第一次登入會自動建立帳號」一致。
- 伺服器仍可能回 `UNKNOWN_MEMBER`（例如自動建立帳號被關掉的組態）：這時畫面切到「這個Google身份尚未完成帳戶啟用，請輸入同工提供的一次性啟用碼。」，輸入框送到 `POST /api/onboarding/claim`（`server/membership.ts` 的 `claimMemberInvite`）。啟用碼綁定規則：碼不存在或雜湊比不到 → 拒絕；碼已用過 → 拒絕；已過期 → 拒絕；碼對應的會員資料跟現有紀錄衝突 → 拒絕；同一個 Google 身份重複送同一支已綁定的碼 → 視為成功（`alreadyBound: true`），不會重複建立會員或報錯。
- 帳號被停用（`disabled_at` 有值）時，無論走哪條路徑都回 403 `ACCOUNT_DISABLED`；client 端目前把它與其他失敗一起顯示成「伺服器沒有確認身份，請稍後再試。」（沒有專屬文案）。

### 登入狀態的保存、過期與跨帳號切換（`src/services/authSession.ts`）

- 登入成功後的憑證存在 `expo-secure-store`（加密），下次開 App 會自動還原，不用重新登入；每個帳號用自己的一組儲存 key（`storageOwner`），换帳號登入不會讓舊帳號的快取資料混進來。
- 一般（非裝置）session 有到期時間（伺服器目前給 3600 秒），到期後狀態變成「登入狀態已過期」，帳戶頁顯示「登入狀態已過期」並要求重新用 Google 登入；勾了「保持裝置登入」（`session_type: 'device'`）取得的裝置 session 沒有到期時間，只有登出或伺服器主動撤銷才會失效。
- 個人資料（姓名、頭像、小組）另外非同步載入，有自己的四種狀態：載入中/成功/「載入完成但沒有東西」/「載入失敗」；帳戶頁分別顯示「正在載入帳戶資料」「（成功後顯示資料）」「尚未取得帳戶資料」「暫時無法載入帳戶資料」，後兩種都有「重試載入」按鈕（`src/ui/accountSurface.ts`）。
- 一個已經失效的裝置憑證會被記進本機「待撤銷」清單，等下次連上網路時背景送給伺服器撤銷，不會卡住當下的登入或切換帳號動作。

### 帳戶頁（`src/ui/accountSurfaceComponent.tsx`）

- 已登入且個人資料載入成功時：顯示頭像（`avatarUrl` 有值才顯示圖片，否則顯示姓名字首的圓形字母）、姓名、登出按鈕、讀經提醒設定、申請刪除帳號與資料的連結。
- 帳戶入口圖示（`AccountEntryButton`）同一套規則：有頭像顯示頭像，否則顯示姓名字首；**資料還沒回來之前一律顯示中性的「人」字**，不會用 memberId 拼出字母（避免顯示像 `google:1234567` 的 `1` 這種假身份）。
- 讀經提醒：帳戶頁只顯示「讀經提醒」開關與時間，**不顯示「聚會提醒」**（`showMeeting={false}`）；程式註解明確寫「正式帳戶頁停用已退役的聚會提醒」——這與「小組」分頁已退役一致（見「已知限制與待辦」）。提醒設定本身的完整規則不在本文件範圍。
- 「申請刪除帳號與資料」連到本 repo 的 `docs/play/privacy-policy.md` 對應章節（`ACCOUNT_DELETION_URL`），兩個平台都顯示同一份文案，不是只給 Android 看的說法。

### 登出（`clearAuthSession`、`POST /api/session/revoke`）

- 按「登出」立刻清掉本機的登入狀態（畫面馬上回到登入畫面），並且非同步呼叫伺服器撤銷這個裝置的 session；伺服器端撤銷是「精確比對這個 token」，不看用戶端自稱的會員或裝置 ID（`server/mobileSessions.ts` 的 `revokeSession`）。
- 撤銷請求即使因為這個憑證已經失效（401/403）而被伺服器拒絕，也算撤銷完成，不會讓佇列卡住重試；只有網路完全打不通才會留著、等下次前景再送一次。

### App 更新提示（`src/services/updateCheck.ts`、`UpdateBanner.tsx`、`UpdateCard.tsx`、`UpdatePrompt.tsx`）

- 只比較「Android 版本代碼」（`versionCode`）：抓 `VERSION_URL` 上發布的版本檔（本 repo 內 `announcements/app-version.json` 就是目前的版本，例如 `versionCode: 44`/`versionName: "0.5.21"`），跟裝置上安裝的版本比大小；比對失敗、逾時（8 秒）、格式不完整都當作「沒有更新」，不會出現半吊子的提示。
- 三個地方都讀同一個結果，但呈現方式不同：
  - `UpdatePrompt`：開 App、或從背景回前景時蓋在畫面最上層的全螢幕彈窗（`Modal`），有「更新」（開安裝頁）與「稍後」；`mandatory` 為真的版本沒有「稍後」按鈕。第一次檢查沒抓到（例如手機剛醒來還沒連網）會在 20 秒後自動再檢查一次。
  - `UpdateCard`：公告分頁最上方的常駐卡片，只要手機還落後就一直在，不會因為使用者關掉全螢幕提示就消失（2026-09-27 的產品決定：避免使用者不小心關掉提示後找不到更新入口）。
  - `UpdateBanner`：讀經精讀器（`app/(tabs)/reader.tsx`）更多閱讀工具面板裡的一行提示，可以按「稍後」關掉本次顯示。
- **只有 Android 會看到任何更新提示**：`fetchUpdateState` 一開頭就檢查 `Platform.OS !== 'android'`，是的話直接回「沒有更新」且**不發任何網路請求**——這是為了符合 App Store 2.5.2（不能引導使用者去裝會改變功能的安裝檔）；iOS 交給 App Store 自己的自動更新。

## 決定（為什麼這樣做）

**刻意不做：**

- **不提供「用 Apple 登入」**：這是要上 App Store 才需要補的（Apple 規則 4.8 要求同等的替代登入方式），已規劃在 iOS 移植計畫的 Phase 2/M6，不是這次漏做。（來源：[../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) §1 第 5 項、M6）
- **iOS 完全不顯示 App 更新提示，也不會為了檢查版本發出任何網路請求**：Android 才需要側載安裝檔更新；引導使用者去裝安裝檔在 iOS 上會違反 App Store 審查規則 2.5.2。（來源：[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 2 點）
- **不收集 Email、密碼，只存 Google 帳號給的識別碼**；也不收集位置、通訊錄、相片影片、廣告識別碼，沒有廣告或使用行為分析工具。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)）

- **Google 登入第一次找不到對應帳號時會自動建立會員**，不用先請維護者手動開帳號；但「誰是管理者」不會因為誰先登入就自動取得——管理者身分是維護者在私有部署設定裡另外指定的，不會進公開原始碼。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §3.4）
- **申請刪除帳號與資料，兩個平台顯示同一份文案**，走「App 內連結＋寄信」兩條路，不是只給 Android 看的說法，也沒有另外做一個線上申請系統。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)「刪除帳號與資料」）

**待確認（沒有記錄，請維護者確認是否刻意）：**

- 公告分頁的更新卡片不會因為關閉全螢幕更新提示而跟著消失：規格裡記著「2026-09-27 的產品決定」，但沒有找到對應的 design/plan 文件記錄原因。
- `avatarUrl` 目前一律回傳 `null`，帳戶相關畫面因此顯示不出 Google 頭像：這是刻意的隱私決定，還是還沒接上的功能，沒有找到記錄。

## 平台差異

- 更新提示：iOS 完全不出現（見上），這一點有 iOS 自動化流程 `.maestro/ios/40-no-update-prompt.yaml` 專門驗證「等過 20 秒重試視窗仍然看不到『有新版本』字樣」。
- Google 登入的 iOS 現況：iOS 建置要在建置時提供 `EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE` 或 `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`，才會裝上 Google 登入外掛；兩個都沒有時，`app.config.js` 會把外掛拿掉。`plugins/withGoogleSignInPods.js` 只是讓這種建置也能通過 `pod install`（避免 `AppCheckCore`/`GoogleUtilities` 缺 modular header），不是登入設定。依照 `docs/superpowers/plans/2026-09-29-ios-parity.md`（Task 1）與 `2026-09-29-ios-parity-phase1-implementation.md`（「Google iOS 登入、用 Apple 登入⋯屬於 Phase 2」），這塊排在目前 iOS 移植範圍（Phase 1，M0–M5）之外；iPhone 上的實際 Google 登入還沒驗證過。
- 通知權限：登入後如果讀經提醒是開的，App 會要求通知權限，兩個平台行為一致（`AGENTS.md`）。

## 資料與後端

- 認證相關 API（`server/routes.ts`）：`POST /api/session/google`（用 Google ID token 換 session，可選 `session_type: 'device'`）、`POST /api/onboarding/claim`（用啟用碼綁定身份並換 session）、`POST /api/session/device`（把一般 session 升級成不過期的裝置 session）、`POST /api/session/revoke`（撤銷裝置 session 或標記舊版 session 撤銷）、`GET /api/me/profile`（姓名/小組/能力）。
- 伺服器目前對 `/api/me/profile` 的 `avatarUrl` **一律回傳 `null`**（`server/routes.ts` 的 `/api/me/profile` 處理），所以帳戶頁與帳戶入口圖示的「顯示 Google 頭像圖片」那條分支目前實際上不會被觸發，畫面一定顯示姓名字首的圓形字母。
- 向下相容：`server/authBoundary.ts` 的 `authenticateSessionOrGoogle` 同時接受三種 Bearer token 格式——新式裝置 session（`qmd_` 開頭）、舊式簽名 session（`qms_` 開頭，可能已被登出動作標記撤銷）、以及直接送 Google ID token；舊版已安裝的 App 換到新後端不會被擋。
- App 更新檢查同時保留兩個網址：`VERSION_URL`（現在的公開安裝頁）與 `LEGACY_VERSION_URL`（0.5.4–0.5.15 讀的 GitHub 網址），兩份內容需同步發布，讓還沒更新到能讀新網址的舊版 App 也能收到更新通知。
- 帳號資料表：`members`（含 `disabled_at`）、`identity_bindings`（Google subject↔會員）、`member_invites`（啟用碼）、`auth_sessions`（裝置/舊式撤銷紀錄）；schema 建立在 `server/mobileSessions.ts` 的 `ensureMobileSessionSchema`。

## 守住它的測試

- `tests/ui/signInScreen.test.ts` — 第一個登入畫面文案與唯一的登入動作。
- `tests/ui/googleLoginWelcome.test.ts` — 歡迎版登入按鈕的樣式與一般卡片版本一致。
- `tests/server/onboarding.test.ts` — 未知 Google 身份先被拒絕、再用有效期限內的啟用碼完成綁定、過期或用過的碼被拒絕。
- `tests/services/authSession.test.ts`、`tests/services/authSessionHydration.test.ts`、`tests/services/authSessionRace.test.ts` — 登入狀態的邊界（session 綁定、還原流程、多個非同步動作同時發生時不互相踩）。
- `tests/mobileSessionServer.test.ts` — 裝置 session 的建立、撤銷、與舊式登入相容。
- `tests/server/session.test.ts`、`tests/server/authBoundary.test.ts` — 簽名 session token 的產生/驗證、正式 Google 驗證與開發測試 token 兩種認證模式的邊界。
- `tests/services/googleVerifier.test.ts` — Google ID token 的簽章、發行者、audience、過期檢查。
- `tests/ui/accountSurface.test.ts`、`tests/ui/accountProfileRecovery.test.ts` — 帳戶頁在已登入/過期/載入中/載入失敗/載入完成但空各種狀態下顯示什麼。
- `tests/ui/accountDeletionEntry.test.ts` — 已登入時能打開刪除帳號與資料的說明頁。
- `tests/ui/accountReminderPatch.test.ts` — 帳戶頁的提醒設定只送出真的被改動的欄位。
- `tests/updateCheck.test.ts` — 版本比對規則、非 Android 平台完全不檢查。
- `tests/ui/updatePrompt.test.ts` — 全螢幕提示的開啟/稍後/回前景重問、以及公告卡片的顯示條件。
- `.maestro/ios/40-no-update-prompt.yaml` — 真機層級驗證 iOS 完全看不到更新視窗。

## 相關文件

- [announcements.md](announcements.md) — 公告分頁上的常駐更新卡片，以及「先登入才能看到公告分頁」的路由規則。
- [../play/privacy-policy.md](../play/privacy-policy.md) — 「申請刪除帳號與資料」連結的內容。
- [../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) — iOS 加「用 Apple 登入」、更新提示改法的規劃（Task 1、14、16）。
- [../superpowers/plans/2026-09-29-ios-parity-phase1-implementation.md](../superpowers/plans/2026-09-29-ios-parity-phase1-implementation.md) — 已合併的 M0–M5 範圍界定（Google/Apple iOS 登入排在 Phase 2）。

## 已知限制與待辦

- iOS 的「用 Apple 登入」（App Store 審核規則 4.8：用 Google 登入當主要登入方式時必須提供對等的替代方案）尚未實作，規劃在上述 iOS 移植計畫的 Phase 2/M6，目前程式碼裡完全沒有 Apple 登入相關程式。
- iOS 的 Google 登入設定本身也還沒補上（見「平台差異」），`plugins/withGoogleSignInPods.js` 只解決建置失敗，不是可用的登入設定。
- `src/services/googleIdentity.ts`（`createGoogleIdentity`）在正式程式碼裡沒有任何地方呼叫，只有它自己的測試 `tests/services/identityBoundary.test.ts` 在用；實際登入走的是 `src/services/googleNative.ts` 的 `obtainGoogleIdToken`，這支檔案疑似是被取代後留下的舊程式碼。
- 帳戶頁隱藏的「聚會提醒」（`showMeeting={false}`）與 `server/reminders.ts`、`server/meetingSchedules.ts` 裡仍指向 `/groups` 的提醒路由，都是「小組」（RPG）分頁退役後留下的殘跡：`app/(tabs)/groups.tsx` 現在只是 `<Redirect href="/(tabs)/today" />`，分頁列也用 `href: null` 藏起來；伺服器端 `server/groups.ts`、`server/importMeetingSchedules.ts` 仍存在，只是為了讓已安裝的舊版 App 呼叫 `/api/me/groups` 時不會壞掉（回應已被清空社群連結與名冕），不是一個可以從目前 UI 進入的功能。
- `server/routes.ts` 對 `/api/me/profile` 的 `avatarUrl` 目前寫死回傳 `null`（見「資料與後端」），代表帳戶相關畫面上「顯示 Google 頭像」的程式路徑目前無法被觸發；待確認這是刻意的隱私決定還是尚未接上的功能。
