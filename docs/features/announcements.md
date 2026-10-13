# 公告

> 狀態：0.5.22 程式碼｜平台：Android、iOS（差異見「平台差異」）｜2026-10-13 候選核對 (尚未發布)

## 一句話

公告分頁顯示這週/下週主日的資訊、上次講道的資料、報名狀況與常設資訊；資料直接讀公開發布的 JSON，就算後端伺服器沒開機也能看。

## 從哪裡進

- 登入後，分頁列最左邊的「公告」（喇叭圖示），對應 `app/(tabs)/announcements.tsx`。
- 這個分頁本身讀的是公開 JSON、不用登入也能讀，但**整個 App（含公告分頁）在 Expo Router 的層級就先卡了登入**：`src/ui/AppStack.tsx` 用 `Stack.Protected guard={signedIn}` 把 `(tabs)` 整組（公告在內）鎖住，沒有登入或登入過期的人會先看到 `app/sign-in.tsx`（見 [account.md](account.md)）。

## 功能一覽

| 功能 | 使用者看到什麼 |
|---|---|
| 下次聚會 | 日期、主題（或兩堂各自的信息/內容）、服事名單、報名按鈕與報名人數 |
| 上次講道 | 每一堂的名稱、講員、經文與資料連結，有才顯示；單堂沿用原版面 |
| 以前的主日 | 每週的日期/講員/標題在上、連結按鈕在下；不是今年的日期顯示年份 |
| 常設資訊 | 教會提供的固定資訊（例如地址），網址自動變成可點的連結 |
| 版本更新卡片 | 分頁最上方，手機版本落後時常駐顯示（見 [account.md](account.md)） |
| 離線/過期提示 | 抓不到最新公告時，安靜顯示「目前顯示是哪一週」的小字 |

## 行為規格

### 資料來源與快取（`src/services/announcementClient.ts`）

- App 開啟或切回這個分頁時都會重新抓一次：`app/(tabs)/announcements.tsx` 用 `useFocusEffect(load)`；公告本身**沒有其他輪詢**，因為一週最多改兩次。
- 一進分頁會先顯示裝置上「上一次成功抓到」的快取（`readCached`），同時背景重新抓最新的；等最新的抓完才用它蓋掉畫面，避免畫面先空白再跳動。
- 抓取網址固定是 `https://raw.githubusercontent.com/oxydavid-maxx/spllt-bible/main/announcements/latest.json`，8 秒逾時。
- 抓取失敗（逾時、HTTP 非 2xx、JSON 壞掉、或內容解析不出必要欄位如 `week`）時：畫面**不會**顯示錯誤或空白，而是顯示裝置上的舊快取並標記為「過期」；如果裝置上也沒有任何快取，公告卡片全部不顯示，只留一行「還沒有本週公告。」。
- 只有解析成功的內容才會覆蓋裝置快取，避免一次壞的發布把舊的好內容也毀掉。
- 解析採「只認我知道的欄位，多出來的欄位忽略、缺欄位的區塊整塊不畫」策略，所以舊版 App 讀到新版多加的欄位不會壞，新版 App 讀到舊格式的檔案也不會空白一片。

### 下次聚會卡片（`src/ui/AnnouncementBoard.tsx`）

- 有 `next.sessions`（兩堂內容不同）時，每個堂次一列：左邊是堂次標籤，右邊第一行小字「類別 · 講員」（例：信息 · 佑駿），第二行粗體標題（例：亞當的後代）；沒有類別也沒有講員的堂次（第二堂「青少團契」）只顯示標題一行。沒有 `sessions` 時退回單一 `topic`/`owner` 那一行。
- 發布檔案怎麼填這幾個欄位（`tools/announce/build.ts`）：
  - 第一堂：從「中亮第一三周信息排班」（類別「信息」）或「中亮第二四周青年啟發內容」（類別「青年啟發」）那一週的列，標題取主題格的第一行，負責人照抄。
  - 第二堂：「正慧姐青崇一三周第二堂規劃」或「小丁第二四周第二堂」那一週有規劃列時才有，標題一律是「青少團契」，沒有類別和負責人，所以畫面上只有「第二堂 青少團契」一行；規劃列裡的章節、內容和負責人都不寫進發布檔案。那一週兩個分頁都沒有規劃列時，不顯示第二堂。
  - `topic`/`owner`（舊版 App 只讀這兩個）：第一堂的標題和講員；那一週只有第二堂時，是「青少團契」、沒有負責人。
- 有 `next.roles`（服事名單，例如講員、主領、招待）時，在卡片下方另起一段 grid 顯示每個角色與對應的人名，欄名完全照發布檔案給的名稱顯示，不是寫死的固定清單。
- 有 `next.signup`（報名連結）才會出現「報名」按鈕，按下用 Chrome 分頁開啟外部表單。
- 報名狀況（已有幾人報名/朋友是誰）只在「已登入」且「能把公告上的日期換算成日曆日期」且「伺服器有回應」三個條件都成立時顯示；任一條件不成立就只是不顯示這一段，不會出現錯誤訊息（`app/(tabs)/announcements.tsx`）。
- 報名人數為 0 時完全不顯示報名狀況區塊（即使已登入且日期换算成功），因為 `registration.total > 0` 是顯示的前提。

### 上次講道與以前的主日

- 新公告加上頂層 `sessions`，歷史各週也可帶 `sessions`。每堂有 `label`、`title`、`speaker`、`passage` 與資料；新版 App 優先讀它，沒有時照舊讀 `sermon`/`past`。
- `sermon` 及 `past` 的既有欄位仍代表第一堂，沒有第二堂資料混入；舊 App 忽略新增欄位後照常顯示第一堂。
- 多堂時在「上次講道」卡片內各自顯示第一堂/第二堂標籤、名稱、講員與資料連結；單堂不加堂次標籤，沿用原版面。沒有講員或某種資料時不顯示該行/按鈕。
- 每堂的 `materials` 保存多份同角色檔案，不會只保留第一份。同角色超過一份時，按鈕加上檔名方便辨識；第一份也投影到既有連結欄位供舊版 App 使用。講稿/小組文件以「教材」顯示，不誤稱逐字稿，舊欄位不受影響。
- 公告工具匿名讀取檔名、投影片文字、文件開頭及當週同一份分堂服事表，以一週一批的便宜級 LLM 分類，分為報告投影片、該堂教學投影片、錄音、逐字稿及其他資料。PPTX/Google Slides、DOCX/Google Docs、文字檔直接擷取；PDF 用可取得的 `pdftotext` 讀前三頁，工具缺少或內容讀不到時保留 unknown。錄音不做付費轉錄。
- 判斷讀不出、呼叫失敗或回應不合法時，退回原本檔名規則並逐檔記錄 `CLASSIFY FALLBACK <檔名>`，分類失敗本身不擋發布。原有必需來源、連結及結構檢查照常適用。
- LLM 只決定堂次/角色；顯示用的公開標題/講員必須出現在檔案內容中，否則保留服事表的名稱/講員。第二堂的工作規劃只用於分類，不直接公告；下次聚會的第二堂仍是「青少團契」。
- 分類 model/effort 從 `skill-brain dispatch plan` 的便宜查找級取得，沿用專案受限且無工具的 Claude CLI；不寫死 model 名稱。分類快取綁內容、服事表、prompt、model/effort，所擷取內容或檔案清單變動時重判。沒有常駐程序。
- 「以前的主日」來源只保留有效週日資料夾，而且在所選週日向前八個週距內；缺週不補入更早的零散資料夾。週六活動/封存資料夾 (例如 2026-07-11、2025-12-13、2025-06-14) 不進清單。

- 每個連結（錄音/講道投影片/報告投影片/逐字稿/影片）只有發布檔案裡有值才畫對應按鈕，缺的不畫空按鈕；按下一律用 Chrome Custom Tab（`WebBrowser.openBrowserAsync`）開啟，不用 App 內建的 WebView。
- 「以前的主日」清單完全依照發布檔案 `past` 陣列的順序顯示，程式不做排序或去重。
- 每筆標題行把「日期/講員/標題」用「·」接起來，長文字可換行；連結按鈕固定在下一行，按鈕本身可隨手機寬度換行，一顆或多顆都採同一個排版規則。
- 以目前台北日期判斷年份：今年顯示月/日（`9/20`），其他年份顯示年/月/日（`2025/12/13`）；離線時也相同。

### 報名人數與好友名單（後端，`server/eventRegistrations.ts`）

- 名單來源是教會自己的 Google 表單，透過 Apps Script 推送到 `/api/integrations/form-registrations`；推送只帶「姓名＋選的日期」，LINE ID、年齡等欄位從不進到這個系統。
- 推送的驗證方式二選一：一個由 session secret 派生的固定金鑰（`x-qingmu-registration-key`），或表單擁有者自己 Google 帳號簽的 identity token（`ScriptApp.getIdentityToken()`），且該 token 的 audience 第一次接受後就會被釘住，之後只認同一個 audience。
- 姓名比對：完全比對到唯一會員才算數；比對不到的名字（例如訪客、拼字不同）**只算進總人數，不會綁定到任何會員**，因此不會出現在任何人的好友名單裡。
- 每次推送都是「重寫」而非「疊加」：從昨天（Taipei）起的日期，先整批刪除舊的報名紀錄再寫入這次推送的內容，所以取消報名會反映成總數變少；昨天之前的舊日期不受影響。
- 一個會員讀某天的報名狀況時，只看到：總人數、自己是否報名、以及**自己朋友關係表裡有報名的人**的名字——不會看到不是朋友的其他報名者姓名。

## 決定（為什麼這樣做）

**刻意不做：**

- **不做小組（RPG）、LINE 群組、通話等功能**：主導覽只留讀經和積分，這些入口已經被產品決定移除；現在看到的殘餘程式碼（`src/services/lineLinks.ts`、`app/(tabs)/groups.tsx`）只是為了讓已安裝的舊版 App 不會壞掉，不是還沒做完的功能。（來源：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md) §1.1 CL01）
- **報名比對只用姓名和日期，不收集 LINE ID、年齡等其他欄位**：這是隱私政策定下的界線，不是資料沒串接好。（來源：[../play/privacy-policy.md](../play/privacy-policy.md)「我們收集的資料」）

- **發布檔案採「多欄位、忽略未知鍵」的格式**：新版加欄位不會讓舊版 App 壞掉，新版讀到舊格式的檔案也有退回顯示——因為後端承諾舊版 App 仍要能正常連線。（來源：[../../AGENTS.md](../../AGENTS.md)「編輯注意」：後端要向下相容）
- **公告在 iOS 移植計畫裡被列為低風險、不特別客製化**：因為這是同一份 React Native 元件與同一個 HTTPS GET，兩平台沒有分支。（來源：[../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) §3 第 9 項）
- **第二堂只寫「青少團契」，不寫章節和內容**：兩個第二堂分頁（每月第一到第四週）都一樣；分頁裡的規劃（例如「創世記3~5章／分組進行」）是同工安排用的，不是要公告的內容。舊版 App 讀的 `topic`/`owner` 也改用第一堂，不再出現團契的規劃。（維護者 2026-10-01 決定）
- **排程發布一律用 GitHub main 的程式，不用開發中的工作目錄**：`tools/announce/run.cmd` 先把 main 取到排程專用的 checkout 再執行；拿不到就不發布。2026-10-02 第二堂的修正已合併一天，但排程跑的是沒更新的工作目錄，09:00 又把第二堂蓋回團契規劃。（維護者 2026-10-02）
- **分類必須看內容，不能要求大家照格式命名**：2026-10-11 的讀書會投影片曾被檔名規則歸成第一堂報告。改用一次便宜 LLM 判斷堂次/角色；失敗保留原本發布能力。第一堂舊欄位不改意義，第二堂透過新增欄位提供。近期週聚會和零散活動/封存資料夾分開，避免後者混入歷史清單。 (維護者 2026-10-13 工單決定)
- **以前的主日固定日期在上、按鈕在下，非今年的日期顯示年份**：按鈕數量和手機寬度不改變行的結構，避免少量按鈕擠到日期右側或誤認年份。（維護者 2026-09-30 決定）

- **下次聚會每一堂「類別 · 講員」在上、標題在下**：沒有類別和講員的堂次只顯示一行標題，不留空行。發布檔案格式不變，舊版 App 照舊顯示。（維護者 2026-10-01 決定，2026-10-02 起由 App 畫面實作）

**待確認（沒有記錄，請維護者確認是否刻意）：**

- 報名人數為 0 時，整段報名狀況完全不顯示（不是顯示「目前 0 人報名」）：目前找不到記錄這個決定的理由。

## 平台差異

- 沒有找到公告功能本身的 Android/iOS 差異；程式碼是同一份 React Native 元件與同一個 HTTPS GET。
- iOS 的 iOS-parity 計畫（`docs/superpowers/plans/2026-09-29-ios-parity.md` 第 9 項）本身把公告列為「預期不用改」的低風險項目，只用 Maestro 截圖確認畫面能開。

## 資料與後端

- 公告內容本身**不經過** `server/`：直接讀 GitHub raw 上的 `announcements/latest.json`（本 repo 內 `announcements/latest.json` 就是目前發布的版本，範例欄位：`week`、`sermon`、`next`（含 `sessions`/`roles`）、`standing`、`past`）。
- 報名狀況才經過後端：`GET /api/me/groups`-同層的 `GET /api/me/event-registrations?date=YYYY-MM-DD`（`src/services/eventRegistrationClient.ts` 呼叫），需要 Bearer session token 與 `x-qingmu-member-id`。
- 後端資料表：`event_registrations`（誰報名哪天）、`event_registration_totals`（每天總人數）、`form_sync_audience`（釘住的推送者 Google audience），定義在 `server/eventRegistrations.ts` 的 `ensureEventRegistrationSchema`。
- 發布：維護者電腦上的排程執行 `tools/announce/run.cmd` → 把 GitHub main 取到排程專用的 checkout，用那份程式產生公告、交給 `tools/announce/publisher.ts` 從另一個專用的 main checkout 推上 `announcements/`。開發用的工作目錄在哪個分支、有沒有改到一半，都不影響發布；拿不到 main 的程式或任一步失敗就不發布，上週的檔案留著（舊但不錯），原因寫在 `tools/announce/last-run.log`。
- 舊版 App 相容：發布檔案格式是「多欄位、忽略未知鍵」設計，新加欄位不會讓舊 App 壞掉；反過來新 App 讀到沒有 `sessions`/`roles`/`sermonSlides` 的舊檔案也有對應的退回顯示。

## 守住它的測試

- `tests/services/announcementClient.test.ts` — 解析發布 JSON、多餘欄位容忍、抓取失敗時退回裝置快取並標記過期、成功才覆蓋快取。
- `tests/ui/announcementBoard.test.ts` — 卡片版面規則：下次聚會的兩堂顯示（「類別 · 講員」在上、標題在下，沒有類別講員只一行）/退回單一主題、報名人數與好友顯示位置、講道連結按名稱分開、缺欄位整塊不畫、過期提示文字。
- `tests/tools/announceIngest.test.ts` — 產生公告：第二堂只有「青少團契」、`topic`/`owner` 不帶團契規劃、那一週沒有第二堂規劃列就不顯示第二堂。
- `tests/tools/announceClassify.test.ts` — 真實投影片標題擷取、分類回應邊界、未命名內容與 metadata 的來源檢查。
- `tests/tools/announceParse.test.ts` — 近期週日序列與排除零散封存資料夾。
- `tests/tools/announceRunner.test.ts` — 排程先取 main 的程式、只從那份 checkout 執行，取不到就不發布。
- `tests/eventRegistrationClient.test.ts` — 把公告上的 `9/27` 換算成最接近今天的日期、只信任預期形狀的回應、伺服器異常時安靜回傳 `null`。
- `tests/server/eventRegistrations.test.ts` — 表單推送的兩種身份驗證（固定金鑰/Google identity token 且釘住 audience）、姓名比對規則、只回傳好友名單與總數、整批重寫上游日期的規則。

## 相關文件

- [account.md](account.md) — 登入才能看到這個分頁的前提，以及分頁上方的版本更新卡片。
- [../superpowers/plans/2026-09-29-ios-parity.md](../superpowers/plans/2026-09-29-ios-parity.md) — 第 9 項：公告在 iOS 移植計畫裡的風險評估。

## 已知限制與待辦

- `src/services/lineLinks.ts` 目前只有它自己的測試（`tests/services/lineLinks.test.ts`）在呼叫它，程式裡沒有任何畫面或後端路由使用它；從內容（LINE OpenChat/RPG 固定組連結）判斷，這是已退役的小組（RPG）功能留下的殘餘程式碼，不是公告功能在用的東西。
- `app/(tabs)/groups.tsx`/`src/ui/GroupCard.tsx`/`server/groups.ts` 對應的「小組」分頁已經退役：分頁本身在 `app/(tabs)/_layout.tsx` 設了 `href: null`（不出現在分頁列），`groups.tsx` 內容只是 `<Redirect href="/(tabs)/today" />`；相關的伺服器 API（`/api/me/groups`）仍存在，但只是為了讓已安裝的舊版 App 不會壞掉，回應內容已被清空社群連結與名冕（`server/routes.ts` 的 `/api/me/groups` 處理）。
