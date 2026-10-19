# JavaScript/圖片更新 (EAS Update)

> 2026-10-19 決定；首次啟用隨 0.5.35 商店建置發布。本 PR 保留目前版號，由維護者發版時調整。

## 相容與頻道

| 項目 | 規則 |
|---|---|
| 可 OTA | 已有原生能力下的 JavaScript、文字、樣式、圖片等資源修正 |
| 必須上架 | 新增/改變原生套件、權限、config plugin、SDK/React Native、原生設定，或新的 runtime |
| runtimeVersion | `appVersion`，取 `app.json` 的 `version`；每次商店發版改 version，同一 version 的安裝才收得到同一 runtime 的更新 |
| production | 正式 Android 本機 Gradle 與 iOS EAS Build 的預設頻道 |
| preview | 管理者先驗收；EAS preview 建置也預設指向這裡 |

本機 Gradle 在 `expo prebuild` 時從 `app.config.js` 寫入 `updates.requestHeaders['expo-channel-name'] = production`；不是只在 `eas.json` 設定。EAS 的兩個 build profile 同時明列 channel。更新網址從既有 EAS projectId 衍生。

每個 JS 冷啟動只在畫面掛載後檢查一次，背景下載，下次完整關閉並重新開啟才套用。不輪詢、不監聽回前景、不呼叫 `reloadAsync()`；讀經和朗讀不中斷。離線、檢查/下載失敗不顯示錯誤頁，保留嵌入/快取版本。原生 `checkAutomatically: NEVER` 避免重複檢查，`fallbackToCacheTimeout: 0`、`useEmbeddedUpdate: true`、`disableAntiBrickingMeasures: false` 保留快速啟動與復原。

## 管理者手機

在帳戶頁底部管理區切換「先收到測試版更新」。說明：「只給管理者：先拿到還沒發給大家的修正，驗收用。」沿用既有伺服器 `canViewAllScores` 身分判斷，一般成員看不到。

開啟呼叫官方 `Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': 'preview' })`；關閉傳 `null` 回到建置頻道。選擇存在這支手機的原生儲存，不改伺服器頻道對應。切換不立即下載/重載：下次開啟背景下載，再下一次開啟套用；畫面會提示這件事。`Updates.channel` 在下次冷啟動後讀回選擇。preview 與 production 必須保持本機資料格式相容，避免切回後讀不到先前資料。

只使用 request-header API；不使用需要關閉防變磚保護的 `setUpdateURLAndRequestHeadersOverride()`。

## 發送流程 (本文件不會自動執行)

以下命令由維護者在核准發送時執行。員工實作/CI 不發布更新，也不改頻道對應。CLI 固定使用既有 EAS Build 的 24.13.0；SDK 56 發送時必須帶 `--environment`，兩個頻道都使用同一個 production 環境，避免 API/功能旗標漂移。執行前確認沒有 `CI=true` 搭配 `QINGMU_CI_DISABLE_OTA_CHECKS=1`，也沒有 fixture/test date 等測試旗標。

1. 確認商店已安裝包含 expo-updates 的版本，原生相容、version/runtime 相同。記錄 source commit、runtime、兩平台、更新前的 production update group ID；第一個 OTA 沒有前一組時記錄嵌入版本。維護者先確認 preview/production 已各連到預定分支。
2. 在固定且乾淨的來源匯出/檢查；本機測試允許這兩條，不會上傳：

   ```sh
   npx expo export --platform android --output-dir dist-android
   npx expo export --platform ios --output-dir dist-ios
   ```

3. 發送 preview，保存輸出的 update group ID、runtime 與每平台的 update ID：

   ```sh
   npx eas-cli@24.13.0 update --channel preview --environment production --platform all --message "修正說明" --json
   ```

4. 光佑在管理區開啟開關，完整關閉 App 後重開，等背景下載；再完整關閉重開，驗收可見的小字變更、讀經、朗讀、登入與既有功能。確認管理者手機所見內容和該 preview update group 相符。
5. 光佑驗收後，把這一組更新原樣重發到 production，**不重新 export/build**。下列 `<已驗收的 group ID>` 必須使用第 3 步保存的 ID；republish 會建立新的 group ID，但沿用已驗收的程式/資源：

   ```sh
   npx eas-cli@24.13.0 update:republish --group <已驗收的-group-ID> --destination-channel production --platform all --message "preview 驗收通過" --json
   ```

6. 保存新 production group ID 與其來源 preview group ID。管理者關閉開關，按上述兩次冷啟動流程確認 production；其他成員在後續冷啟動收到更新。

## 回復

若上一組 OTA 已驗證可用，將那一組重新送到 production，不重新打包：

```sh
npx eas-cli@24.13.0 update:republish --group <上一組已驗證可用的-group-ID> --destination-channel production --platform all --message "回復上一版" --json
```

若這是第一組 OTA，或要退回商店內嵌版本，CLI 支援對目前該 branch/runtime 最新 group 執行 rollback；它會重發前一組，沒有前一組才送出回到 embedded 的指令。先核對 group 身分，勿把 preview 的 ID 當成 production：

```sh
npx eas-cli@24.13.0 update:rollback <目前-production-最新-group-ID> --platform all --message "撤回問題更新" --json
```

這些操作不會即時重啟所有手機。可正常啟動的手機要連網冷啟動下載復原，再重新開啟套用；啟動崩潰由保留的 expo-updates 復原機制處理，不保證能挽救任何任意資料遷移，因此仍須保持資料格式相容。沒有網路時繼續用現有本機版本。

## CI 隔離

只有 `CI=true` 且 `QINGMU_CI_DISABLE_OTA_CHECKS=1`，並且沒有 EAS build profile/`EAS_BUILD=true` 與正式 Gradle 簽章旗標 `QINGMU_RELEASE_SIGNING_PROPERTIES` 時，`extra.otaCheckEnabled` 才設 false；兩個原生套件仍啟用，可驗官方 header API，但不呼叫正式更新服務。EAS production/preview 與本機簽章正式建置即使繼承 CI 旗標仍會檢查。一般本機 Gradle 正式建置不可設定這組 CI 專用旗標。測試會守住正式設定；iOS CI 使用記憶體假資料管理者驗證切換持久化，不發布 OTA。

## 依據

- [Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)
- [Deployment](https://docs.expo.dev/eas-update/deployment/)
- [SDK 56 Updates API](https://docs.expo.dev/versions/v56.0.0/sdk/updates/)
- [Channel surfing](https://docs.expo.dev/eas-update/channel-surfing/)
- [Override 設定與防變磚限制](https://docs.expo.dev/eas-update/override/)
- [EAS CLI update/republish/rollback](https://docs.expo.dev/eas/cli/)

命令參數已用 `npx eas-cli@24.13.0 <command> --help` 核對；未實際發布。實測發送/同組推廣由維護者在 0.5.35 上架後完成。
