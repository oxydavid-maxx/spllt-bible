# 版本檔 (app-version.json) 格式與發版時怎麼改

> 2026-10-21 加 `ios` 區塊 (光佑 20261021: TestFlight 的 iPhone 也要看到「有新版本」)。App 怎麼讀、什麼時候提示，見 [features/account.md](features/account.md) 的「App 更新提示」。

## 放在哪

| 網址 | 誰讀 | 要不要 `ios` 區塊 |
|---|---|---|
| `VERSION_URL` (`src/services/updateCheck.ts`，跟 APK 安裝頁放在一起) | 0.5.16 以後的 Android 側載版、0.5.35 以後的 TestFlight iPhone | 要 |
| `LEGACY_VERSION_URL` (本 repo `announcements/app-version.json` 在 main 的版本) | 0.5.4–0.5.15 的 Android | 不用 (舊版只讀 Android 欄位，有也沒關係) |

CI 的模擬器流程不讀上面兩個：fixture 建置讀假資料後端的 `/api/fixture/app-version.json` (`server/fixtureVersionNotice.ts`)，內容永遠比 app.json 新一版。

## 格式

```json
{
  "versionCode": 61,
  "versionName": "0.5.36",
  "url": "https://<安裝頁>/",
  "mandatory": false,
  "note": "一行說明 (可省略)",
  "ios": {
    "testflight": { "buildNumber": 61, "versionName": "0.5.36", "note": "一行說明 (可省略)", "mandatory": false }
  }
}
```

| 欄位 | 誰讀 | 規則 |
|---|---|---|
| `versionCode`, `versionName`, `url`, `mandatory`, `note` | Android | 跟以前一樣，Android 只比 `versionCode` |
| `ios.testflight.buildNumber` | TestFlight 的 iPhone | TestFlight 上最新、測試者已經能裝的那個 build 的 build number. iOS 的 build number 由 `app.config.js` 從 Android versionCode 算出來，所以等於那次發版的 `android.versionCode`。iPhone 只比這個數字，比裝的大才提示 |
| `ios.testflight.versionName` | 同上 | 提示上寫的「有新版本 0.5.36」 |
| `ios.testflight.note`, `ios.testflight.mandatory` | 同上 | 跟 Android 同義，可省略 |
| `ios.appStore` | iPhone | 上了 App Store 才加，內容可以是 `{ "buildNumber": 61 }`。有這個欄位時，看不出是從 TestFlight 裝的 iPhone 一律不提示 TestFlight (App Store 裝的本來就不會提示) |

任何欄位格式不對，App 一律當作「沒有更新」，不會出現半套提示。舊版 App 只讀最外層 Android 欄位，`ios` 區塊不影響它們。

## 發版時怎麼改

1. **Android 發版**：照原本流程改最外層欄位，`scripts/verify-install-link.ts` 讀回。
2. **iOS 發版 (TestFlight)**：建置上傳到 App Store Connect, 等 TestFlight 處理完、測試群組裝得到之後，才改 `ios.testflight` 的 `buildNumber` 和 `versionName` (太早改，iPhone 按了「更新」在 TestFlight 裡還看不到新版)。同一次發佈的 Android 欄位和 `ios` 區塊可以不同步：各平台只看自己的欄位。
3. **讀回**：發佈後讀回 `VERSION_URL`, 確認 App 會怎麼判斷 (不連正式後端，只讀公開的版本檔)：

   ```sh
   npx tsx -e "import('./src/services/updateCheck.ts').then(async (m) => { const v = await (await fetch(m.VERSION_URL + '?t=' + Date.now())).json(); console.log({ android: m.readPublishedVersion(v), ios: m.readPublishedIos(v) }); })"
   ```

   `ios.testflight` 要是剛剛的 build; 印出 `testflight: null` 代表格式錯了，iPhone 不會提示。
4. **上了 App Store 那天**：在 `ios` 區塊加 `appStore`。App 本來就認得 App Store 的收據、不給它 TestFlight 連結；這一欄是給還沒有收據的 iPhone 的第二道保險。

## 依據

- `src/services/updateCheck.ts`：`readPublishedVersion` (Android)、`readPublishedIos`、`compareTestflight`、`fetchTestflightUpdateState`。
- `tests/services/iosTestflightUpdate.test.ts`：格式、比較、App Store 不提示、舊版 Android 讀到的不變。
