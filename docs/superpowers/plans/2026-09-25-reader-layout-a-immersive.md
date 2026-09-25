# 閱讀頁 A＋沉浸頁首收合 Implementation Plan

> **Execution:** The current native owner implements the complete release candidate, owns every FOCUS loop, and produces the exact candidate for RC. The plan does not mandate delegation or a separate reviewer. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讀經頁照 `docs/design/reader-page.md` 定案的 A 版面與沉浸規則上線，沉浸永遠退得出來，播放、日記、完成、積分不退步。

**Architecture:** 工具列改成「疊在經文上」的 overlay：WebView 閱讀區在一般與沉浸之間**不改尺寸**（之前切換時閱讀區重排，是跳回章首與閃爍的高風險來源）。收合、叫回的**事件**由既有 DOM bridge 在 WebView 內偵測（每次往下的新手勢、往上累積、到章首、到章尾），**狀態**只由 RN 持有（重複訊息忽略）；返回鍵、點收合細條在 RN 端叫回，WebView 不需要回報，下一次往下的新手勢就會再收合。點經文一律交給 SDK 選取經節（§3）。

**Tech Stack:** Expo Router／React Native、`@youversion/platform-react-native-expo-ui` DOM component（WebView）、vitest＋react-test-renderer、headless Chromium（既有 `fullscreenReaderPadding` 測試架構）。

## Global Constraints

- 規格：`docs/design/reader-page.md` §2 已定案、§3 YouVersion 規則、§5 A、§5.1 沉浸改良（本分支改為定案，2026-09-25 光佑同意）。
- 不改經文文字、節號、詩體語意；不建立另一套聖經 renderer；SDK 只透過既有 bridge 注入 CSS/JS。
- 不清使用者保存的字級/行距；不動後端與正式 DB；不發布 release、不改更新提示。
- 主要控制 ≥ 48dp；完成圈與播放各 56dp、間距 12dp、圓心同高；1.3 倍系統字不截斷標頭。
- 章節用簡寫（`formatReferenceZhTw`：多1、詩99、詩100、提前1）；無障礙標籤用全名。
- 收合細條左側內容 ≤ 螢幕寬 40%，中間留給鏡頭挖孔。
- 建置照本機 `docs/handoff/NEXT-AI.md` §3（`C:\w\q`、JDK/SDK、4 GiB heap、1 worker、私有 loader）；安裝只用 `adb install -r`；不 uninstall/clear。

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/ui/readerSettingsBridge.ts` | WebView 內的收合/叫回判斷、章尾偵測、沉浸中點擊叫回、版面 CSS（上下留白、隱藏孤立章號、小標 600） |
| `src/ui/YouVersionReader.tsx` | 解析 bridge 訊息 → `onCanvasScroll`／`onCanvasReveal`／`onCanvasEdge`；把 `canvasInsets` 交給 bridge |
| `src/ui/FullscreenReaderLayout.tsx` | `useReaderChrome` 狀態（去掉點擊切換、加返回鍵、章尾狀態）與 overlay 版面（頁首、章節籤、收合細條、右下 ○ ▶、下一章卡） |
| `src/ui/CompletionAwardFeedback.tsx` | 新增 `bottomOffset`：閱讀頁的 +1 從右下 ○ 上方浮出 |
| `app/(tabs)/_layout.tsx` | 讀經頁 tab 列改 absolute（收起時場景不重排）、沉浸時隱藏 |
| `app/(tabs)/reader.tsx` | 接線：新 callbacks、`canvasInsets`、完成/下一章所需資料 |

---

### Task 1：Bridge 收合／叫回協定與版面 CSS

**Files:** Modify `src/ui/readerSettingsBridge.ts`、`src/ui/YouVersionReader.tsx`；Test `tests/ui/readerImmersionBridge.test.ts`（新，headless Chromium）、`tests/ui/fullscreenReaderWrapper.test.ts`（改訊息轉送案例）、`tests/ui/fullscreenReaderPadding.test.ts`（padding 期望值改為傳入值）。

**Interfaces:**
- Produces：`READER_CANVAS_REVEAL_MESSAGE = 'qingmu.reader.canvas.reveal'`（data `{ reason: 'up' | 'top' | 'end' | 'tap' }`）、`READER_CANVAS_EDGE_MESSAGE = 'qingmu.reader.canvas.edge'`（data `{ atEnd: boolean }`）、`readReaderCanvasRevealEvent(data): RevealReason | null`、`readReaderCanvasEdgeEvent(data): { atEnd: boolean } | null`、`buildReaderDomBridge(fullscreen, hasVersionMetadata, insets?: { top: number; bottom: number })`。
- `YouVersionReader` props：新增 `onCanvasReveal?(reason)`、`onCanvasEdge?(event)`、`canvasInsets?`；移除 `onCanvasTap`。

Bridge 規則（常數寫在 bridge 內，單位 CSS px＝dp）：`HIDE_MIN_TOP = 48`、`REVEAL_UP = 120`、`EDGE = 24`、`NEW_GESTURE_MS = 400`。
- 一次往下的手勢（Δ ≥ 12 且 scrollTop > 48、不在章尾）送一次既有 `scroll{direction:'down'}`；停 ≥ 400ms 或轉向後算新手勢，會再送（RN 若已由返回鍵叫回，就再收合）。
- 一次往上的手勢累積 ≥ 120 → 送一次 `reveal{up}`；小滑不送。
- 進入章首（scrollTop ≤ 24）→ `reveal{top}`；進入章尾（`scrollTop + clientHeight ≥ scrollHeight − 24`）→ `edge{atEnd:true}`＋`reveal{end}`；離開章尾 → `edge{atEnd:false}`。換章後內容重排時重送一次 `edge`（短章不用捲就到底）。
- 不攔任何點擊：點經文交給 SDK 選取經節（§3「點經文不是切換工具列」）。
- CSS：`main` padding `top/16px/bottom/16px` 用傳入值；`.s1` 字重 600；隱藏「第一個經節之前、整段只有數字、且不含經節/節號」的區塊（MutationObserver 於換章後重套）。

- [ ] **Step 1（RED）：** 新增 `tests/ui/readerImmersionBridge.test.ts`，沿用 padding 測試的 iframe＋`--dump-dom` 架構，fixture 為真實 SDK CSS＋`<main>`＋`[data-slot=yv-bible-renderer]` 內 `<div class="c">1</div><div class="s"><span class="yv-h">問候</span></div><div class="p"><span class="yv-v" v="1"><span class="yv-vlbl">1</span>神的僕人…</span>…</div>`（另一例把章號放 `.label`）。腳本依序設定 `main.scrollTop` 並記錄 `postMessage`。斷言：
  - 下捲到 200 → 一次 `scroll down`；上捲 60 → 無 reveal；再上捲 80（累積 140）→ `reveal up`；
  - 再下捲收合後捲到 0 → `reveal top`；下捲到底 → `edge atEnd:true` 且 `reveal end`；
  - 同一手勢繼續下捲 → 不重送；停頓後新的下捲手勢 → 再送一次 `scroll down`；
  - 點經文 → 沒有訊息、不 `defaultPrevented`、SDK 的 click handler 收到事件；
  - 章號區塊 `display:none`、節號 `1` 仍顯示、`.s1` computed `font-weight` 600、`main` padding-top/bottom 等於傳入值。
  Run: `npx vitest run tests/ui/readerImmersionBridge.test.ts` → FAIL（新常數與行為不存在）。
- [ ] **Step 2：** 實作 bridge（上列規則），`readReaderUiMessage` 接受新型別；`YouVersionReader` 轉送新 callbacks、傳 `canvasInsets`。
- [ ] **Step 3（GREEN）：** `npx vitest run tests/ui/readerImmersionBridge.test.ts tests/ui/fullscreenReaderWrapper.test.ts tests/ui/fullscreenReaderPadding.test.ts` 全過。
- [ ] **Step 4：** commit `feat(reader): immersive reveal rules and layout CSS in the DOM bridge`。

### Task 2：Chrome 狀態、overlay 版面、收合細條、右下 ○ ▶、下一章卡

**Files:** Modify `src/ui/FullscreenReaderLayout.tsx`、`src/ui/CompletionAwardFeedback.tsx`；Test `tests/ui/readerLayoutA.test.ts`（新，A 版面）、`tests/ui/fullscreenReaderLayout.test.ts`（改寫舊版面斷言）、`tests/ui/readerLayoutContract.test.ts`、`tests/ui/fullscreenReaderScreen.test.ts`（main 上收集階段就壞：mock 落後於 app；對齊可用的 harness 後改成新規則）、`tests/ui/focusedReaderVisibleIdentity.test.ts`（同樣 mock 落後，補齊）。

**Interfaces:**
- Consumes：Task 1 的 `RevealReason`。
- `useReaderChrome()` 回傳新增 `revealTools(reason)`、`handleCanvasEdge({atEnd})`、`atChapterEnd`、`collapsed`；移除 `toggleTools`。
- `FullscreenReaderLayout` props：新增 `referenceLabels: string[]`（簡寫）、`nextReferenceLabel?: string`、`completionFeedbackOffset` 由版面自己算；移除 capsule/清單相關 state。

版面規格（dp）：頁首＝SafeArea top（狀態列顯示）＋日期列 48（標題 16sp/600，兩側寬度隨內容）＋章節籤列 48（chip 高 34、字 16/700、目前章節實心；自由閱讀時前面加實心「自由 創1」）＋`⋯`。收合細條＝top 0、高 48：目前章節 chip＋進度格＋`k/N`＋右側 48dp `⌄`（整條可點，a11y「展開閱讀工具」）。右下：▶ 固定位置 `right = 8 + inset.right`、`bottom = 49 + inset.bottom(一般狀態凍結) + 12`；○ 在 ▶ 左邊 12dp，沉浸時隱藏；最後一章章尾且未完成時 ○ 展開成「○ 完成今日讀經」。下一章卡：一般狀態＋章尾＋非最後一章，顯示「繼續讀 詩99 ›」於 ○ ▶ 上方。狀態列、系統導覽列只在沉浸時隱藏。返回鍵：沉浸中 → 叫回並攔下；一般狀態不攔。

- [ ] **Step 1（RED）：** 在 `fullscreenReaderLayout.test.ts` 新增並改寫：
  - 章節籤：三個 chip，`多1` `accessibilityState.selected`，點 `詩99` 呼叫 `onSelectReference(1)`；
  - ○ ▶ 皆 56、水平間距 12、bottom 相同；一般→沉浸後 ▶ 的 style `bottom/right` 不變、○ 不見；
  - 沉浸時只出現收合細條（`多1`、`1/3`、`展開閱讀工具`），點細條 → 工具列回來；
  - `StatusBar hidden` 只在沉浸時為 true；
  - 返回鍵：沉浸中回傳 true 並叫回；一般狀態回傳 false；
  - `handleCanvasEdge({atEnd:true})`＋非最後章 → 「繼續讀 詩99」；最後章＋未完成 → 「完成今日讀經」；
  - 閱讀區容器 style 在一般與沉浸之間完全相同（不重排）；
  - 刪除舊斷言：膠囊、今日清單 Modal、置中沉浸播放、點擊切換。
  Run: `npx vitest run tests/ui/fullscreenReaderLayout.test.ts` → FAIL。
- [ ] **Step 2：** 實作 `useReaderChrome` 與版面；`CompletionAwardFeedback` 加 `bottomOffset`（未給時維持 `top: 82`）。
- [ ] **Step 3（GREEN）：** `npx vitest run tests/ui/fullscreenReaderLayout.test.ts tests/ui/readerLayoutContract.test.ts tests/ui/fullscreenReaderScreen.test.ts tests/ui/readerImmersionSettings.test.ts` 全過。
- [ ] **Step 4：** commit `feat(reader): layout A overlay chrome with collapsed progress bar`。

### Task 3：Tab 列不重排＋接線

**Files:** Modify `app/(tabs)/_layout.tsx`、`app/(tabs)/reader.tsx`；Test 相關 route 測試（`tests/ui/focusedReaderRoute.test.ts`、`readerDailyFlow.test.ts`、`readerAudioSelectionWiring.test.ts`）。

- [ ] **Step 1（RED）：** 讀經頁 options 的 `tabBarStyle`：一般為 `position:'absolute'`，沉浸為 `display:'none'`；其他頁不變。reader 傳 `onCanvasReveal`、`onCanvasEdge`、`canvasInsets`、`referenceLabels`，不再傳 `onCanvasTap`。
- [ ] **Step 2：** 實作。
- [ ] **Step 3（GREEN）：** 上列測試＋`npm run typecheck`。
- [ ] **Step 4：** commit `feat(reader): keep the reader scene size fixed when tabs hide`；同 commit 更新 `docs/design/reader-page.md` §5.1 為定案。

## RC

- [ ] 整合候選：`npm run typecheck`；受影響測試：`tests/ui/readerImmersionBridge.test.ts tests/ui/fullscreenReaderLayout.test.ts tests/ui/fullscreenReaderPadding.test.ts tests/ui/fullscreenReaderWrapper.test.ts tests/ui/fullscreenReaderScreen.test.ts tests/ui/readerLayoutContract.test.ts tests/ui/readerImmersionSettings.test.ts tests/ui/focusedReaderRoute.test.ts tests/ui/readerDailyFlow.test.ts tests/ui/readerAudioSelectionWiring.test.ts tests/ui/youVersionReader.test.ts`；`npm run verify:candidate`。依賴未變，不跑全套。
- [ ] 建 APK：`C:\w\q` 對齊候選 commit，照 NEXT-AI §3 建置；記 APK SHA-256。
- [ ] 實機（Pixel，`adb install -r`）：
  1. 一般狀態截圖：狀態列可見、日期（星期）、章節籤（多1 實心）、孤立「1」消失、小標加粗、○ ▶ 右下 56/12/同高、tab 列位置與公告頁相同；
  2. 往下捲 → 收合細條在上、▶ 同位置、tab/系統列隱藏；小幅上滑不叫回；大幅上滑叫回；
  3. 回章首叫回；捲到章尾叫回＋「繼續讀 詩99」；點卡片換到詩99；
  4. 沉浸中按返回鍵 → 叫回、不離開；之後再往下捲 → 再收合；沉浸中點經文 → 選取經節（不叫回、不切換）；點頂端細條 → 叫回；
  5. 章節籤切到詩100 並捲到底 → ○ 展開「完成今日讀經」（不按，避免改積分）；
  6. 沉浸中播放/暫停可按，位置不變；
  7. 錄 60 秒反覆下捲/上捲 10 次，確認沒有跳回章首；
  8. 結束時還原：回到一般狀態、今日章節，前景交還原 App。
- [ ] 交付：APK 路徑/SHA、候選 commit、實機截圖與錄影、未過清單。推分支＋開 PR（不 merge、不發布）。
