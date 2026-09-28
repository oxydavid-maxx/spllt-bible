# 讀經面板改用 App 自己的底部面板（拿掉 reanimated）——規劃、規格、自動測試計畫

狀態：規劃完成，實作中（2026-09-28）。範圍：前景/背景 CPU、記憶體、安裝檔大小，對標 YouVersion 11.32.1。不發布。

## 0. 一句話

YouVersion 閱讀套件的底部面板（設定、選章、選版本、經文動作列…）依賴 `@gorhom/bottom-sheet`，它再拉進 `react-native-reanimated` + `react-native-worklets`。這一組在 React Native 0.85 上多吃約 155 MB 原生記憶體，還讓畫面執行緒每一格都在跑動畫迴圈。改用 App 自己的輕量底部面板（React Native 內建 `Animated`，不另開 JS 引擎），外觀與操作不變。

## 1. 現況量測（同一支 Pixel、同一方法）

| 項目 | 竹科聖經 f1a3e62 | 拿掉 reanimated 的實驗版 | YouVersion |
|---|---|---|---|
| 原生記憶體（Native Heap 已配置） | 209–225 MB | **47–58 MB** | 67–69 MB |
| 前景待機總記憶體（PSS，含 swap） | 462–504 MB | **319 MB** | 333–359 MB |
| 前景待機主執行緒 CPU | 6.4–7.2% | 4.6–5.6% | ≈0% |
| 背景播放（關螢幕）CPU 平均 | 21.0% | 待量 | 18.1% |
| 安裝檔 | 64.8 MB | 63.9 MB（native 函式庫還在） | 63.2 MB（Play 分割後） |

## 2. 根因與證據

| 症狀 | 證據 | 根因 |
|---|---|---|
| 原生記憶體多 ~155 MB | 啟動 0.6 s 已 119 MB、2.7 s 到 211 MB；JS 堆積本身只有 28 MB（RN）+ 8 MB（worklets）。page-fault 取樣：最大宗是 Hermes 在 `expo::common::createClass`、`WorkletRuntimeInstaller` 裡清零記憶體。實驗版拿掉 reanimated 後降到 47 MB。上游同症狀：react/react-native#57059 的重現專案作者結論「多出來的是 reanimated 的 native runtime，不是 Hermes V1」（有 reanimated 657 MB / 沒有 503 MB）。 | reanimated 4 + worklets 0.8 在 RN 0.85 建第二個 Hermes runtime，Expo 再把所有原生模組類別裝進去一次 |
| 前景待機主執行緒 6–7% | simpleperf：55% 樣本在 `worklets AnimationFrameQueue`，每一格重新要下一格；畫面實際 0 格重繪 | 關著的面板仍掛著 reanimated 的逐格迴圈 |
| 拿掉後仍有 ~5% | 剩下的是 `FabricUIManager$DispatchUIFrameCallback`，原始碼 `finally { schedule(); }` 每格重排 | React Native 框架本身的設計（每個 RN App 都有），不在本次範圍 |
| 背景播放多 ~3 點 | 背景主執行緒原 5.8%；實驗版背景主執行緒只剩全程序的 2.4%（expo-audio 每 0.5 s 狀態回報＋media session 位置），大宗是 ExoPlayer/解碼，與 YouVersion 同型 | 背景差距主要也來自同一個迴圈 |

## 3. 解法選擇

| 做法 | 省多少 | 風險 | 結論 |
|---|---|---|---|
| **A. App 自己實作 gorhom 的小子集，Metro 把 `@gorhom/bottom-sheet` 指到它；reanimated / worklets 不打包、不連結** | 記憶體 −150 MB、待機 CPU −25%、安裝檔 −2 MB 級 | 面板手勢要自己做 | **採用**（業界常見：用平台內建動畫做底部面板） |
| B. 等上游修 reanimated / RN | 不確定 | 時間不可控 | 不採用 |
| C. 用 SDK 的 `setImpl('NativeSheet', …)` 換掉整個面板 | 同 A | 仍會 import gorhom → reanimated 照樣載入，省不到 | 不採用 |
| D. 換回舊版 Hermes | 無（上游已證實不是 Hermes） | 大 | 不採用 |

## 4. 詳細規格

### 4.1 使用者看到的行為（每個面板）

| 面板 | 打開方式 | 關閉方式（全部要能用） | 外觀 |
|---|---|---|---|
| 閱讀設定 | 閱讀器「Aa」/設定 | 「完成，返回閱讀」、系統返回鍵、點面板外暗處、往下拖把手 | 與現在相同：白底圓角、把手、暗色遮罩 |
| 選章 | 章節標題 | 同上＋選了章自動關 | 同上 |
| 選版本 | 版本標籤 | 同上＋選了版本自動關 | 同上 |
| 經文動作列（非強制，無遮罩） | 選取經文 | 取消選取、往下拖把手 | 同上，無遮罩，後面經文仍可點 |
| 螢光筆同意、YouVersion 登入 | SDK 觸發 | 同上 | 同上 |

- 打開：由下往上滑入約 250 ms；關閉：滑出約 200 ms。遮罩黑色 50% 淡入淡出。
- 高度＝內容高度（含把手），上限＝螢幕高度扣掉上方安全區。
- 內容還沒量到高度時先記住「要打開」，量到就打開（現在的 gorhom 會把這個指令丟掉）。
- 內容區（網頁）照常捲動；只有把手區可以往下拖關閉（內容是網頁，拖內容會和捲動打架）。這是唯一的操作差異；現在的版本在實機上拖與點遮罩本來就常常關不掉。

### 4.2 元件契約（`src/ui/sheet/bottomSheet.tsx`，實作 SDK 用到的 gorhom 子集）

| 匯出 | 必須支援 |
|---|---|
| `default BottomSheet`（forwardRef） | ref：`snapToIndex(0)`、`close()`；props：`index`（只用 -1）、`enableDynamicSizing`、`enablePanDownToClose`、`enableHandlePanningGesture`、`backdropComponent`、`backgroundComponent`（`null`＝不畫）、`backgroundStyle`、`handleComponent`（`null`＝不畫）、`handleIndicatorStyle`、`style`、`containerStyle`、`onChange(index)`、`onAnimate(from, to)`、無障礙屬性；其餘 gorhom 屬性（`animateOnMount`、`detached`、`bottomInset`、`activeOffsetY`、`enableContentPanningGesture`）接受但不影響 |
| `BottomSheetView` | 普通 `View`，回報內容高度給面板 |
| `BottomSheetBackdrop` | 全螢幕可點的暗色遮罩，`pressBehavior="close"` 點了關閉，隨開合淡入淡出 |

事件順序：開 → `onAnimate(-1, 0)` → 動畫結束 → `onChange(0)`；關 → `onAnimate(0, -1)` → 動畫結束 → `onChange(-1)`。

### 4.3 效能不變量（寫成測試與建置守門）

1. 打包的 JS 不含 reanimated / worklets（Metro 把它們解析成「未安裝」）。
2. APK 裡沒有 `libreanimated.so`、`libworklets.so`。
3. 面板開合動畫結束後，不留下任何進行中的動畫；關著的面板不跑任何逐格工作。
4. 動畫用原生驅動（`useNativeDriver: true`），拖曳中才用 JS。

### 4.4 建置與相依

- `metro.config.js`：`@gorhom/bottom-sheet` → `src/ui/sheet/bottomSheet.tsx`；`react-native-reanimated`、`react-native-worklets`（含子路徑）→ 丟出「未安裝」。
- `react-native.config.js`：reanimated、worklets 不做 Android/iOS 原生連結。
- `package.json` 不動：reanimated、worklets、Gorhom 是 YouVersion 套件的必要 peer 相依，npm 無論如何都會裝進 node_modules；移掉只會逼整套重裝。它們留在 node_modules，但不打包、不連結。
- `react-native-gesture-handler` 不動（輕量、無逐格工作）。

### 4.5 刻意不做

- 不改 React Native 本身每格排程（框架設計，要改只能 fork RN）。
- 不做音訊 offload / 調整 ExoPlayer（背景 CPU 已與 YouVersion 同型）。
- 不發布；不動後端。

## 5. 實作計畫

| # | 內容 | 檔案 |
|---|---|---|
| T1 | 面板元件（TDD：先寫會失敗的測試） | `src/ui/sheet/bottomSheet.tsx`、`tests/ui/leanBottomSheet.test.ts` |
| T2 | SDK 面板生命週期測試改綁新元件（用 SDK 已安裝的 `native-sheet.js` 原始碼跑） | `tests/ui/nativeSheetLifecycle.test.ts` |
| T3 | Metro 解析＋原生連結排除 | `metro.leanSheets.js`、`metro.config.js`、`react-native.config.js`、`src/ui/sheet/notBundled.js` |
| T4 | 建置守門：APK 不得含 reanimated/worklets | `src/config/apkBudget.ts`、`scripts/check-apk-budget.ts`、`tests/config/apkBudget*.test.ts` |
| T5 | 設定檔測試：Metro 與 RN 設定、相依清單 | `tests/config/leanSheetsWiring.test.ts` |
| T6 | 實機腳本：面板功能、效能對照、背景音訊 regression（自然熄螢幕，不鎖手機） | `C:\dev\machine\tmp\qm-0519\*.py` |

## 6. 自動測試計畫

### 6.1 元件測試（vitest，先紅後綠）

| 測試 | 期待 |
|---|---|
| 關著掛載時內容已渲染但不可點、無障礙隱藏 | 預熱網頁，不擋觸控 |
| 量到高度前 `snapToIndex(0)` → 量到後自動打開一次 | `onAnimate(-1,0)` 一次、`onChange(0)` 一次 |
| 打開後 `close()` | `onAnimate(0,-1)` → `onChange(-1)` |
| 遮罩 `pressBehavior="close"` 點擊 | 關閉；非強制面板（無遮罩）不渲染遮罩 |
| 往下拖把手超過門檻 / 未超過 | 關閉 / 回彈 |
| `handleComponent={null}`、`backgroundComponent={null}` | 不畫把手/底色 |
| 高度上限 | 內容比螢幕高時被截在上限 |
| 開合完成後沒有進行中的動畫 | 動畫計數歸零 |
| 所有動畫都用原生驅動 | `useNativeDriver: true` |
| SDK 真實 `native-sheet.js` ＋ 三個面板：開、完成鈕關、再開、返回鍵關、再開、`onChange(-1)` 同步 | 與現行行為相同 |

### 6.2 建置守門

| 守門 | 失敗條件 |
|---|---|
| `check-apk-budget`（每次建置自動跑） | APK 含 `libreanimated.so` / `libworklets.so`，或 JS bundle 含 `WorkletsModule` 字串 |
| 設定測試 | Metro 沒把 gorhom 指到 App 元件、reanimated/worklets 沒被擋、其他套件被誤擋；RN 設定沒排除原生連結 |

### 6.3 實機腳本（只回 PASS/FAIL 表，省 token）

| 腳本 | 驗什麼 | 通過門檻 |
|---|---|---|
| `sheets_check.py` | 設定/選章/選版本三個面板：打開看到內容、點遮罩關、返回鍵關、拖把手關；選取經文出現動作列、複製可用 | 全部 PASS |
| `perf_compare.py` | 冷啟動、前景待機（每個分頁）主執行緒 CPU、原生記憶體、PSS，與 YouVersion 同場量 | 原生記憶體 ≤ 80 MB；PSS ≤ YouVersion×1.1；主執行緒待機 ≤ 5.5%；無 worklets 逐格樣本 |
| `audio_check.py`（自然熄螢幕模式） | 背景朗讀 18 項 regression；背景 CPU/記憶體 | 18/18；背景 CPU ≤ YouVersion＋2 點 |
| APK | 大小 | ≤ 63.5 MB |

「自然熄螢幕」：按 HOME 後等手機依設定 10 分鐘自己熄螢幕，量 4 分鐘再喚醒。你的手機熄螢幕 30 分鐘後才上鎖，所以不會再把手機鎖住。

### 6.4 Regression

- vitest 全套（目前 231 個測試檔）、`tsc --noEmit`。
- 背景音訊 18 項、日曆補登、好友推播沿用既有實機腳本。

## 7. 驗收

全部 6.1–6.4 通過；對照表（竹科聖經 vs YouVersion）重量一次附在報告。

## 8. 風險與回滾

| 風險 | 對策 |
|---|---|
| SDK 升版改用 gorhom 的其他 API | 元件測試直接跑已安裝的 SDK 原始碼；缺 API 會紅 |
| 某個相依偷偷 import reanimated | Metro 解析成「未安裝」→ 選擇性 require 自動退回；bundle 守門擋 |
| 手勢手感不同 | 實機腳本驗四種關法；把手拖曳門檻 25% 高度或速度 0.5 |
| 回滾 | 還原本分支即可（無資料格式變更） |

## 9. 結果（2026-09-28，候選 APK `jhuke-bible-0.5.18-39-592dc5a.apk`，同一支 Pixel、同一時段）

| 項目 | 改前 f1a3e62 | 改後 592dc5a | YouVersion 11.32.1 | 門檻 | 結果 |
|---|---|---|---|---|---|
| 原生記憶體（已配置） | 209–225 MB | **51–61 MB** | 70 MB | ≤ 80 MB | 通過 |
| 前景待機總記憶體 PSS | 462–504 MB | **317–323 MB** | 347–369 MB | ≤ YouVersion×1.1 | 通過（比 YouVersion 少） |
| 前景待機整個 App CPU | 11.5% | **3.7%** | 0–3.4% | — | 接近 |
| 前景待機主執行緒（8 個分頁取樣） | 6.4–7.2% | 4.8–5.6% | ≈0% | ≤ 5.5% | 7/8 通過；剩下的是 RN 框架每格排程 |
| 背景播放 CPU（畫面開著、App 在 HOME 後面） | — | 22.4% | 22.4% | ≤ YouVersion＋2 | 通過（打平） |
| 背景播放主執行緒 | 5.8% | < 0.8%（不在前五名） | — | — | 通過 |
| 背景播放記憶體 | 434 MB（關螢幕） | 269 MB | 291 MB | — | 比 YouVersion 少 |
| 冷啟動（首畫面） | 119 ms | 127 ms | 834–977 ms | 不變慢 | 通過 |
| 安裝檔 | 64.8 MB | **62.5 MB** | 63.2 MB | ≤ 63.5 MB | 通過 |
| 面板實機（設定/選章 × 4 種關法、動作列、重開選章） | — | 22/22 | — | 全過 | 通過 |
| 背景朗讀 regression（畫面開著） | 18/18 | 19/19 | — | 全過 | 通過 |
| 外觀對照（設定、選章，改前 vs 改後截圖） | — | 相同 | — | 相同 | 通過 |
| vitest 全套 | base 42 個失敗 | 42 個失敗，**沒有新增**；修好 7 個原本壞掉的測試檔 | — | 不新增失敗 | 通過 |

鎖螢幕 regression（你在旁邊、按鍵關螢幕上鎖）：19/19，4 分鐘都在播、103→104 自動接下一章、背景 CPU 平均 14.2%（改前 21.0%；YouVersion 同方法 18.1%）、記憶體 255 MB。

## 10. 第二輪：發現的問題都修掉（2026-09-28，光佑「發現的問題都修掉」）

| 問題 | 根因 | 修法 | 驗證 |
|---|---|---|---|
| 閱讀設定面板最下排（字型）被底部分頁列蓋一半（改前就有） | 分頁列浮在經文上，只有「選取經文」時會讓開 | 設定 / 選章 / 版本面板打開時，分頁列和系統導覽列也讓開（沿用選取經文的做法） | 元件測試；實機 23/23（字型列完整可見、分頁列消失）；選章面板因此多出空間，把手可拖、背景可點 |
| 積分頁 6 個測試失敗 | 全是測試過時：公告頁多了「有新版」檢查（第二個請求是它，不是重複）、提案橫幅搬進分數卡、完成讀經控制器多一個 focus、提案要填多少/多久 | 測試改成跟 0.5.18 畫面一致 | 全過 |
| 發版建置的環境檢查 33 個測試失敗 | 腳本註解說「先驗輸入再動任何東西」，但依賴同步（可能重裝 node_modules）被放到驗證前面 | 驗證移回最前面；測試證明被拒絕的建置不會動 node_modules | 36/36 |
| 伺服器舊基準測試 3 個 | 錯誤格式、個人資料欄位已改；章節朗讀改成即時問 YouVersion，測試其實在連網 | 更新期待值；用錄下來的 YouVersion 回應離線測 | 全過 |
| 資料庫遷移、提醒到期測試 | 新增積分資料表；提醒改依伺服器讀經日 | 更新期待值 / 補讀經日 | 全過 |
| 兩個要讀 android/ 的測試 | android/ 是 prebuild 產生、只在建置資料夾有 | 沒有 android/ 時略過（在建置資料夾照跑，已驗證通過） | — |

全套：1859 通過、2 略過（上一列），0 失敗（連跑 4 次）。

偶發失敗（只在電腦很忙時出現，全是測試本身的時機問題，App 行為沒問題）：

| 測試 | 根因（有證據） | 修法 |
|---|---|---|
| 通知點擊導航 | 監聽器在 `import('expo-notifications')` 之後才註冊；第二次以後掛上時，vitest 的 `dynamicImportSettled()` 沒追到那一步（實測：它回來後還要 1 個 tick 才有監聽器），忙的時候就來不及 | 直接等到「監聽器已註冊」（最多 10 秒） |
| 積分頁日曆「切到年」 | 首次載入後 300 ms 會預抓其他區間；忙的時候預抓先跑完，點「年」直接用快取、不再發請求 | 改驗「年的資料有被讀過」（點擊或預抓都算） |
| 積分頁安全性 2 個 | 同一個 300 ms 預抓計時器在測試中途觸發，多出請求 | 這組測試用假時鐘，預抓不會自己跑 |
| 讀經頁捲動手勢 | 無頭 Chrome 結束後還佔著暫存資料夾，刪除時 EPERM | 刪除最多重試 5 秒 |
| 提案投票輪詢 | 多次真實 client 往返，忙時超過預設 5 秒 | 這個測試給 20 秒 |
