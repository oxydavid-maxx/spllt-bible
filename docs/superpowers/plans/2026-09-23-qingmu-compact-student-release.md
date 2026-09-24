# 青牧：精簡日常操作與可下載版本 Detailed Execution Plan

> **Execution:** 光佑已於 2026-09-23 核准自主執行、手機操作、必要整合與發布。董事長 session 負責本計畫與 final review；新的青牧 CEO session 使用 `gpt-6-sol/high`，實作、建置、實機驗證與最後清理派給 `gpt-6-luna/max`。此明確分工優先於 skill 的預設 owner/model 建議。每個修改 owner 完成自己的 FOCUS；CEO 整合成單一候選做 RC，不把每個 worker 的局部 PASS 當產品完成。

**Goal:** 讓學生直接進入今日讀經，以一致的三個底部控制完成一天，積分與公告清楚緊湊；保住原有功能，完成實機 typical day、GitHub 推送與實際可用的 Google Play 下載交付。

**Architecture:** 延用 Expo Router、既有 YouVersion adapter、completion repository、gamification API 與公告發布器。改動集中在現有入口與資料投影；不重寫朗讀、登入、帳本或後端部署系統。累積分數為既有每日有效積分的投影，不新增第二本帳。

**Tech Stack:** Expo SDK 56、React Native 0.85、React 19、TypeScript、SQLite、Vitest、react-native-svg、PowerShell Android build、GitHub CLI、ADB。

## 1. 決策 authority 與不可破壞的限制

| ID | 已核准要求 | 明確邊界 |
|---|---|---|
| R01 | 讀經 tab 直接進入今天範圍，保留左右日期 | 不再先顯示「開始今日讀經」；切去其他 tab 再回讀經以今日範圍為預設。今日內可保留其章節/閱讀位置；不能回到昨日自由瀏覽而誤標今日。日期切換本身不報完成、不播放。 |
| R02 | 上方一排日期/章節/更多 | 今日章節收進標題展開選擇；移除永久佔第二排的章節 chips；保留自由選章、譯本、字級、版本資訊與著作權。 |
| R03 | 下方左日記、中播放/暫停、右完成讀經 | 三格一致尺寸、圖示系統、觸控範圍及標籤；倍速與連讀移入 `⋯`。完成後清楚顯示已完成，撤銷保留原確認語意。禁止播放結束或進頁就自動得分。 |
| R04 | 向下閱讀收合、反向滑動恢復 | 不是按播放立即隱藏；播放中有可見可點的暫停控制。不可干擾選節、註腳、複製、鍵盤和系統返回；操作 modal 時不收合。 |
| R05 | 同章節開 YouVersion | 使用目前版本/章節的官方連結；實測 App link 路徑及網頁 fallback。保留青牧自由選章，不要求新登入整合、不新增整套聖經搜尋器。 |
| R06 | 積分切換穩定 | 同帳號刷新不清成空畫面；初次載入、錯誤、離線有明確狀態。換帳號/登出仍立即清私人資料，舊請求不能覆蓋新帳號。 |
| R07 | 累積總分曲線預設，日曆選看 | 日期採讀經日期；9/23 補登 9/20，回補到 9/20。兌換不扣總分；撤銷修正有效積分。保留週/月/年/全部與日期導覽，區間起點包含以前累積分數。 |
| R08 | 目標卡可點選其他獎品 | 明示可更換；只選有效目標，不扣分；實際兌換沿用輔導流程。沒有第二件獎品也不能變成看似可點卻無反應。 |
| R09 | 歷史公告補講員，日期與講員同一行 | 從可核對來源補資料並修發布器/解析器/UI，缺值不猜。普通字級同排；極大字級允許自然換行，不能裁掉姓名。 |
| R10 | AI 用量答案有根據 | 既有讀經/音訊/日記/積分/投票/看公告不呼叫 LLM；獎品提案經 Claude CLI，預設 Sonnet 4.5。沒有 token 計數不可報精確數字。本輪不新增 AI 儀表板、不換模型/供應商、不讓日記送 AI。 |
| R11 | 學生產品、compact、consistent、保住既有功能 | 保留四個 tab、既有色彩/字體方向、一天一次積分、七日補登、三票、連讀順序、五譯本、好友/管理權限與安全修補。compact 靠減層級/重複列，不靠縮字/縮按鈕。 |
| R12 | 手機完整 typical day | 最終實際 APK 必须在 Pixel 逐項操作、留下證據，mock/單元測試不能代替。測試帳號可操作，結束撤銷測試寫入、還原原設定。 |
| R13 | Luna max 最後 clean up tree、push GitHub | 僅處理本任務樹與產物，不 reset/stage/delete 他人未提交工作；整理後確定遠端內容一致。 |
| R14 | Google Play downloadable links | 儘早查核現有 Play Console/簽章/測試管道，交付真實可安裝的 Play 測試或正式網址並驗證。GitHub APK 是另一交付物，不能冒充 Google Play；若缺帳號/權限/平台審查，記錄精確阻礙且整體仍未完成。 |

發布順序繼續為光佑 → 家人 → 學生。自動驗證可完成光佑設備的候選驗收；不可宣稱尚未发生的家人/學生試用已通過，也不主動寄信/訊息給家人或學生。Google Play 優先用現有內部測試管道，不能為了拿正式商店網址跳過試用。

## 2. 2026-09-23 13:56–14:03 UTC 現況與檔案地圖

- App repo：`C:/dev/apps/qingmu-bible`，remote `oxydavid-maxx/spllt-bible`。fresh `git ls-remote origin refs/heads/main` 為 `f561b83d8719d12ee55d2a1c5466a9cbbcab3074`。
- 可讀的乾淨新 main worktree：`C:/dev/machine/worktrees/qingmu-update-059`，同上 SHA。不可把目前主 checkout 的舊 HEAD 當 release 起點。
- 原 checkout HEAD `7fba578`，有既有未提交：`package-lock.json`、`server/contentRegistry.ts`、`tests/server/chapterAudioCapability.test.ts`、`tests/server/reminderWorker.test.ts`。本輪不得覆盖、stage、stash 或 reset。
- 正式後端前次 receipt 釘選 `79ecbe89e8b5be8e856342e0b5fad8f65896e844`，路徑 `C:/dev/machine/worktrees/qingmu-bible/r-79ecbe8`。執行前重新查核 pin/健康；此目錄永不供開發/建置。
- 已發布 owner beta 0.5.9/code30，APK source `ff125ca35ab67aa5a9cb572455409a79a9cf2349`。前次發布證據 `.handoff/work-20260923/release-final-receipt.json`；精簡公開事實 `docs/handoff/HANDOFF-20260923-r4.md`。r2/r3 是歷史，不可照舊重做。
- 舊 native QR 證據僅證明實機開關掃描器；雙真帳號 native 掃碼完整鏈仍未證明，不可洗成 PASS。
- App project 在 Codex 名為「青牧」但 saved path 為 `C:/dev/Obsidian/青牧`，其 Git root 是 `C:/dev/Obsidian`。CEO session 是專案歸屬；真正 app 開發必須在上述 app repo 的新 isolated worktree，不能把程式放進 Obsidian。
- 圖稿/原始截圖：`C:/dev/apps/qingmu-bible/.handoff/discussion-20260923/`。**`mock-reader.png` 的右側播放、底部倍速、完成放 ⋯ 已被光佑 R03 取代**；公告日期與講員第二行已被 R09 取代。圖只提供密度與外觀參考。

| 功能 | 主要檔案 | 既有針對性測試 |
|---|---|---|
| 讀經入口/日期/完成 | `app/(tabs)/_layout.tsx`, `today.tsx`, `reader.tsx`, `src/ui/ReadingDateNavigator.tsx`, `src/ui/ReadingTaskCard.tsx` | `tests/ui/route-contract.test.ts`, `focusedReaderRoute.test.ts`, `unscheduledReaderRoute.test.ts`, `tests/storage/readerPosition.test.ts` |
| Reader UI/音訊 | `src/ui/FullscreenReaderLayout.tsx`, `YouVersionReader.tsx`, `ChapterAudioControls.tsx` 與現有 DOM scroll bridge | `fullscreenReaderLayout.test.ts`, `readerImmersionSettings.test.ts`, `readerAudioSelectionWiring.test.ts`, `readerAutoplayNativeFlow.test.ts`, `chapterAudioReplay.test.ts` |
| 積分/獎品入口 | `app/(tabs)/progress.tsx`, `src/ui/gamification/RewardGoalCard.tsx`, `ScoreProfile.tsx` | `gamificationProgressRoute.test.ts`, `gamificationProgressSecurity.test.ts`, `rewardGoalCard.test.ts` |
| 圖表投影 | `server/gamification.ts`, `src/domain/gamificationV1.ts`, `src/services/gamificationApiClient.ts`, `src/ui/gamification/ScoreProfileChart.tsx` | `tests/server/scoreProfileChart.test.ts`, `tests/ui/scoreProfileChart.test.ts`, `tests/ui/gamificationApiClient.test.ts` |
| 公告全鏈 | `tools/announce/build.ts`, `parse.ts`, `publisher.ts`, `src/services/announcementClient.ts`, `src/ui/AnnouncementBoard.tsx`, `announcements/latest.json` | `tests/tools/announceBuild.test.ts`, `announcePublisher.test.ts`, `tests/services/announcementClient.test.ts`, `tests/ui/announcementBoard.test.ts` |
| 建置/部署 | `app.config.js`, `scripts/build-android.ps1`, `sync-deps.ts`, `release-environment.ps1`, `verify-inputs.ts`, `verify-candidate.ts`, `ops/README.md` | 既有 build guard、AI boundary/pin tests；不要改弱守衛使建置通過 |

## 3. 執行治理、派工與檢查點

- [ ] CEO 先 StartAck：回報完整 session ID、Sol/high request、實际可見 host 證據、plan path、app 工作路徑與董事長回報路徑 `01a0c7f4-a741-75c0-8c59-e94a9e632137`。不能把 requested model 當 effective model。
- [ ] CEO 建立單一 status receipt，放 `C:/dev/apps/qingmu-bible/.handoff/compact-20260923/ceo-status.json`；只記 phase、workers、commit/worktree、證據路徑、blocker、next action，不複製長日誌。
- [ ] 所有執行 worker 用 native `collaboration.spawn_agent`，`model: gpt-6-luna`, `reasoning_effort: max`, `fork_turns: none`，給足獨立 scope/禁止事項/驗收。不要再建立多個使用者側 session；不使用 CLI 子程序偷換模型。
- [ ] 一個 lane 一個 writer。建議 W1 Reader、W2 Points、W3 Announcements；W0 distribution access audit 可先以唯讀 lane 執行，完成再釋放 slot。每個 worker 自建 isolated app worktree，禁止既有後端/他人工作樹。
- [ ] 每個 owner 自己做 FOCUS：重現/失敗案例 → 最小修改 → 受影響測試 → 修正。CEO 不重做 worker 已有的相同查證，也不擴張需求。
- [ ] 一位 Luna integration/release owner 整合提交；衝突交回相關 owner 解釋，不採任意 ours/theirs。只保留一個 build writer、一個手機 operator；必要時分段接棒。
- [ ] 董事長自 CEO 開始執行起 5、10、15 分鐘監督，之後每 30 分鐘。檢查當前 authoritative thread/worktree/receipt、是否偏題/過度設計/重複綠測/無意義輪詢；糾正同一 CEO，不另起重複實作。
- [ ] CEO 在 RC ready、不可解外部 blocker、完成交付三個事件主動回報董事長。不要等定時檢查才通報；董事長 final review 通過後再進發布/最終清理。
- [ ] 任一工具失敗先在同一 owner bounded diagnose/fix/resume，不因 observation timeout 重新 build 或重新派整份任務。若平台拒絕操作，保留原拒絕原因，不換工具繞過。

### 自我約束與中止擴張判準

1. 不新增圖表套件、全域 state framework、播放器功能、AI 計費頁、新登入方式、後端常駐監控器。
2. 一個需求有兩種相同品質路線，採較小 diff；不全面重新排版未要求的頁面。
3. Reader 首張實作截圖須先核對 R01–R04，再擴展所有狀態；若三鍵不一致/密度變差/又多一列，退回同 owner 修正，不繼續美化其他頁掩蓋問題。
4. 安全/權限/資料一致性回歸必修；與本輪無關的非阻塞問題記 backlog，不趁機重構。
5. Play Console 等外部工作即使卡住，其餘可完成的實作、實機、GitHub 仍繼續，但不把整體目標標 complete。

## 4. W0：建立基線與查明 Google Play 交付路徑

**Owner:** Luna max。此 lane 先唯讀，與 app 實作獨立。

- [ ] 記錄 remote main、已發布 versionCode、現有 signing 身分摘要、手機 versionName/code、backend pin/health、原 checkout 四檔 hash。只記公開 metadata/hash，不輸出 secret/key/token。
- [ ] 查現有 repo/docs/build receipt 中的 Play Console/app ID/track/簽章設定；再透過已登入的官方 Console 或已配置官方 API 檢查權限。用官方當前文件查 account-specific 可用發布路線，不根據記憶承諾通過時間。
- [ ] 成果要回答：`org.qingmu.youth` 是否存在、可使用 internal testing/internal app sharing/production 哪條、是否接受既有 app signing、是否需新增 upload certificate、哪個步驟可自主完成、哪個真正需要本人身份或平台審查。
- [ ] 現有可用 Play 測試管道優先；記錄實際 track、tester access、APK/AAB 要求與 link verification 步驟。不能自造 `play.google.com/store/apps/details?id=...` 當已上架證據。
- [ ] 現有 build 已支援 `-Bundle -Variant release`，不要自建分發服務。Google Play 可能重新簽章，必須核對 Google sign-in/Firebase/YouVersion/API 相容性；不可為裝 Play 版先卸載而丟資料。
- [ ] 權限或 Console 不存在時，將完整、已備妥可審閱產物與明確 blocker 回報 CEO；不購買帳號、不代做無法證明的法律/身分声明。不要讓此 lane 卡住 UI。

**Output:** `distribution-readiness.md` + safe metadata receipt。此報告不是 Play 發布完成。

## 5. W1：今日正文與一致的閱讀控制

**FOCUS RED:** 點讀經仍停在開始卡；正文前有兩排；底部播放在左；scroll callback 為 no-op；完成只能退回起始頁。

- [ ] 在現有 route 結構上把 tab 導向今日 reader。今日定義統一使用 Taipei date；不要 hardcode 2026-09-23。focus 跨日切換到新今日，保持同日已選 chapter 的合理位置。手動左右切日期留在 reader；重新選讀經 tab 回今日。
- [ ] 將 reader/today 共用的 completion 操作接到右側按鈕，沿用 repository、operationId、七日 window、離線 queue、confirmed/pending/error、undo confirmation。不得建立第二份得分 mutation 或只改 UI 假成功。
- [ ] 取消任務頁後仍保留未登入、未排讀經、離線無內容、更新提示、帳號入口與同步錯誤的可到達性，位置採現有 account/menu 元件；禁止把讀經頁變成設定頁。
- [ ] top row 保留日期兩箭頭、可點目前章節標題、`⋯`。點章節開當日範圍選單；自由選章仍在更多中；超長章節名稱截斷標題而非擠掉功能。
- [ ] bottom row 用同一個現有/局部 button primitive，三格等寬、共同 48dp 最小觸控高、同圖示 stroke/size、同標籤基線。播放控制繼續使用原音訊 controller；完成不得因 double tap 重複得分。
- [ ] 完成狀態：未完成顯示「完成讀經」；已完成顯示「已完成」並可進原撤銷確認；pending 禁止重入；不可補登/未登入按既有規則 disabled 或呈現原因。完成對象是上方所選 taskDate，不是無條件今天。
- [ ] 倍速與連讀開關皆置於 `⋯`；更新說明文案，不再說「工具列的開/關」。保留既有倍速/連讀持久化和不自動開始播放語意。
- [ ] 使用已有 scroll bridge 的真實方向/位移；若缺方向，只在既有 bridge 補必要 payload。向下超過 12dp 的有效閱讀捲動收合，向上超過 12dp 恢復，微小抖動不切狀態；modal/鍵盤/選文時不搶動作。頁面 focus/關 modal 恢復工具。
- [ ] 收合時正文有真正可用高度，非單純 opacity 留白；播放中保留中央同款暫停控制，不遮最後一行，其他控制隨反向滑動回來。TalkBack 啟用時保持重要控制可到達，避免只有手勢入口。
- [ ] 新增「在 YouVersion 開啟此章」採 `https://www.bible.com/bible/${versionId}/${chapterUsfm}`；拒絕空/非法值，以選中 reader 身分而非舊 daily reference 組 URL。開外部前保存本頁位置並避免兩套音訊重疊；返回不能改完成狀態。

**要新增/更新的行為案例：**

```text
Tap reading tab -> today's scheduled scripture visible without start CTA.
Select yesterday -> previous reading; tap points -> reading -> today.
Date changes at Taipei midnight -> next focus uses new today, no credit/audio side effect.
Open no-plan day -> honest empty state with working date arrows.
Complete twice rapidly -> exactly one daily entitlement; undo -> prior total.
Offline complete -> pending; reconnect -> one confirmed write; restore baseline via real undo.
Down 20dp -> hidden tools; up 20dp -> visible; playing -> pause always actionable.
Open diary/settings/footnote -> BACK/outside/close preserve reader identity and restore controls.
YouVersion URL for PSA.98/version46 != old chapter or version landing URL.
```

**FOCUS command:** `npm exec -- vitest run tests/ui/route-contract.test.ts tests/ui/focusedReaderRoute.test.ts tests/ui/unscheduledReaderRoute.test.ts tests/ui/fullscreenReaderLayout.test.ts tests/ui/readerImmersionSettings.test.ts tests/ui/readerAudioSelectionWiring.test.ts tests/ui/readerAutoplayNativeFlow.test.ts tests/ui/chapterAudioReplay.test.ts tests/storage/readerPosition.test.ts`。

新增新行為測試放同一相關檔或 `tests/ui/readerDailyFlow.test.ts`，將新增檔加到上述 pack。不靠只比 source 字串的測試證明 native 行為。

## 6. W2：穩定積分、累積曲線、目標選擇

**FOCUS RED:** 同帳號 focus refresh 清空 profile 引發閃動；目前 chart 是每日/月份格；大目標卡是非可點 View。

- [ ] 先記錄切進積分的狀態順序/實機短片，定位空白、整頁 remount 或逐區 layout shift 的來源。保留同一 session/member/scope 已載入快照，在背景 refresh；成功只更新資料，失敗保留資料並提供現有 retry。
- [ ] 不刪除 auth ownership 檢查。登出/切帳號先清私人資料；舊 response 必須被 generation/session 判斷丟棄；scope 切换不得短暫露出另一人的私有獎品/餘額。
- [ ] 累積來自 `daily_point_entitlements` 有效資料，以 task date 排序。擴充現有 chart payload，採 additive optional fields 保持舊 client/舊 server 相容；新 server 必須提供準確 carry-in。

```ts
// Extend the existing domain interfaces, not a second API/ledger.
interface ScoreChartBucket {
  key: string;
  startDate: string;
  endDate: string;
  earnedPoints: number;
  cumulativeEarnedPoints?: number;
}
interface ScoreChart {
  // Keep every existing field unchanged.
  openingEarnedPoints?: number;
}
// Backend algorithm, using the same active entitlements predicate as totalEarned:
// opening = SUM(amount WHERE active=1 AND member_id=? AND task_date < periodStart)
// running = opening
// for each existing bucket in date order: running += bucket.earnedPoints
// bucket.cumulativeEarnedPoints = running
```

實際資料表欄位名稱依既有 query 使用，不杜撰 migration。`all` 起點之前為 0；未來日期不能畫成已發生紀錄。client parser 驗證 finite/nonnegative integer；舊 payload 缺 carry-in 時不可拿總分反推歷史月起點，顯示誠實 unavailable 並保留日曆。

- [ ] 用已存在的 `react-native-svg` 畫折線，不加依賴。預設「走勢」，可切「日曆」；保留原週/月/年/全部導覽。月/週按日，年/全部沿用既有 bucket 粒度並清楚標示，不捏造日點。點選能讀到日期與累積值，提供簡潔 accessibility label。
- [ ] 同一 chart 組件涵蓋 0 分、只有一點、跨月/年、多年、補登、撤銷與餘額已兌換情境；圖高度不壓掉 tab，標籤不互相擠。
- [ ] 目標大卡可開現有 `rewards` sheet，增加「更換目標 ›」；所有有效獎品可選，只有一件也正常顯示已選項。選取走原 `setTarget`，不扣 wallet、不產生 redemption；管理權限保持不變。不新做商城。

**確切資料 oracle：**

```text
有效 points: 8/31=2, 9/10=1, 9/20=1, 9/23=1.
September opening=2; 9/10 cumulative=3; 9/20=4; 9/23=5.
9/23 補登 9/20：變動落在9/20，之後各點同步增加，不落到9/23。
兌換2分：earned curve仍5，wallet從5變3。
撤銷9/20：該日有效分移除，9/23 cumulative=4。
Historical August chart end=2，即使目前 lifetime總分=5。
Old payload無新欄位 -> parser相容；不顯示錯誤推估曲線。
Refresh memberA in flight -> sign out/sign in memberB -> memberA result never displayed.
```

**FOCUS command:** `npm exec -- vitest run tests/server/scoreProfileChart.test.ts tests/ui/scoreProfileChart.test.ts tests/ui/gamificationApiClient.test.ts tests/ui/gamificationProgressRoute.test.ts tests/ui/gamificationProgressSecurity.test.ts tests/ui/rewardGoalCard.test.ts tests/server/gamificationV1.test.ts`。

## 7. W3：歷史公告日期/講員同排

**FOCUS RED:** 發布 payload/前端 PastWeek 丟失 speaker，歷史列只有日期。

- [ ] 在 `tools/announce/build.ts` 的 past item 與 `src/services/announcementClient.ts` 的 `PastWeek` 加 `speaker: string | null`；舊資料缺 field 正常解析為 null，不破壞既有 audio/slides/transcript links。
- [ ] 延用 existing sermon/schedule/source metadata 核對歷史日期的 speaker；reuse previousWeek cache 必須保留 speaker。修發佈 producer，不能只手改 latest.json 一次。
- [ ] 查明目前 9/13、9/6、12/13、6/14 對應年份及講員；從現有權威公告來源讀取，不因同月同日跨年誤配。不用 LLM 猜姓名，不對私人日記/帳戶做廣域搜尋。
- [ ] 畫面普通字級顯示 `9/13 · 講員姓名` 同一行，連結按鈕沿用。無權威 speaker 不顯示虛構姓名；receipt 記來源缺漏及追查結果，不能宣稱全部補完。
- [ ] 保留 upcoming 與 last sermon 原內容，更新公告資料只改本輪核實的歷史欄位；對其它公開發布欄位逐項 diff，防止舊資料覆蓋新資料。

```ts
// Parser projection must preserve the verified field and tolerate old JSON.
speaker: typeof item.speaker === 'string' && item.speaker.trim()
  ? item.speaker.trim() : null
// Display, inside the existing past row:
[formattedDate, past.speaker].filter(Boolean).join(' · ')
```

**FOCUS command:** `npm exec -- vitest run tests/tools/announceBuild.test.ts tests/tools/announcePublisher.test.ts tests/services/announcementClient.test.ts tests/ui/announcementBoard.test.ts`。

## 8. 整合、後端與正式候選建置

- [ ] Integration Luna 以 fresh origin/main 建立候選，整合 W1/W2/W3，收集每 lane exact SHA/FOCUS receipt。API/UI 合約由 W2 完整持有；W1/W2 不同時編 `_layout.tsx`。
- [ ] `npm run typecheck`、`npm run verify:inputs`、`npm run verify:candidate` 按既有工具要求執行；執行必要的 integrated affected pack。遇到 verifier 依賴 receipt 時填實際證據，不偽造/跳過。禁止每個人各跑全套。
- [ ] 若 backend 需要 chart fields，按 `ops/README.md` 備份 SQLite、建新的 pinned release worktree、驗測 health/API兼容、再依既有 restart/cutover 步驟切換；先在隔離 DB 证明投影。AI config/工具限制/外部 commit pin 不可降級；保留可回滾舊 backend。
- [ ] 下一版本以 fresh GitHub/installed/Play code 最大值 +1 決定；預期 `0.5.10/code31`，若被占用則單一 owner 協調遞增。`package.json`、lock、app config、receipt/release notes 不能互相矛盾。
- [ ] 建置在隔離且路徑夠短的 build worktree，不能用正式 backend。重用既有私有 build loader 但不複製到 repo/日誌；不隨意建立第二套憑證載入法。

```powershell
# Run in the exact candidate build worktree after existing native setup.
& ./scripts/build-android.ps1 -Variant release
# For the same source/config/dependency identity, when W0 confirms Play path:
& ./scripts/build-android.ps1 -Variant release -Bundle
```

- [ ] build scripts 的 dependency sync、patch-package、release environment、Google services、DOM boundary 必須通過。記錄 commit、lock/patch digest、build inputs 的非秘密摘要、APK/AAB SHA256、簽章摘要、versionCode；receipt 不包含 private app key/secret。
- [ ] `adb install -r` 同簽章保留資料；安裝前後對 versionCode、簽章、APK/source binding，不能只看到「安裝成功」。若 Play signing 不同，先解決受支援的遷移/測試路線，不能卸載丟日記。

## 9. RC：實機 typical day 與外觀驗收表

**手機唯一 owner:** CEO 指定一位 Luna，其他 agents/root 在該 lease 期間不送 input。ADB 原路徑 `C:/dev/tools/qingmu-android/sdk/platform-tools/adb.exe`，之前 serial `100.94.24.39:5555`，先 `adb devices` 重新確認。guard helper `.handoff/review-20260922/phone.py` 可重用；每次輸入前確認 foreground/lock，若不是青牧或核准的外部驗證頁則停輸入並重新辨識，不能盲點。

用測試帳號原狀作基線：只記必要設定與帳本狀態；不輸出私人日記、不把相機/QR token/screenshots 推 GitHub。授權可寫測試資料，但用可辨識的新測試 diary/nomination/reward，不覆寫既有內容；最後沿官方操作撤销或刪除自己的測試內容，保留帳本稽核。

| Check | 操作與成功 oracle |
|---|---|
| D01 啟動與今日 | 冷啟、點讀經，直接看今天經文；日期正確，不先出開始卡；四個 tab 可達。 |
| D02 日期/章節 | 前一天/後一天/今日、今日章節選單、自由選章、無任務日期；標題/正文/音訊/日記 taskDate 一致。 |
| D03 播放基本 | 三鍵位置/尺寸一致；點播放→進度前進→暫停→再播；切章節/譯本後對應正確；PSA98 第1節播放時第2節無舊灰條。 |
| D04 連讀/倍速 | `⋯` 能改倍速/連讀且返回後保存；連讀按今日順序、最後停；開關本身不播放，無 audio 譯本仍誠實不可播放。 |
| D05 沉浸 | 按播放不立即消失；向下滑才收合，暫停仍可用，向上滑恢復；末行不被遮；modal/選節/註腳/複製不互相搶。 |
| D06 日記 | 左鍵開所選日期日記、鍵盤不蓋保存/關閉、長測試文字可編輯保存/重開；私有內容不截取；清掉本輪測試資料後原筆記不變。 |
| D07 完成/撤銷 | 右鍵完成、UI/總分同步；重按/重開不重複得分；撤銷確認恢復；過期/未來日期不可完成。原本已完成日需先記錄並最終恢復。 |
| D08 離線恢復 | 先確認快取內容，短暫斷網驗閱讀/日記/完成pending、重連去重同步；恢復原網路狀態。不可把手機長期留離線。 |
| D09 積分切換 | Reader↔Points 重複至少5次，短片逐幀確認無整頁空白/跳回loading；第一次載入也合理。只做觀察資料，不用加動畫掩蓋閃動。 |
| D10 曲線/日曆 | 預設曲線，週/月/年/全部、前後區間、日曆切換；對照可查帳本而非看起來像線；補登/撤銷/跨月carry-in/兌換後總分一致。 |
| D11 目標 | 點卡開picker、選另一個有效測試目標、回頁與重啟保留；分數/餘額不變；恢復原目標並停用本輪新增測試獎品。 |
| D12 提案/好友/管理回歸 | 三票、提案入口、好友QR顯示、原生掃碼開/關/返回、管理保護/兌換歷史入口逐一點過；真實双帳號不能用 bypass 代替。已有同候選有效交易proof可重用，不為列PASS再污染正式帳本。 |
| D13 公告 | 日期/講員同排、長姓名、大字級；報名/錄音/投影片/逐字稿逐一核對可開與返回；無來源不猜。 |
| D14 外部閱讀 | 現在章節開YouVersion，確定實際章節/譯本或誠實fallback，返回青牧位置/完成狀態保持；不留雙音訊播放。 |
| D15 設定/日常收尾 | 帳號入口、五譯本、字級、提醒時間/開關、更新入口仍可達；恢復原設定，關相機、暫停音訊、回青牧。 |

**外觀證據:** normal 與沉浸、more、日記鍵盤、完成前後、points兩view/targetpicker、公告各有可讀截圖。normal尺寸以同手機 before/after比較：正文可用高度不能倒退；頂部不再兩排；底部三格等高、中心播放、左右均衡；不能新增永久空白列。

**尺寸/可及性:** Pixel 原生尺寸實測全部流程；320/360/412dp 和大字級用可用 emulator 或暫時且可還原的測試設定驗layout，記錄哪種設備/方法。至少實機檢查大字級、鍵盤、長文、TalkBack；不得把桌面 mock 截圖列為實機結果。48dp 最小touch area；普通文字對比至少4.5:1、重要圖示3:1；不為compact縮小原閱讀字。

**RC receipt:** 每列 PASS/FAIL/BLOCKED + candidate SHA/APK hash/device/version/backend + screenshot/video path + restored-state evidence。FAIL 回相關 Luna FOCUS，同一 candidate 修後只重跑受影響證據；以相同 APK 綁定的未受影響 proof可保留。

## 10. 董事長 final review、GitHub、Play、清理

- [ ] CEO 提交 `rc-review.md`：需求R01–R14逐項對應、整合diff、FOCUS摘要、RC實機表、before/after、真實未解限制、backend/API狀態、發佈候選、rollback。
- [ ] 董事長核對實際 code/receipt/圖與下載source binding；查不必要的功能/依賴、mock舊決策是否混進去、privacy/auth/cumulative/window語意。任何拒絕項交回同 CEO/Luna修，不另起整份實作。
- [ ] 可先開 draft PR 供 review，所有 PR 必須 attach 到所屬任務。描述面向未讀對話的 reviewer，列具體前後行為和驗證，不能只寫「優化」。
- [ ] final review 通過後由 Luna release owner 合併/push；main與source候選digest核對，保持既有發佈資料新鮮，不能覆蓋他人同期更新。
- [ ] 發 GitHub owner pre-release 上傳唯一正確 APK，實際下載並hash核對；`announcements/app-version.json` 指向該 APK **直接資產網址**，發布資產可下載後才更新manifest，不能用 `/releases/latest`。
- [ ] 依 W0 已證實 Play 管道上傳同候選 AAB、讀回 processing/track/version/signing 狀態，取得真正 tester opt-in/install/internal-sharing URL。以有資格測試帳號打開並確認可安裝候選版本；未審核或未提供下載不能叫 downloadable。
- [ ] Play已安裝版本若與side-load簽章/組裝不同，補做實機登入、reader/audio、完成/points及來源綁定 smoke，不能把 APK proof直接視為Play組件proof。
- [ ] **最後明確派一位 Luna max 做 cleanup lane**：檢查任務新增暫存/測試資料/分支/worktree/進程、保留release和可重建證據、只清已確認任務owned且不再用的產物；先列清單/範圍、核對resolved absolute paths及junction，不遞迴跟隨node_modules junction，不刪既有worktree或dirty files。
- [ ] Cleanup 最後 `git status --short`, `git diff --check`, remote readback、release asset/download、Play link、手機還原、backend health 全部核對。自己造成的清理文件/receipt更新要commit/push，原四檔仍保持原hash。
- [ ] 最終 CEO 回報董事長：GitHub commit/PR/release/直接APK、Play真實下載link與可用對象、版本/source/APK/AAB/signing摘要、RC與cleanup evidence、殘留限制。董事長做關閉audit；R14未實現仍保留goal，不能用GitHub替代而結案。

## 11. Rollback 與完工判準

- UI/資料投影 rollback 使用 revert本輪commit，不重置主checkout、不回滾使用者新日記/新紀錄。SQLite只有schema不兼容/損坏且經核對才用既有備份還原；本案預期不需schema migration。
- Backend切换失敗依既有pin/startup程序回到舊verified commit，確認health與帳本，不直接在liveworktree修碼。
- 發布失敗保留上一個可下載manifest；新APK或Play未通過就不提高更新提示版本。若已暴露壞資產，撤下更新入口、保留事故receipt，再出修正版，不改寫同版本檔案混淆hash。
- 只有全部已核准行為、實機typical day、美感/compact/consistency、資料還原、GitHub與Play可用下載、Luna cleanup完成且董事長review通過，才可稱本目標完成。外部審查/缺帳號與真正缺第二測試身分要逐項誠實列出，不能由綠測試補足。

## 12. Plan coverage 自審

| Requirement | Task/proof |
|---|---|
| R01–R05 | W1 + D01–D08/D14 + layout/TalkBack evidence |
| R06–R08 | W2 + exact cumulative oracle + D09–D11 + auth regression |
| R09 | W3 + D13 + source provenance |
| R10 | Baseline答覆/不擴增AI範圍；發布前核對AI boundary未降級 |
| R11–R12 | constraints + all D01–D15 + visual review/restoration |
| R13 | final Luna cleanup + remote/hash readback |
| R14 | W0 + actual Play publication/install link verification |
| 指定CEO/workers/監督/回報 | §3 + durable heartbeat + CEO event reports + §10 final review |

此表只證明計畫涵蓋需求；不代表實作或驗收已通過。
