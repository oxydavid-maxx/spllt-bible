# 青牧青年 / Qingmu Youth

面向青年小組的讀經 App：每日進度、聖經閱讀、章節朗讀、小組資訊與提醒設定。

這是正在開發的 React Native/Expo 專案，Android 優先。此 repository 是可共同開發的原始碼快照，不代表所有功能已完成正式環境驗收。公開原始碼不會授予正式服務、既有會員資料或聖經內容的使用權限。

## 技術與目錄

| 目錄 | 用途 |
| --- | --- |
| `app/` | Expo Router 畫面與入口 |
| `src/` | 閱讀、音訊、帳號、提醒、同步及本機儲存 |
| `server/` | Node HTTP API、SQLite、Google 身份驗證與提醒服務程式 |
| `tests/` | Vitest 單元與整合測試 |
| `data/` | 2026 年 9 月讀經計畫與歷史規格輸入；不是會員資料 |
| `patches/` | YouVersion SDK 設定介面的最小擴充 |

核心依賴：Expo SDK 56、React Native 0.85、React 19、TypeScript、YouVersion React Native/Expo SDK、SQLite。

## 本機開始

需要 Node.js 24、npm，以及 Android 開發環境。此專案使用原生模組，請使用 development build；Expo Go 不能取代原生驗證。

```sh
npm ci
```

將 `.env.example` 複製為 `.env`。範例只開啟本機虛構成員模式，請勿用這份設定連接正式服務。

啟動本機 API：

```sh
node --env-file=.env --import tsx server/http.ts
```

另一個 terminal 啟動 Android App：

```sh
npm run android
```

`EXPO_PUBLIC_QINGMU_API_BASE_URL` 必須是裝置可連到的開發主機位址。Android emulator 通常使用 `http://10.0.2.2:8787`；實體手機使用開發主機的區域網路位址。不要把正式服務的設定、資料庫或金鑰加入 repository。

閱讀經文需要自行取得 YouVersion App Key，填入 `EXPO_PUBLIC_YOUVERSION_APP_KEY`，再將 `EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE` 設為 `true`。可用內容由官方 API 與該 App 的存取條件決定。

`npm ci` 會透過 `patch-package` 套用已追蹤的 SDK 擴充。升級 YouVersion SDK 時，請同時檢查 patch 是否仍適用。

## 驗證

```sh
npm run typecheck
npx vitest run tests/ui/unscheduledReaderRoute.test.ts tests/services/reminderRuntime.test.ts tests/integration/chapterAudioIdentityWiring.test.ts
```

開發時執行受影響的測試；`npm test` 可跑既有 Vitest 測試集合，但其中包含歷史 native candidate 檢查，乾淨 clone 尚不能保證全數直接通過。部分歷史驗證與 Windows/native 工具另有環境前提，請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。程式測試通過不等於手機的播放、通知或 Google 登入流程已驗證。

## 目前限制與可協作方向

- 譯本清單目前有限，尚未改為完整動態目錄；預設繁體和合本尚未完成。
- 音訊使用有限的逐章来源登錄，尚未提供跨譯本、完整錄音目錄的通用支援。未取得來源不等於官方沒有錄音。
- Reader 支援無排定進度日的自由閱讀；修改仍需真實 Android 驗證。
- 提醒程式與正式服務的部署狀態可能不同。本 repository 的後端包含開發中的提醒/FCM 邏輯，不代表正式遠端通知已接通或送達驗證已完成。
- Google 真實身份生命週期、Family Link、背景/鎖屏與完整通知送達仍有驗收工作。
- `data/` 部分檔案與驗證腳本保留早期規格，不能當成目前功能或正式部署已通過的證據。

歡迎先開 Issue 描述問題或提案，再以小範圍 PR 貢獻。優先方向包括通用譯本/音訊能力、提醒設定與送達、Android 可達性及測試可攜性。

## 授權與第三方內容

專案程式授權待維護者選定，尚未附加開源 LICENSE。第三方 SDK、字型、聖經譯本、音訊及其版權聲明仍遵循各自條款；repository 沒有打包完整聖經文本或音檔。音源網址與程式碼的公開，不構成第三方內容的再授權。
