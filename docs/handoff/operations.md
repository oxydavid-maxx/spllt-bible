# Operations

## Source與release

- Canonical local repo：`C:/dev/app/qingmu-bible`
- Public source：[oxydavid-maxx/spllt-bible](https://github.com/oxydavid-maxx/spllt-bible)，branch `codex/qm-gamification-v1`，HEAD `5ee870ca9beead8c07e9381eeb50a9eb65335aed`。
- Main未merge；最新APK未建立public release。
- 最新已安裝0.2.5/code7，SHA-256 `0dfabf3c55ec6aeb2375cc8d5d0663e21a3d59faede61326ec85f77ffbd68d24`，原signer `0721aa16599fe2d17b47f951f68e86137fad9c36b6f9db3115f4eb4124038d58`，四ABI各31個`.so`，audio=true/fixture=false/QA undefined且無QA URI。

## Android build

- Build tree保留在`C:/w/qm`，不要搬入本repo。
- Command：`powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Variant release`
- JDK `C:/dev/tools/qingmu-android/jdk-17.0.20.1+1`
- SDK `C:/dev/tools/qingmu-android/sdk`
- Gradle home `C:/g`，single worker；四ABI約10–15分鐘。
- 保留短路徑Ninja remedy。只有version變更時，guarded修改generated `android/app/build.gradle`兩行；不要跑Expo prebuild或改build system。
- `C:/w/qm`的Git common dir實際是`C:/dev/qingmu-youth-public/.git`，不可當成遺留物刪除。新repo產生candidate後，由build owner讓`C:/w/qm` fetch/checkout exact commit；不要假設兩者共享Git store，也不要為本次遷移重掛worktree。

Release build在同一個PowerShell process先載入private binding，再呼叫官方entry。不要輸出loader內容或任何env值：

```powershell
. 'C:/Users/User/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/QingmuYouthPilot/pilot-reader-build-config.ps1'
$env:QINGMU_GRADLE_USER_HOME = 'C:/g'
$env:QINGMU_ANDROID_TOOL_ROOT = 'C:/dev/tools/qingmu-android'
$env:QINGMU_RELEASE_SIGNING_PROPERTIES = 'C:/Users/User/Documents/Codex/qingmu-signing/qingmu-release-signing.properties'
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Variant release
```

Loader目前SHA-256是`354861c79c71c55c7e6ad336b26b7536d8e3042fcc53d57562dc78c1766336d0`；使用前只核對hash/存在性。它會綁定Google/YouVersion/API/audio production環境；不得把內容、private DB/config/signing複製到repo或receipt。

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

## Runtime compatibility dependencies

- Live backend：`C:/dev/apps/qingmu-youth`（不要整棵覆寫/搬走）。
- Health：`https://api.luminexhealthbiohack.com/api/health`。
- Runtime closure：34 files，最後aggregate `f36c7a249e9e1e75ff6bdf41ee7463645f7653145b3cfdf0070c6948ae81bdcc`；部署前fresh readback。
- Private authority：`C:/Users/User/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/QingmuYouthPilot`。
- `pilot-reader-build-config.ps1` SHA-256 `354861c79c71c55c7e6ad336b26b7536d8e3042fcc53d57562dc78c1766336d0`。
- Private config SHA-256 `2baa5b89b739e9758e5b4e826af857eadb649d579f5eb98ad544f65f71252023`。
- DB/config/signing bytes不可公開。Signing property path為`C:/Users/User/Documents/Codex/qingmu-signing/qingmu-release-signing.properties`。

## Device discipline

ADB：`C:/dev/tools/qingmu-android/sdk/platform-tools/adb.exe`；Pixel 11 Pro serial `67060DLKX001K0`。只能`install -r`，不可clear/uninstall；claim前核對pm version與device base.apk SHA。Native UI以fresh UIAutomator dump與screenshot為準；`could not idle`後的XML無效。Fingerprint只能由光佑真實操作。Gboard原輸入法`91ebcb74`，英文`5f09455b`；結束需恢復原輸入法。不要聲稱喇叭聲學驗證；media volume 0保持不變。

手機上的Obsidian QuickAdd launcher屬另一產品（`com.oxydavid.obsidian.newtask`），不可碰。
