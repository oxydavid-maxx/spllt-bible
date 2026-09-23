# W0：Google Play 交付可用度

日期：2026-09-23（UTC）  
狀態：**BLOCKED：目前可見的 Google 帳戶沒有 Play Developer Console，無法確認現存 Play app record、測試軌、簽章或產生真實測試安裝連結。**本 lane 僅查核，沒有建立帳戶、上傳或發布。

## 查核結果

| 項目 | 證據與狀態 |
|---|---|
| App identity/version | 乾淨 `origin/main` worktree 的 `app.json`：`org.qingmu.youth`、`0.5.9`、`versionCode 30`。fresh `git ls-remote origin refs/heads/main` = `f561b83d8719d12ee55d2a1c5466a9cbbcab3074`。 |
| 公開商店頁 | 直接開啟官方 Play URL `https://play.google.com/store/apps/details?id=org.qingmu.youth`，Google Play 回覆「找不到你要求的網址」。目前沒有可驗證的公開商店下載頁。 |
| Developer Console | 目前 Chrome 已登入的 Google 身分導到 `https://play.google.com/console/signup`，畫面要求建立 Play 管理中心開發人員帳戶；未顯示可選 app、track 或 tester。這只證明目前登入身分無可用 Console，不能證明其他帳戶下不存在此 package 或 private/internal release。 |
| Track/tester/link | 無可見 track、tester 清單或現存 opt-in/install link。尚未產生 internal testing link 或 internal app sharing link。不能用猜出的商店 URL 當已上架或可安裝證據。 |
| Publisher API | 在 app repo 的 scripts/ops/source/workflow 搜尋 Android Publisher API、自動化與相關變數名，沒有找到已配置的 Play Publisher 路徑；目前程序環境也沒有對應的 publisher API 變數名稱。這是本機配置查核，不代表其他機器或未登入帳戶沒有 API。 |
| 現有 release | 前次 release receipt 記錄 owner beta `0.5.9/code30`，source `ff125ca35ab67aa5a9cb572455409a79a9cf2349`，APK SHA-256 `3c50cbfb7e6cd9cb82c90612d1e6a3b777abc074ff3d5d0b6355fcc19358fba7`、163,664,657 bytes；receipt 的 asset readback 已驗證。本機 `r5` APK 的 SHA-256 與該資產相同。它是 GitHub APK 證據，不是 Play 發布。 |
| Signing | Android release script 將 signing source 記為 `owner-controlled-release-keystore`。本機 APK 的 signer certificate fingerprint 未能讀出：Android SDK `apksigner` 因目前環境未設定 `JAVA_HOME` 且找不到 `java` 而退出；沒有讀取任何 keystore/password。Play app-signing/upload certificate 仍須由有權限的 Console owner 查驗。 |
| AAB | `scripts/build-android.ps1` 支援 `-Variant release -Bundle`，執行 `bundleRelease` 並輸出 `android/app/build/outputs/bundle/release/app-release.aab`。Google Play 對新 app 要求 Android App Bundle，且 AAB 必須以 upload key 簽署後交給 Play App Signing；internal app sharing 可收 AAB 或 APK。正式 track 仍要 app record、適用的 signing 設定及實際 release。 |
| 手機連線 | 僅執行一次唯讀 `adb devices -l`：USB serial `67060DLKX001K0`，Pixel_11_Pro，狀態 `device`。未使用舊 TCP serial，未開畫面或輸入。由此命令沒有讀取安裝版 version/signature。 |
| 原 dirty 基線 | 原 checkout HEAD `7fba578`。在寫 receipt 時重新精確比對，只有 2/4 檔與 base manifest 相符：`tests/server/chapterAudioCapability.test.ts` 與 `tests/server/reminderWorker.test.ts` 相符；`package-lock.json` observed SHA-256 `82fbbdf6f0cbfc9a888c22fc7d2e86b9f89a27c8ecd62ca7784bb4fddad8c352`（expected `c5c906fc8e232798bc49cc6fafad35acc409f4d247ca6876f63078404b186a67`）及 `server/contentRegistry.ts` observed `e464a071bb6eca562121569a384a6d8727c5d8ff7f52711500589b4f615f3cdb`（expected `d5de9827223072dc9648b5f5e42e79ac620b776888b925e0069da475775595a8`）不符。差異何時/由誰造成無法從本 lane 判定；我沒有寫入這些檔案，也沒有 stage/reset/stash。 |
| Backend | 前次 release receipt 記錄 pin `79ecbe89e8b5be8e856342e0b5fad8f65896e844`、health `ok`；receipt 記錄時間為 `2026-09-23T08:14:59Z`。這是先前 receipt 值，W0 沒有重新探測 live backend。 |

## 可用路徑與尚需確認

- **Internal testing track：**取得既有 app owner 的 Console 權限後，確認 `org.qingmu.youth` app record 與 Play App Signing/upload certificate，將簽署的 AAB 上傳到 internal track、設定 tester access 並發布；Google 說 internal test app 由 URL 提供，完成 release 才能複製真實 opt-in link。
- **Internal app sharing：**有 `Release apps to testing tracks` 權限的授權 uploader 可上傳 APK 或 AAB 並產生 IAS link；Google 會用 IAS key 重新簽署，tester 需開啟 Play Store 的 internal app sharing。這是方便安裝的 Play 內分享路徑，不能當正式 track release 或既有 production signing 的證明；link 上限與到期規則見官方說明。
- **正式商店頁：**只有在 package 已於 Play 建立並符合發布/審查條件後，才可讀回 listing/install 狀態。現在 public URL 回覆 not found，不能宣稱可下載。

## 精確 blocker / 下一步

1. 由真正持有此 app / Google Play 開發者帳戶的帳戶 owner 確認 app 是否已註冊；若在另一帳戶，邀請負責人進入該 Console，並授予上傳/測試所需權限。若尚無帳戶，由法律/身分權利人自行決定及完成帳戶類型、驗證與必要平台流程；本 lane 不代作身份聲明或註冊。
2. 在可用 Console 讀回 package、App signing certificate、upload certificate、現有 tracks/tester lists。比對既有 `owner-controlled-release-keystore` 的公開 certificate fingerprint；若 upload key 不相符，依 app 的實際 Play 狀態走官方 reset/註冊流程，不能從本機推定可更新。
3. 對 internal track 產生並發布簽署 AAB；或明確選 IAS 並上傳 AAB/APK。只在 Console 產生真實 link 後，使用有權限 tester 開啟 link、確認 app 可安裝並記錄安裝版號與 signing/source binding。

## 官方依據

- [Internal app sharing：上傳 AAB/APK 後產生 link、權限、IAS 重新簽署與 tester 設定](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en)
- [設定 internal、closed、open testing：internal testing 透過 URL 提供給 testers](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en)
- [Android Developers：Play App Signing 與 upload key 的分工](https://developer.android.com/studio/publish/app-signing)
- [Google Play app status：internal testing、production 等發布狀態](https://support.google.com/googleplay/android-developer/answer/9859751?hl=en)

safe metadata receipt：`.handoff/compact-20260923/distribution-metadata.json`。

