# Operations

這份public文件只保存可公開的流程。機器專屬路徑、private binding、裝置識別碼、runtime地址與簽章設定位於Git ignored的`.handoff/operations-local.md`；release/deploy/device操作前必須先讀local補充，且不得把內容抄進log、issue或public receipt。

## Source與release

- Public source：[oxydavid-maxx/spllt-bible](https://github.com/oxydavid-maxx/spllt-bible)，branch `codex/qm-gamification-v1`。
- 產品程式基準是`9e6768b140f6bf977155127e1b5c1d31080daa5c`（0.2.8/code10：朗讀中經節灰底、目標獎品置頂＋獎品架、圖表快取、提醒預設 06:30 與滾輪）。
- `main`與branch同步至`c239a3e`；最新release tag `android-beta-2026-09-18-reading-highlight`（前一版`android-beta-2026-09-18-reading-calendar`）（前一版`android-beta-2026-09-17-continuous-reading`）。
- 正式release必須維持原package、release signer、四ABI、production audio enabled、fixture disabled、QA audio disabled，並從APK本體驗證manifest/signature/ABIs/embedded flags，不能只回報shell env。

## Android build

- 官方entry：`powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Variant release`。
- 使用既有短路徑native build tree、JDK 17、Android SDK與single Gradle worker；不要為handoff重建/重掛buildtree或改toolchain。
- 保留短路徑Ninja remedy。只有version變更時，guarded修改generated `android/app/build.gradle`兩行；沒有dependency/plugin/native config變更時不要跑Expo prebuild。
- Native build tree使用既有外部Git common store。新repo產生candidate後，由build owner讓buildtree fetch/checkout exact commit；不要假設兩者共享本repo的`.git`。
- Release build必須在同一個PowerShell process先載入local private binding，再呼叫官方entry；請從原生PowerShell啟動，不要從Git Bash派生的powershell（缺`Get-FileHash`會在Gradle前失敗）。Exact loader、hash與env bindings見`.handoff/operations-local.md`。

## Source map與focused checks

- 路由入口：`app/(tabs)/reader.tsx`、`app/(tabs)/progress.tsx`。
- Reader UI/連播：`src/ui/YouVersionReader.tsx`、`src/services/readerAutoplayController.ts`、`src/services/audioChapterResolver.ts`。
- Reader cache/fetch seam：`src/services/readerAdapter.ts`及對應server routes。
- Gamification domain/API：`src/domain/gamificationV1.ts`、`src/services/gamificationApiClient.ts`、`server/gamification.ts`、`server/routes.ts`。
- UI/權限邊界：`src/ui/gamification/PeopleList.tsx`、`ScoreProfile.tsx`、`ScoreProfileChart.tsx`、`FriendQrPanel.tsx`、`RewardControls.tsx`、`RedemptionList.tsx`、`ActionSheet.tsx`。
- Reminder：`src/services/reminder*`與`server/reminder*`。

先按改動跑單一或少數test files，再跑`npm run typecheck`；不要重跑歷史整包來探索。例如：

```powershell
npx vitest run tests/ui/readerAutoplayNativeFlow.test.ts tests/ui/youVersionReaderAutoplay.test.ts
npx vitest run tests/server/gamificationV1.test.ts tests/domain/gamificationV1.test.ts tests/ui/gamificationApiClient.test.ts
npx vitest run tests/ui/gamificationProgressRoute.test.ts tests/ui/gamificationProgressSecurity.test.ts
npx vitest run tests/ui/gamificationComponents.test.ts tests/ui/gamificationNativeComponents.test.ts
npm run typecheck
```

## Runtime與device邊界

- Live backend、private DB/config/signing與native build tree是外部runtime compatibility dependencies，不搬進本repo、不整棵覆寫，部署前做fresh readback。
- 部署只同步exact runtime closure，先做consistent SQLite backup；不得改ledger/schema/Google private config，且只停止已確認由本產品擁有的process。
- 手機只用in-place install；不可clear/uninstall。Claim前核對version與device-installed APK hash，UI證據以fresh UIAutomator dump/screenshot為準。
- 生物辨識只接受產品owner實際操作；不可mock/bypass。不要把畫面可見當成喇叭聲學驗證，也不要改使用者既有輸入法/音量狀態後不恢復。
