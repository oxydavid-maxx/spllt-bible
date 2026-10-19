# 帳戶、登入與 App 更新提示

> 狀態：本 PR 候選，尚待正式發布｜平台：Android、iOS (差異見「平台差異」)｜2026-10-17 更新：Apple 登入、App 內刪除、iOS 返回鍵、青少/主堂

## 一句話

用 Google 帳號或 iPhone 的 Apple 登入建立或找回身份，帳戶頁能看到自己的資料、調整讀經提醒、改青少或主堂、登出或永久刪除帳號與伺服器個資；App 開機或回到前景時會順便檢查有沒有新版本可以更新（目前只有 Android 會被提醒）。

## 從哪裡進

- 還沒登入、或登入過期時：`app/sign-in.tsx`（`src/ui/SignInScreen.tsx`）。整個 App 在路由層就被鎖住——`src/ui/AppStack.tsx` 用 `Stack.Protected` 把 `(tabs)`、`account` 都鎖在「已登入」條件下，還原本機登入狀態時，只顯示與原生開機畫面相同的白色背景及 App 圖示，不顯示文字、分頁或登入頁。本機有有效帳號直接進 App，沒有則直接進 `sign-in`；不等待 profile 網路請求，已登入者不會閃過登入頁。
- 已登入時：多個分頁工具列右上角的圓形帳戶圖示（`src/ui/AccountEntryButton.tsx`，例如公告分頁、讀經精讀器、日記分頁），按下進入 `app/account.tsx`（`src/ui/accountSurfaceComponent.tsx`）。
- App 更新提示：不用進任何分頁，App 一啟動、或從背景回到前景時就會自己彈出（`src/ui/UpdatePrompt.tsx`，在 `app/_layout.tsx` 最外層渲染，蓋在包括登入畫面之上）。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| Google 登入 | 一個「用 Google 登入」大按鈕；第一次登入自動建立帳號 |
| Apple 登入 | 只在支援原生 Apple 授權的 iPhone 顯示；首次登入自動建立會員，不以 Email 合併身份 |
| 刪除帳號 | 先說明影響，第二次確認才刪除；失敗可重試，成功自動登出 |
| 帳號啟用碼（備援路徑） | 伺服器認不出這個 Google 身份時，改顯示「輸入一次性啟用碼」欄位 |
| 帳戶頁 | 頭像或姓名字首圖示、姓名、所屬小組名稱、讀經提醒設定、我在哪裡聚會、登出、刪除帳號與資料，最下面一行是 App 版本號 |
| 青少/主堂 | 新會員第一次登入先選「青少」或「主堂」；之後在帳戶頁「我在哪裡聚會」改，改之前先確認 |
| 後台規則與文件 (管理) | 只有管理者看得到：帳戶頁一列「後台規則與文件 管理者 ›」，進去先裝置解鎖，看所有後台規則和後台文件連結 |
| 全體 (管理) 入口 | 只有管理者看得到：刪除連結上面一行淡色的「全體 (管理) ›」，按下到積分頁的全體排名 |
| 登出 | 一個按鈕，清掉本機登入狀態並讓裝置端 session 失效 |
| App 更新全螢幕提示 | 開機/回前景時蓋在畫面上的卡片：版本號、更新按鈕、（非強制時）稍後按鈕 |
| 公告分頁常駐更新卡片 | 手機落後時公告分頁最上方一直顯示，直到更新完成 |
| 讀經分頁一行更新提示 | 讀經精讀器的更多工具面板裡一行可關掉的提示 |

## 行為規格

### Google 登入（`src/ui/GoogleLoginCard.tsx`、`src/services/googleNative.ts`、`src/services/apiClient.ts`、`server/routes.ts`）

- 叫出 Google 選帳號視窗前，先用既有 SecureStore 記下登入進行中與開始時間，不存帳號或 token；成功、取消或失敗 (含伺服器確認失敗) 都清掉記號。重試的新記號不會被舊結果清掉。
- App 重新啟動後，如果還沒登入且記號未滿 10分鐘，登入按鈕上方顯示「剛才的登入沒有完成，請再按一次。」，並清掉記號；按下登入後提示消失。滿 10分鐘、時間異常、記號無效或已登入時只清掉，不提示。逾時只恢復按鈕的流程仍保留記號，直到該次登入結束或重按。
- Android 與 iOS 等待原生 Google 登入結果時，按鈕顯示「正在登入…」並暫時停用。App 從非前景回到前景後等待 10秒，或原生等待滿 60秒仍無結果時，只恢復按鈕並顯示「登入沒有完成，請再按一次。」；這不會結束該次登入。使用者沒有重按時，晚到的 SUCCESS 照常向伺服器確認身份並完成登入，CANCELLED 或失敗照常顯示原本的文字。使用者重按後以新嘗試為準，舊結果不會交換伺服器 session、改變畫面或覆蓋新的登入。收到成功結果開始向伺服器確認身份時，按鈕會再次停用、清掉重試提示，這個階段不套用原生等待期限；正常流程與文字不變。
- 沒有設定 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_CLIENT_ID` 時，畫面顯示「正式登入尚未連接」，不出現登入按鈕；設了測試旗標 `EXPO_PUBLIC_QINGMU_FIXTURE=true` 時則顯示「目前是測試身份」，兩者都不會呼叫 Google。
- 正常路徑：呼叫 `react-native-nitro-google-signin`（`GoogleOneTapSignIn`）取得 Google ID token，按一下只呼叫一次 `presentExplicitSignIn()`，不先呼叫 `signIn()` 或 `createAccount()`；使用者取消時顯示「你取消了登入。」，裝置沒有 Google Play 服務時顯示「這台裝置沒有可用的Google服務。」，其他失敗一律顯示「登入沒有完成，請稍後再試。」。
- 拿到 ID token 後呼叫 `POST /api/session/google`（帶 `persistentDevice: true`，即 `session_type: 'device'`）。目前正式環境的組態（`googleAudience` 已設定且沒有 `fixtureToken`）會把 `autoProvisionGoogleMembers` 設成 `true`（`server/http.ts`），所以**新的 Google 身份第一次登入就會自動建立會員**，不會走到下面的啟用碼畫面——這與 `SignInScreen.tsx` 上寫的「第一次登入會自動建立帳號」一致。
- 伺服器仍可能回 `UNKNOWN_MEMBER`（例如自動建立帳號被關掉的組態）：這時畫面切到「這個Google身份尚未完成帳戶啟用，請輸入同工提供的一次性啟用碼。」，輸入框送到 `POST /api/onboarding/claim`（`server/membership.ts` 的 `claimMemberInvite`）。啟用碼綁定規則：碼不存在或雜湊比不到 → 拒絕；碼已用過 → 拒絕；已過期 → 拒絕；碼對應的會員資料跟現有紀錄衝突 → 拒絕；同一個 Google 身份重複送同一支已綁定的碼 → 視為成功（`alreadyBound: true`），不會重複建立會員或報錯。
- 帳號被停用（`disabled_at` 有值）時，無論走哪條路徑都回 403 `ACCOUNT_DISABLED`；client 端目前把它與其他失敗一起顯示成「伺服器沒有確認身份，請稍後再試。」（沒有專屬文案）。
- Google Play 測試機器人：每次上傳新版到 Play，正式發布前測試報告會在 Firebase Test Lab 的裝置上自己用 Google 登入。Android 在 Google 登入時讀取系統設定 `firebase.test.lab`，只有字串 `"true"` 才在 `POST /api/session/google` 帶 `firebase_test_lab: true`，其他可讀值帶 `false`。iOS 不讀也不帶這個欄位；Android 橋接缺少或讀取失敗時也不帶。新的 Google 身份第一次登入時，只要這個 JSON 欄位是布林 `true`，或連線來自 Google 公布的 Test Lab 位址 (Cloudflare 的 `cf-connecting-ip`，`server/testLabNetwork.ts`)，會員一建立就是停用的，回 403 `ACCOUNT_DISABLED`，不發 session，所以不能讀經、拿分或上排行。另加驗過的 Google ID token email 以 `@cloudtestlabaccounts.com` 結尾 (不分大小寫) 的第三個訊號，三者任一成立即停用；email 不採信 request body，舊版 App 不帶旗標時仍可由網域或 IP 判斷。此網域來自社群回報，尚待下一次 Play 上傳的 log 確認。已經存在的會員不會被這個判斷停用。每建立一個新會員，後端 log 記一行 `AUTO_PROVISION_MEMBER testDevice=<true|false> clientFlag=<absent|true|false|other> emailClaim=<present|missing> testLabEmailDomain=<true|false> testLabAddress=<true|false> clientAddress=<present|missing>`，`testDevice` 是三個訊號任一命中的結果；`clientFlag` 分別表示欄位不存在、布林 true、布林 false、其他型別，`emailClaim` 表示驗過的 token 是否帶 email，`testLabEmailDomain` 與 `testLabAddress` 分別表示網域與 IP 清單是否命中，`clientAddress` 只表示位址是否存在；不記 email、名字、subject、token 或位址本身。

### Apple 登入 (`src/ui/AppleLoginCard.tsx`、`server/appleVerifier.ts`)

- iOS 且系統支援 Apple 授權時才顯示 Apple 原生按鈕；Android 不顯示，也不呼叫 Apple。
- 先向 `POST /api/session/apple/challenge` 取得五分鐘有效、單次使用的 nonce，再交給原生 `signInAsync`。取消不建立帳號；失敗顯示「Apple 登入沒有完成，請稍後再試。」。
- `POST /api/session/apple` 驗 Apple JWKS 的 RS256 簽章、issuer、到期、subject、單一 audience `org.qingmu.youth` 與 nonce；拒絕重放。authorization code 換得的 ID token 必須對上相同 subject，才保存加密 refresh token。
- 首次以 provider/subject 建立會員，Apple 只第一次提供名稱也不影響後續登入；未提供名稱用「竹科聖經會員」。不以 Email 與 Google 身份自動合併。回傳既有 `qmd_` 裝置 session，沿用相同保存/登出生命週期。
- identity token 驗證只使用 Apple 公鑰，不需要私鑰；未設定私鑰仍可驗證登入、建立會員。`QINGMU_APPLE_SIGNIN_KEY_FILE`、`QINGMU_APPLE_SIGNIN_KEY_ID`、`QINGMU_APPLE_SIGNIN_TEAM_ID` 三項齊備時，才交換 authorization code 並加密保存 refresh token，供之後撤銷。私鑰由主管安排，不在 repo 保存，也不得用 ASC API key 代替。

### 永久刪除 (`server/accountDeletion.ts`)

- 帳戶頁點「刪除帳號與資料」只開啟確認畫面，不發刪除請求；顯示主管同意的三句警告，只有「取消」「確認刪除」，沒有日記匯出入口。
- 確認後以當前 Bearer 呼叫 `DELETE /api/me`，必須帶 `confirmed: true`。伺服器只信已驗證 session 的成員，忽略 body/header 自選的 memberId。
- 有私鑰設定且保存了 Apple refresh token 時，先透過官方 revoke 撤銷；Apple 撤銷請求失敗時回報錯誤可重試。缺少私鑰時仍刪除我們的資料，成功後只記一筆「Apple token 未撤銷」及原因 `PRIVATE_KEY_NOT_CONFIGURED`；有設定但沒有 refresh token 時則記 `REFRESH_TOKEN_NOT_AVAILABLE`。紀錄不含 token、subject、會員 ID 或姓名，不以本地刪除成功冒充 Apple 授權已撤銷。資料庫在同一筆交易刪除成員、歸屬/小組、所有 session/登入綁定、進度、積分、好友、提醒/裝置代碼、報名關聯、舊日記/提名/投票與相關操作快取。失敗整筆回滾。其他會員保留；共同內容保留，其他會員紀錄中屬被刪除管理者的操作歸屬去識別。
- 已刪除成員的舊裝置與簽名 session 不能再讀寫。App 收到 `deleted: true` 才清掉該次 session，路由回登入頁；失敗保留登入並顯示重試，不讓舊請求登出新帳號。
- 手機舊日記不遠端抹除；目前沒有日記入口。外部 Google 兌換試算表的列由管理者手動刪除，政策另行說明；公布欄週刊不屬個人帳號資料。

### 登入狀態的保存、過期與跨帳號切換（`src/services/authSession.ts`）

- 登入成功後的憑證存在 `expo-secure-store`（加密），下次開 App 會自動還原，不用重新登入；每個帳號用自己的一組儲存 key（`storageOwner`），换帳號登入不會讓舊帳號的快取資料混進來。
- 一般（非裝置）session 有到期時間（伺服器目前給 3600 秒），到期後狀態變成「登入狀態已過期」，帳戶頁顯示「登入狀態已過期」並要求重新用 Google 登入；勾了「保持裝置登入」（`session_type: 'device'`）取得的裝置 session 沒有到期時間，只有登出或伺服器主動撤銷才會失效。
- 個人資料（姓名、頭像、小組）另外非同步載入，有自己的四種狀態：載入中/成功/「載入完成但沒有東西」/「載入失敗」；帳戶頁分別顯示「正在載入帳戶資料」「（成功後顯示資料）」「尚未取得帳戶資料」「暫時無法載入帳戶資料」，後兩種都有「重試載入」按鈕（`src/ui/accountSurface.ts`）。
- 一個已經失效的裝置憑證會被記進本機「待撤銷」清單，等下次連上網路時背景送給伺服器撤銷，不會卡住當下的登入或切換帳號動作。

### 帳戶頁（`src/ui/accountSurfaceComponent.tsx`）

- 已登入且個人資料載入成功時：顯示頭像（`avatarUrl` 有值才顯示圖片，否則顯示姓名字首的圓形字母）、姓名、登出按鈕、讀經提醒設定、「我在哪裡聚會」、刪除帳號與資料的按鈕。
- 帳戶入口圖示（`AccountEntryButton`）同一套規則：有頭像顯示頭像，否則顯示姓名字首；**資料還沒回來之前一律顯示中性的「人」字**，不會用 memberId 拼出字母（避免顯示像 `google:1234567` 的 `1` 這種假身份）。
- 讀經提醒：帳戶頁只顯示「讀經提醒」開關與時間，**不顯示「聚會提醒」**（`showMeeting={false}`）；程式註解明確寫「正式帳戶頁停用已退役的聚會提醒」——這與「小組」分頁已退役一致（見「已知限制與待辦」）。提醒設定本身的完整規則不在本文件範圍。
- 最下面一行顯示安裝的版本，例如「版本 0.5.24 (47)」：括號裡是 Google Play 用來分辨版本的 versionCode。帳戶頁每個狀態都顯示（含載入中、載入失敗）；讀不到版本時整行不顯示，不會編一個版本（`appVersionLabel`）。頁面底部留在安全區內（`app/account.tsx` 的 `SafeAreaView`）：App 畫到系統導覽列底下，0.5.24 的版本號就是被導覽列蓋住。
- 「刪除帳號與資料」在兩個平台都走 App 內確認/API，不再開啟政策網頁。政策網頁保留額外聯絡支援，寄信不是刪除必要條件。iOS 返回鍵只顯示系統箭頭，不露出路由群組名稱 `(tabs)`。

- 管理者 (後端 `getCapabilities` 回 `canViewAllScores`) 在刪除連結上面多一行淡色的「全體 (管理) ›」(`src/ui/AdminAllScoresEntry.tsx`)；按下回到積分頁並切到「全體 (管理)」，仍要先通過裝置解鎖 (見 [points.md](points.md))。其他人不顯示這一行，查不到權限時也不顯示。

### 青少/主堂 (`src/ui/congregation/`、`server/congregation.ts`)

- 新會員登入後的第一個畫面問「你在哪裡聚會？」，兩個大按鈕：「青少」(國中、高中、大專) 和「主堂」(成人)。存好才關掉；存不到時留在這個畫面，顯示「沒有存到，請檢查網路後再按一次。」(`CongregationGate`，在 `app/_layout.tsx` 最外層)。
- 這個功能上線前就有帳號的會員都算青少，不會被問 (後端第一次建表時一起寫入)。
- 帳戶頁讀經提醒下面一行「我在哪裡聚會」，顯示青少或主堂。按「改 ›」先跳確認「改到主堂？」：公告會先打開主堂那一頁、獎品改看主堂的清單、已經得到的積分不會變；按「改到主堂」才存 (`CongregationSetting`)。
- 讀不到時不擋 App：網路斷了就不出現選擇畫面，帳戶頁也不顯示這一行，下次打開畫面再讀。舊後端沒有這個 API，一律當青少。
- 積分「團體」的人數和團體獎依這個設定計算，見 [points.md](points.md)。

### 後台規則與文件 (`src/ui/admin/BackOffice.tsx`、`app/back-office.tsx`、`server/adminLinks.ts`)

- 管理者 (後端說可以看全體的帳號) 在帳戶頁多一列「後台規則與文件 管理者 ›」，其他人看不到。
- 打開時先要裝置解鎖 (指紋、臉或解鎖圖案，提示文字「解鎖後台規則與文件」)；沒解鎖顯示「需要完成身分驗證才能查看後台規則與文件。」和「再解鎖一次」，不顯示任何內容。
- 「規則」：可以換的分數、人數、週刊、青少/主堂、管理者，各一行白話。「文件」：獎品與兌換試算表、讀經表、排班表、報名表單等，按「開啟 ›」用瀏覽器打開。最下面寫「連結從私人設定讀，不在公開的程式碼裡。」
- 連結由後端 `GET /api/admin/documents` 給 (只給管理者，其他人 403)，來自私人部署的 `admin-links.json` (`[{"name", "url"}]`，只收 https)；檔案沒有或壞掉時寫「還沒有設定文件連結。」。

### 登出（`clearAuthSession`、`POST /api/session/revoke`）

- 按「登出」立刻清掉本機的登入狀態（畫面馬上回到登入畫面），並且非同步呼叫伺服器撤銷這個裝置的 session；伺服器端撤銷是「精確比對這個 token」，不看用戶端自稱的會員或裝置 ID（`server/mobileSessions.ts` 的 `revokeSession`）。
- 撤銷請求即使因為這個憑證已經失效（401/403）而被伺服器拒絕，也算撤銷完成，不會讓佇列卡住重試；只有網路完全打不通才會留著、等下次前景再送一次。

### App 更新提示（`src/services/appUpdate.ts`、`src/services/updateCheck.ts`、`UpdateBanner.tsx`、`UpdateCard.tsx`、`UpdatePrompt.tsx`）

- **先問 Google Play**（2026-10-13 起，`checkAppUpdate`）：用 Play 官方的 App 內更新（Play Core，經由 `expo-in-app-updates`）問 Play 這個帳號能不能裝到更新的版本，Play 會照帳號所在的測試軌道回答。
  - Play 說有新版：提示照下面三處出現，標題只寫「有新版本」（Play 只給 versionCode，沒有大家看得懂的版本名稱）；按「更新」直接在 App 裡跑 Play 的全螢幕更新（immediate），Play 開不了時改開 Play 商店頁 `PLAY_LISTING_URL`（`startAppUpdate`）。
  - Play 說沒有新版：就是沒有，不再看版本檔。Play 裝的 App 是 Play 簽章，安裝頁的 APK 裝不上去。
  - Play 回答失敗（側載的 APK 會得到「app not owned」，或手機沒有 Play）：改用下面的版本檔，按「更新」照舊開安裝頁。
- 版本檔（側載的 APK 用）只比較「Android 版本代碼」（`versionCode`）：抓 `VERSION_URL` 上發布的版本檔（本 repo 內 `announcements/app-version.json` 就是目前的版本，例如 `versionCode: 44`/`versionName: "0.5.21"`），跟裝置上安裝的版本比大小；比對失敗、逾時（8 秒）、格式不完整都當作「沒有更新」，不會出現半吊子的提示。
- 三個地方都讀同一個結果，但呈現方式不同：
  - `UpdatePrompt`：開 App、或從背景回前景時蓋在畫面最上層的全螢幕彈窗（`Modal`），有「更新」（Play 裝的在 App 裡更新，側載的開安裝頁）與「稍後」；`mandatory` 為真的版本沒有「稍後」按鈕。第一次檢查沒抓到（例如手機剛醒來還沒連網）會在 20 秒後自動再檢查一次。
  - `UpdateCard`：公告分頁最上方的常駐卡片，只要手機還落後就一直在，不會因為使用者關掉全螢幕提示就消失（2026-09-27 的產品決定：避免使用者不小心關掉提示後找不到更新入口）。
  - `UpdateBanner`：讀經精讀器（`app/(tabs)/reader.tsx`）更多閱讀工具面板裡的一行提示，可以按「稍後」關掉本次顯示。
- **只有 Android 會看到任何更新提示**：`checkAppUpdate` 和 `fetchUpdateState` 一開頭都檢查 `Platform.OS !== 'android'`，是的話直接回「沒有更新」，**不問 Play、不發任何網路請求**——這是為了符合 App Store 2.5.2（不能引導使用者去裝會改變功能的安裝檔）；iOS 交給 App Store 自己的自動更新。

## 可見時更新 (2026-10-19)

- 回到前景時重讀姓名、青少/主堂歸屬及提醒設定。姓名改變後，帳戶頁和頭像字首一起更新；讀取失敗保留已有姓名，不改登入身分。
- 每次進帳戶頁或積分頁重新確認管理者資格；同一個帳戶頁的兩個管理入口共用一次查詢，資格被撤回後隱藏入口。受保護資料仍由後端檢查權限。
- 後台文件讀取失敗或清單尚未設定時，文件區顯示「重試」；按下後再次解鎖並重讀。閒置不自行重試。

## 決定（為什麼這樣做）

- 登入只叫一次 Google 官方的登入視窗；開 App 時先顯示開機畫面再決定去哪；登入中被系統關掉重開時說清楚 (維護者 2026-10-19，起因：使用者以為被踢出來)。
- 看過的資料要跟上：回到前景、切回頁面時重讀，不用計時器 (維護者 2026-10-19)。

- 2026-10-19：Play 測試機的新 Google 身分加驗過的 token email 網域訊號，與既有 App 旗標、IP 清單任一命中即建員停用，且僅限首次建員；既有會員與 Apple 路徑不變。網域僅有社群回報，尚未在正式環境確認，因此 log 分別記錄每個訊號的狀態供下次上傳查核，不記個資或 email 本身。

- 2026-10-18：原生選帳號畫面被切走或系統關閉後，登入 promise 可能一直沒有結果，因此提供前景/等待提示讓使用者能重試，不靠輪詢。主管審查後確定：回前景後 10秒、或原生等待 60秒只讓按鈕恢復，不宣告登入失敗或丟棄結果；iOS 回前景後 SDK 還可能交換 token，2-step 驗證也可能超過 60秒。未重按就接收同一次晚到結果，只有重按或元件卸載才結束舊的 auth attempt 並丟棄舊結果。這取代最初「前景 1秒/60秒到點即結束嘗試」的做法，避免誤傷正常慢速登入。
- 2026-10-18 維護者決定登入頁三行改寫讀、聽、累積積分這三件青少和主堂都有的事，日記沒有入口所以不介紹，報名只有青少所以不寫。

- iOS Google 登入使用私有 iOS OAuth client (bundle id `org.qingmu.youth`) 及對應的 callback scheme；送給後端的 ID token audience 仍是既有 web client。Android 保留原本的 Google/Firebase 設定。正式 TestFlight 安裝與真帳號登入另由帳號持有人驗收，不以模擬器打開 Google 頁面代替。

**刻意不做：**

- **Apple 登入只在 iOS 提供**：依 2026-10-17 不公開上架決定與 M6 設計實作，Android 維持 Google；共用程式以平台分支限定原生 Apple 授權。
- **iOS 完全不顯示 App 更新提示，也不會為了檢查版本發出任何網路請求**：Android 才需要側載安裝檔更新；引導使用者去裝安裝檔在 iOS 上會違反 App Store 審查規則 2.5.2。（來源：[../../AGENTS.md](../../AGENTS.md) iOS 注意事項第 2 點）
- **不收集 Email、密碼，只存 Google 帳號給的識別碼**；也不收集位置、通訊錄、相片影片、廣告識別碼，沒有廣告或使用行為分析工具。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)）

- **Google 登入第一次找不到對應帳號時會自動建立會員**，不用先請維護者手動開帳號；但「誰是管理者」不會因為誰先登入就自動取得——管理者身分是維護者在私有部署設定裡另外指定的，不會進公開原始碼。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §3.4）
- **Play 測試機器人自動停用，不用人審新會員** (維護者 2026-10-15，2026-10-18 補充)：上傳 Play 後，測試機器人會登入、讀經、投票，影響讀經人數和排行。「新會員要等管理者確認才算數」被否決：太慢，而且問題是上傳 Play 造成的，不該變成管理者的工作。10-15 原本只比對 Firebase Test Lab 公布的裝置 IP 位址；10-16 與 10-18 仍有機器人漏擋，當時後端已收到位址，但清單未命中。因此改加 [Firebase 官方文件的 Android 系統設定訊號](https://firebase.google.com/docs/test-lab/android/android-studio#modify_instrumented_test_behavior_for)：`Settings.System.getString(contentResolver, "firebase.test.lab")` 等於 `"true"`，或現有 IP 清單命中，任一成立就讓新會員在建立時停用；既有會員不受影響。系統設定訊號要等包含此改動的下一版 Android App 上架，且後端支援此欄位後才會生效；只更新後端無法讓舊版 App 帶訊號。機器人登入後只看到登入失敗，正式發布前測試報告的範圍因此只到登入畫面，這是刻意的：機器人能進 App 就會投票、加好友，影響真的會員。IP 清單仍保留；Test Lab 預定 2027-09-30 停止服務，換平台時要重查。
- **Play 裝的 App 用 Play 的 App 內更新**（維護者 2026-10-13，取代原本「只用版本檔、不用原生模組」的做法，理由寫在 `updateCheck.ts` 開頭）：Play 自己的自動更新什麼時候跑不一定，維護者的手機放了好幾個小時都沒更新。畫面維持原本的全螢幕提示、公告卡片、讀經一行提示，只換「去哪裡問」和「按更新做什麼」。當初不用原生模組的理由是「這個專案不重新產生 android/」，現在 Expo 模組在 Gradle 建置時自動連結（`android/settings.gradle` 的 `useExpoModules()`），不用手改 android/。
- **App 版本號放在帳戶頁最下面**（維護者 2026-10-13）：測試者要能說出 Google Play 裝的是哪一版，一般 App 也是點頭像進去的帳戶或設定頁看得到版本。括號放 versionCode，因為 Play 用它分辨版本。
- **刪除帳號直接在 App 完成，不以停用或寄信代替**：2026-10-17 送審決定取代舊「連結＋寄信」流程；主管同意的 V2 不提供日記匯出，因為目前沒有日記入口。
- **後台規則和文件連結放在同一頁，要解鎖才看得到** (維護者 2026-10-17)：不用到處找；連結只放私人設定，公開的程式碼裡沒有。
- **全體排名的入口放在帳戶頁最下面，淡色**：管理者一個月才看幾次，不必每天在積分頁看到。(維護者 2026-10-14)
- **青少/主堂用同一個 App、同一個帳號，新會員第一次登入自己選** (維護者 2026-10-17)：主堂的成人也要用這個 App。已經在的會員都是青少，不再問；選錯可以在帳戶頁改，改之前先確認，已經得到的積分不會變。

**待確認（沒有記錄，請維護者確認是否刻意）：**

- 公告分頁的更新卡片不會因為關閉全螢幕更新提示而跟著消失：規格裡記著「2026-09-27 的產品決定」，但沒有找到對應的 design/plan 文件記錄原因。
- `avatarUrl` 目前一律回傳 `null`，帳戶相關畫面因此顯示不出 Google 頭像：這是刻意的隱私決定，還是還沒接上的功能，沒有找到記錄。

## 平台差異

- 更新提示：iOS 完全不出現（見上），這一點有 iOS 自動化流程 `.maestro/ios/40-no-update-prompt.yaml` 專門驗證「等過 20 秒重試視窗仍然看不到『有新版本』字樣」。
- Google 登入的 iOS 設定：建置時提供 `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`，App 會從 Google 的 reversed client scheme 取得 iOS client ID，傳給原生登入模組；同時保留 web client 作為後端 token audience。只有 Android services 設定檔時也會獨立註冊 iOS callback，不會略過 Android Firebase。沒有 iOS 設定的 CI 假資料建置仍可編譯；`plugins/withGoogleSignInPods.js` 只補 modular headers，不能代替登入設定。TestFlight 真機的帳號登入仍屬發布驗收。
- 通知權限：登入後如果讀經提醒是開的，App 會要求通知權限，兩個平台行為一致（`AGENTS.md`）。

## 資料與後端

- 認證相關 API（`server/routes.ts`）：`POST /api/session/google`（用 Google ID token 換 session，可選 `session_type: 'device'`）、`POST /api/onboarding/claim`（用啟用碼綁定身份並換 session）、`POST /api/session/device`（把一般 session 升級成不過期的裝置 session）、`POST /api/session/revoke`（撤銷裝置 session 或標記舊版 session 撤銷）、`GET /api/me/profile`（姓名/小組/能力）。
- 伺服器目前對 `/api/me/profile` 的 `avatarUrl` **一律回傳 `null`**（`server/routes.ts` 的 `/api/me/profile` 處理），所以帳戶頁與帳戶入口圖示的「顯示 Google 頭像圖片」那條分支目前實際上不會被觸發，畫面一定顯示姓名字首的圓形字母。
- 向下相容：`server/authBoundary.ts` 的 `authenticateSessionOrGoogle` 同時接受三種 Bearer token 格式——新式裝置 session（`qmd_` 開頭）、舊式簽名 session（`qms_` 開頭，可能已被登出動作標記撤銷）、以及直接送 Google ID token；舊版已安裝的 App 換到新後端不會被擋。
- App 更新檢查同時保留兩個網址：`VERSION_URL`（現在的公開安裝頁）與 `LEGACY_VERSION_URL`（0.5.4–0.5.15 讀的 GitHub 網址），兩份內容需同步發布，讓還沒更新到能讀新網址的舊版 App 也能收到更新通知。
- 帳號資料表：`members`（含 `disabled_at`）、`identity_bindings`（Google subject↔會員）、`member_invites`（啟用碼）、`auth_sessions`（裝置/舊式撤銷紀錄）；schema 建立在 `server/mobileSessions.ts` 的 `ensureMobileSessionSchema`。
- 青少/主堂：`GET /api/me/congregation` 回 `{congregation}`，值是 `youth`、`main`，還沒選是 `null`；`PUT` 同一個路徑存 `{congregation}`，其他值回 400 `INVALID_CONGREGATION`。資料表 `member_affiliations` (`server/congregation.ts`)，刪除帳號時一起刪。

## 守住它的測試

- `tests/ui/authStartup.test.ts`、`tests/ui/appStackGuard.test.ts`：還原期間只顯示開機畫面，本機資料決定下一頁，不等網路。
- `tests/ui/signInScreen.test.ts`、`tests/ui/googleLoginRecovery.test.ts`：重開提示期限、一次性消費、登入各結果清記號、重試隔離與既有逾時/晚到結果。
- `tests/services/googleNative.test.ts`：Google 官方 explicit 視窗只呼叫一次，沒有 One Tap 或建立帳號的前置呼叫。

- `tests/server/testLabEmail.test.ts`、`tests/server/testLabSignal.test.ts`、`tests/server/googleAutoProvision.test.ts` — 系統訊號/IP/驗過的 token email 網域任一成立停用新會員、舊版相容、既有會員不變、停用會員無 session。
- `tests/services/googleSession.test.ts`、`tests/services/testLabSession.test.ts`、`tests/config/testLabConfig.test.ts` — Android 設定橋接與登入請求、iOS 不帶訊號、Expo 原生產生與重複執行。

- `tests/ui/signInScreen.test.ts` — 第一個登入畫面文案與唯一的登入動作。
- `tests/ui/googleLoginWelcome.test.ts` — 歡迎版登入按鈕的樣式與一般卡片版本一致。
- `tests/ui/googleLoginRecovery.test.ts` — Android/iOS 的假原生模組永不回應、前景 10秒/等待 60秒恢復按鈕但保留晚到結果、重試後舊結果隔離、正常成功/取消/失敗、晚到成功重新停用按鈕後交換 session，以及卸載清理。
- `tests/server/onboarding.test.ts` — 未知 Google 身份先被拒絕、再用有效期限內的啟用碼完成綁定、過期或用過的碼被拒絕。
- `tests/server/googleAutoProvision.test.ts`、`tests/server/testLabNetwork.test.ts` — 從 Test Lab 位址第一次登入的新會員一建立就停用，一般網路的新會員照常；既有會員不會被停用；位址比對涵蓋 IPv4、IPv6 和格式錯誤。
- `tests/services/authSession.test.ts`、`tests/services/authSessionHydration.test.ts`、`tests/services/authSessionRace.test.ts` — 登入狀態的邊界（session 綁定、還原流程、多個非同步動作同時發生時不互相踩）。
- `tests/ui/congregationChoice.test.ts`、`tests/services/congregationClient.test.ts`、`tests/server/congregation.test.ts` — 只問新會員、存不到會留在畫面、帳戶頁改之前先確認；舊後端當青少。
- `tests/mobileSessionServer.test.ts` — 裝置 session 的建立、撤銷、與舊式登入相容。
- `tests/server/session.test.ts`、`tests/server/authBoundary.test.ts` — 簽名 session token 的產生/驗證、正式 Google 驗證與開發測試 token 兩種認證模式的邊界。
- `tests/services/googleVerifier.test.ts` — Google ID token 的簽章、發行者、audience、過期檢查。
- `tests/ui/accountSurface.test.ts`、`tests/ui/accountProfileRecovery.test.ts` — 帳戶頁在已登入/過期/載入中/載入失敗/載入完成但空各種狀態下顯示什麼。
- `tests/ui/accountDeletionFlow.test.ts` — 二次確認、取消、成功登出與失敗重試。
- `tests/server/appleAccount.test.ts`、`appleVerifier.test.ts`、`appleTokens.test.ts`、`accountDeletionCoverage.test.ts` — Apple 驗證/授權撤銷、完整刪除、其他成員保留與交易回滾。
- `tests/ui/appleLogin.test.ts`、`tests/services/appleAccountClient.test.ts` — iOS/Android 按鈕差異、原生參數與 transport。
- `tests/ui/accountVersionLabel.test.ts`、`tests/ui/accountSurface.test.ts`（app version label）— 帳戶頁最下面的版本號，資料載入失敗時也顯示；讀不到版本時不顯示。
- `tests/ui/accountRouteSafeArea.test.ts` — 帳戶頁底部不會被系統導覽列蓋住。
- `tests/ui/accountReminderPatch.test.ts` — 帳戶頁的提醒設定只送出真的被改動的欄位。
- `tests/updateCheck.test.ts` — 版本比對規則、非 Android 平台完全不檢查。
- `tests/services/appUpdate.test.ts` — 先問 Play、Play 說沒有就不看版本檔、Play 失敗才用版本檔、iOS 誰都不問；「更新」在 App 裡跑 Play 更新、開不了改開商店頁、側載的開安裝頁。
- `tests/ui/updatePrompt.test.ts` — 全螢幕提示的開啟/稍後/回前景重問、以及公告卡片的顯示條件。
- `.maestro/ios/40-no-update-prompt.yaml` — 真機層級驗證 iOS 完全看不到更新視窗。

## 相關文件

- [announcements.md](announcements.md) — 公告分頁上的常駐更新卡片，以及「先登入才能看到公告分頁」的路由規則。
- [../play/privacy-policy.md](../play/privacy-policy.md) — 「申請刪除帳號與資料」連結的內容。
- [../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) — iOS 加「用 Apple 登入」、更新提示改法的規劃（Task 1、14、16）。
- [../superpowers/plans/2026-09-29-ios-parity-phase1-implementation.md](../superpowers/plans/2026-09-29-ios-parity-phase1-implementation.md) — 已合併的 M0–M5 範圍界定（Google/Apple iOS 登入排在 Phase 2）。

## 已知限制與待辦

- Apple 原生授權/真帳號登入、刪除的 TestFlight 驗收與 App Store 正式上架仍須發布階段證據；本 PR 程式與模擬器證據不替代實機結果。
- iOS Google/Apple 的私有設定需由正式建置/後端部署流程提供；不從公開原始碼取得憑證。
- `src/services/googleIdentity.ts`（`createGoogleIdentity`）在正式程式碼裡沒有任何地方呼叫，只有它自己的測試 `tests/services/identityBoundary.test.ts` 在用；實際登入走的是 `src/services/googleNative.ts` 的 `obtainGoogleIdToken`，這支檔案疑似是被取代後留下的舊程式碼。
- 帳戶頁隱藏的「聚會提醒」（`showMeeting={false}`）與 `server/reminders.ts`、`server/meetingSchedules.ts` 裡仍指向 `/groups` 的提醒路由，都是「小組」（RPG）分頁退役後留下的殘跡：`app/(tabs)/groups.tsx` 現在只是 `<Redirect href="/(tabs)/today" />`，分頁列也用 `href: null` 藏起來；伺服器端 `server/groups.ts`、`server/importMeetingSchedules.ts` 仍存在，只是為了讓已安裝的舊版 App 呼叫 `/api/me/groups` 時不會壞掉（回應已被清空社群連結與名冕），不是一個可以從目前 UI 進入的功能。
- `server/routes.ts` 對 `/api/me/profile` 的 `avatarUrl` 目前寫死回傳 `null`（見「資料與後端」），代表帳戶相關畫面上「顯示 Google 頭像」的程式路徑目前無法被觸發；待確認這是刻意的隱私決定還是尚未接上的功能。
