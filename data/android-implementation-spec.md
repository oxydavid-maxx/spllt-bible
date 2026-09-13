# 青牧青年Android App：實作規格

版本：2.0／2026-09-08。用途：直接供程式實作與驗收；不另做展示頁。  
決策：**先確認並實作C；只有C確定不可交付才採B。**  
本文件取代先前以網頁為主要使用介面的方案。九月讀經資料、身份/完成/積分一致性要求繼續沿用。

## 1. 固定定義與目前判斷

| 名稱 | 定義 | 目前狀態 |
|---|---|---|
| C | 青年App內以YouVersion SDK閱讀、切換核准版本、中文朗讀、完成、積分與gamification | **YouVersion SDK reader integration已完成；1392/312文字、對照版本、授權與九月42章覆蓋證據已綁定可用；中文音訊與Family Link仍未通過，尚不能宣稱C可交付** |
| B | 同一個青年App保存進度與積分，閱讀/朗讀開外部YouVersion App後返回 | 僅作C確定不可交付時的替代；目前不啟用為預設 |
| LINE | OpenChat公告、提醒/遮名積分摘要、小組交流與RPG入口；通話可開核准的Meet/Zoom | 不作每天讀經/登入的必經入口 |

產品閱讀與音訊來源限定YouVersion SDK/其正式核准能力；其他來源只保留在研究與授權核對資料，不進入本App作為替代reader或audio provider。不得把未核准來源改稱B，也不以候選資料宣稱可用。

使用者對獨立App家長時間管理及同App綁定完成/積分已表示同意；這是需求確認，不是已在實機通過測試。

## 2. Assertion與來源核對

| ID | 可依賴的結論 | 實作限制 |
|---|---|---|
| A01 | YouVersion官方Kotlin SDK提供BibleReader、BibleText及版本篩選 | 需要Platform App Key與對應出版者license；不能假設所有中文版本都可取用 |
| A02 | SDK程式碼採Apache 2.0 | 這不是經文/錄音的重製、離線或散布授權 |
| A03 | 本次查閱的公開Platform端點及Kotlin/Swift reader未列足以使用的audio playback/download介面 | 不猜測私有端點、不擷取YouVersion App快取、不用已下載檔案推論可重散 |
| A04 | 直接分享Bible.com經文連結可用 | 屬B/外部閱讀路徑，不能當成C音訊內嵌已成立 |
| A05 | eBible.org明示繁體新標點和合本為public domain，提供開發格式 | 可作離線文字候選，仍要保存來源、版本與資料校驗；不能把文字授權套到別處錄音 |
| A06 | Wordproject列有Mandarin/CUV下載音訊，公開條款限非營利、音檔原樣、保留授權條款 | 第三方App的散布/離線包裝與權利人範圍需核對後才能列為核准素材；目前是候選，不宣稱已核准 |
| A07 | Family Link可按已安裝App設定限時或Unlimited time | 需家長准許安裝與配置；不能把PWA、LINE網頁或Chrome網站當作已知獨立配額 |
| A08 | App的完成、積分與gamification可以由我們自己保存 | 不依賴YouVersion完成API；播放結束/開連結本身不是閱讀理解的證明 |

### 2.1 本次已檢查的程式碼

- YouVersion Kotlin SDK：commit `6975afe565dd8e21ce23d18f5fc6f215a51f349c`，README與platform-reader公開來源。
- YouVersion Swift SDK：commit `a3eb7ddfbdc93a06db37f49b7582e702b99c642e`，README與Reader公開來源。
- YouVersion React SDK：commit `555c094cb8a3c91b32feea011564807545f623d9`，reader與匯出入口。

這是「查到的公開介面中沒有音訊交付證據」，不等於斷言YouVersion永遠不會提供合作音訊能力。缺少App Key或尚未取得答覆屬待確認，不能假裝C已失敗。

### 2.2 本次實際查看的Platform目錄

在未登入的官方Bible directory中，以Chinese篩選可見FEB、CCB、CCBT、CSBS、CSBT五項。其中CCBT是繁體當代譯本，Bible ID 1392、語言碼zh-Hant-TW，列入Biblica Fast-track Bible License - v1；CSBT是繁體中文標準譯本，Bible ID 312。這是公開目錄的當次觀察，不是我們已取得內容license，也不是任何中文音訊已被授權。

該篩選結果未見和合本；不要由YouVersion消費者App有和合本，推論Platform SDK也已提供相同目錄。下一步以本App/組織權限核對實際內容與音訊能力。

## 3. C的放行條件與B啟用條件

### 3.1 C至少必須通過

1. 一個教會核准的繁體中文共讀版本，能呈現九月全部26日的每一段內容。
2. 對應中文朗讀可在青年App內播放，九月所有必要章節覆蓋完整；文字版別、神/上帝用語及音訊版別有明確對應。
3. 有可保存的授權依據，明確涵蓋實際用途：App內串流；若做離線，另確認快取/打包/再下載範圍。
4. 在Android原型播放至少一章，確認格式、播放/暫停、返回、錯誤及背景/鎖屏行為；不以HTTP成功或網址存在代替播放測試。
5. Family Link在家長允許的設定下辨識青年App，確認閱讀時間不依賴先開LINE。App到限、裝置鎖定與背景播放按家長預期驗證。

MVP先支持一個有音訊的共讀版，其他一至兩個版本作文字對照；新增版本由內容能力清單控制。不得把某個版本的音訊標成另一個版本。

september-content-requirements.json已列出26個任務所需的42個不同章節及其日期對應，實作者逐項填入來源、版別與授權狀態。約12:27–50仍保留原任務範圍；若音訊只有整章且沒有已驗證的逐節時間點，須標示整章朗讀，不猜測開始秒數或修改任務。

### 3.2 決策狀態

| 狀態 | 何時使用 | 允許做什麼 |
|---|---|---|
| C_PENDING_ACCESS | 缺App Key、出版者license或音訊合作答覆 | 完成規格、共用核心與隔離測試；不宣稱C已可交付，不自動切B |
| C_TECHNICAL_PROBE | 已有合法可測素材與明確用途 | 製作最小原型驗證閱讀、播放與家長控管 |
| C_READY | 上述五項有實際證據 | 以C為首版閱讀方式，實作完整功能 |
| C_NOT_AVAILABLE | 供應者明確不提供/不允許必要素材，或實測證明關鍵需求無法達成且沒有獲准替代 | 才啟用B，寫明原因與受影響功能 |

B不能因為暫時網路失敗、忘了填Key或想提早交差而自動取代C。C與B共用同一份成員、日曆、完成及積分資料；只切ReaderAdapter。

## 4. App技術邊界

Android原生交付為先，使用React Native/Expo + TypeScript共用Android/iOS App shell；YouVersion以官方React Native/Expo SDK接入。音訊使用可替換AudioProvider與原生播放元件，只有授權素材進入播放清單。套件版本依Expo 56/React Native 0.85/YouVersion SDK相容矩陣鎖定，不套用未測試的最新版本。

| 模組 | 責任 | 不應承擔 |
|---|---|---|
| app-shell | Today/Reader/Progress/RPG四個入口，登入與錯誤顯示 | 不重做聊天平台，不顯示兌獎資訊 |
| identity | Google登入優先、可選LINE綁定、member_id與固定小組對應 | 不用姓名/email當唯一鍵；不繞過Family Link第三方授權 |
| reading-plan | 載入既有september-2026.json、選當日與保留原列 | 不去重、不移日期、不補週日 |
| reader | 根據ReaderMode走C內嵌或B外連；顯示當日全部段落 | 不把點開/停留時間當完成 |
| content-registry | 可用版本、音訊對應、授權與離線能力 | 不猜中文版本ID，不默認全部開放 |
| playback | 播放/暫停/進度/錯誤/已批准的背景播放與快取 | 不抽取其他App私有檔、不改造未准修改的錄音 |
| completion | 本人勾選、撤銷、版本衝突、離線待送與去重 | 不因播放器結束就無條件發積分 |
| points | 唯一完成事件→可配置計分政策→帳目/彙總 | 不實作禮物商店或未提供的兌獎規則 |
| cooperation | 每週小組共同進度、個人累積、同頁可選理解題 | 不強制RPG出席打卡、不以分數推論靈命 |
| notifications | App自己的讀經提醒，後端LINE摘要 | 不讓LINE通知成為唯一取得進度方式 |
| rpg-links | 顯示本人固定小組/RPG並開啟LINE OpenChat社群入口與核准外部Meet/Zoom | 不自建語音、配對、錄音、通話長度計分；連結未核對時顯示待設定 |

## 5. 內容與音訊合約

ContentRegistry只接受有來源證據的條目。至少包含：

```text
TextVersion: id, provider, providerVersionId, displayName, language, script,
             edition, divineNameVariant, licenseRef, attribution,
             streamingAllowed, offlineAllowed, approvedAt, evidenceHash
AudioEdition: id, provider, narrator, language, matchingTextVersionId,
              matchingEvidence, licenseRef, streamingAllowed, offlineAllowed,
              modificationAllowed, attribution, approvedAt, evidenceHash
AudioChapter: audioEditionId, book, chapter, uri, expiresAt,
              sha256IfDownloadable, durationMsIfKnown, coverageStatus
ContentCapability: text=true/false, audio=true/false, offline=true/false,
                   status=pending/approved/unavailable, reason
```

規則：

- 配置未核准時，禁止拿候選音訊進正式App包或正式快取。
- 下載只使用提供者明確開放的檔案/接口，保留完整來源與授權文件；YouVersion App內的個人下載不算我們的分發來源。
- 音檔到期、缺章或不可用時顯示明確狀態；不偷偷換另一個譯本或用TTS冒充原有朗讀。
- 沒有離線授權就只做獲准串流；快取必須遵循提供者允許期限/容量，不把技術快取宣稱為永久離線版。
- B外連只傳章節與版本資訊，不夾帶Google/LINE身份token或名單。

## 6. 帳號、完成與積分

後端驗證Google/選配LINE ID token，以(provider, sub)綁定member_id。首次使用邀請碼或同工核對固定歸屬；之後完成操作直接綁本人。若同一人連接第二個供應者，必須在已驗證身份下明確綁定，不能同名自動合併。

YouVersion Platform的開發者登入/App Key與青少年的App會員登入分開。閱讀SDK的個人YouVersion登入提示預設關閉；單純讀已授權經文不要求每個青年再登入第二個帳號。未來若要同步個人螢光標註等YouVersion資料，才以獨立且可選的綁定處理。

Completion主鍵為(member_id, plan_id, task_date)。狀態區分UNREPORTED、NOT_COMPLETED、COMPLETED；UI的PENDING_SAVE不等於保存成功。每個修改請求帶operation_id和expected_revision；同ID重送回原結果，舊revision衝突返回目前狀態。

離線資料放本機資料庫與outbox，重新連線後同步；只有權威保存完成才更新正式積分。積分帳目依completion_event+policy_version去重。完成→撤銷→再完成的淨結果只能相當於一次有效完成。數值規則留可配置值，首版不增加兌獎畫面。

本人可見原名，其他人只收到遮名，例如O文O。遮名在後端套用，其他原名不放在學生收到的JSON、串流或匯出。週/月分母沿用任務日有效名單，不由當下在線人數決定。

## 7. Gamification實作規則

| 循環 | 觸發與完成 | 系統回饋 | 反刷分/人際邊界 |
|---|---|---|---|
| 每日 | 當日照表閱讀/聆聽，本人確認完成 | 個人積分與完成數增加，小組週進度前進 | 同任務唯一，點連結不算，補讀按配置 |
| 每週合作 | 當週已到期任務×各日有效名單形成共同進度 | 小組達到配置目標時在App/LINE摘要顯示共同成果 | 比例為主，不因人多天然領先；未回報不等於未讀 |
| RPG角色（LINE帶領建議，非App功能） | 在既有RPG輪流帶一句經文/一個問題/一件近況，再彼此代禱 | 下一次可換角色；不在App建立足跡或出席頁 | 無強制表單、錄音或通話量計分 |
| 月度回歸 | 個人累積完成，週目標定期重新開始 | 新加入與恢復參與者也有當週可達目標 | 漏一天不清空全部成果 |
| 後續關係/邀同學 | 自願完成合作/關心/邀請合適活動 | 未來配置共同任務回饋 | 不記私密朋友名單，不以對方信仰選擇評分 |

同頁理解題是可關閉學習模組：引用當日經文，提示、重答，不另開頁、不阻擋讀經完成。正式加分規則不由AI任意裁判。

RPG角色只是LINE聚會中的帶領玩法。首版App不做角色分配、聚集足跡或出席管理，只提供OpenChat社群入口與核准的外部通話連結。

## 8. LINE與RPG

App內是即時進度；LINE OpenChat採每日/每週摘要，避免每次完成都洗版。OpenChat能力只按已核對的原生功能使用，不能宣稱有未存在的API。公告、讀經入口、每週成果/積分摘要、固定小組與RPG入口均以社群角色分工呈現；真實聊天室連結尚待管理者核對。

RPG入口位於LINE OpenChat社群；固定成員自行約，通話可開核准的外部Meet/Zoom。這會使用LINE/外部App本身的時間與權限，需要家長允許相應RPG時段；青年App不能替外部通話拆出獨立額度。

## 9. 對程式的必要介面

```text
ReaderAdapter.open(task, selectedVersion) -> nativeReader | externalYouVersion
TextProvider.resolve(reference, versionId) -> licensed text + attribution
AudioProvider.resolve(book, chapter, editionId) -> licensed playable source
ContentGate.evaluate(registry, requiredSeptemberCoverage) ->
  C_PENDING_ACCESS | C_TECHNICAL_PROBE | C_READY | C_NOT_AVAILABLE
CompletionRepository.setStatus(member, task, status, operationId, expectedRevision)
PointsService.apply(completionEvent, policyVersion) -> idempotent ledger update
ProgressService.snapshot(date/period, viewer) -> masked and versioned aggregate
NotificationPublisher.publishSummary(groupScope, period, revision) -> receipt/status
```

核心API沿用先前的任務/完成/進度合約；新增GET /api/content-capabilities供App決定可展示的版本與功能。ContentGate不放在前端任意切換；C/B決策、來源與例外要有版本與理由。

## 10. 實作順序與完成定義

1. **內容核對先行：**取得YouVersion Platform App Key/可用license清單及中文音訊正式能力；或核對可合法下載來源的適用範圍。素材未核准不做正式散布。
2. **C最小原型：**只做一日、一版本、一章音訊、完成控制；確認真機播放及家長控管。無美化、無排行榜裝飾。
3. **共用核心：**Google身份、九月26日資料、本機保存/outbox、完成去重、簡單積分與組別統計。
4. **補齊C覆蓋：**九月所有必要章節的文字/音訊、版本切換、背景與失敗處理。
5. **只有C_NOT_AVAILABLE才打開B：**保留同App核心，ReaderAdapter開YouVersion後恢復原任務。
6. **LINE整合與試行：**既有RPG入口、合適頻率的提醒/摘要、幾個自然排程日驗證。

必要assertions：

- C_READY時，九月任何已排日期都能在App內取得已核准文字與對應中文音訊。
- C_PENDING_ACCESS不被當成C_NOT_AVAILABLE；不偷偷切B。
- 沒有音訊權利/內容證據，不打包檔案、不顯示已可離線。
- 家長控管以真正安裝的青年App測試，不用瀏覽器/PWA截圖代替。
- 只開閱讀/播放結束，不自行推論本人已確認完成。
- 重送、更正、雙裝置與斷線不多給積分；同步保留原日期。
- 同一人不同登入方式不產生兩份身份/分數；其他人原名不出現在成員回應。
- RPG通話仍是既有LINE，不做額外排程表或配對服務。

## 11. 尚待取得的輸入與不得誤報的狀態

| 輸入/證據 | 用途 | 未取得時 |
|---|---|---|
| YouVersion Platform App Key及已接受的版本license | 驗證實際可用中文文字，不只看metadata | 1392 CCBT文字探測handoff已接受；仍不把單一文字探測當成完整C_READY |
| 中文音訊正式接口/素材與適用授權 | 驗證C核心朗讀 | 不宣稱C已可做完，不把原App下載當授權 |
| 可用Android建置工具鏈及測試裝置 | 原生編譯、安裝、播放/Family Link測試 | 是建置/驗證條件，不是C失敗證據 |
| 家長允許的Google第三方登入與App限時設定 | 實機身份與使用可行性 | 不繞過、不假裝已通過 |

截至2026-09-08，App reader code與YouVersion SDK route已完成；內容owner已交付私有process-only App Key、CCBT 1392（當代譯本(繁體)、zh-Hant-TW、Biblica）及CSBT 312（中文標準譯本(繁體)）文字/對照handoff，九月42章覆蓋證據已綁定。這證明受控文字與對照版本可用；中文音訊、Family Link及完整C_READY證據仍待核對。因此目前仍是**C_PENDING_ACCESS**，不是C_READY，也不是已決定改B。

YouVersion文字handoff已接受，但App Key只可在建置/執行程序內使用，不寫入source、receipt或公開包。現有handoff沒有已核准的中文音訊接口/播放器交付證據；音訊及Family Link未通過前，不顯示可朗讀或可離線的承諾。

## 12. 實作依據

- [YouVersion Kotlin SDK與LICENSE](https://github.com/youversion/platform-sdk-kotlin/blob/6975afe565dd8e21ce23d18f5fc6f215a51f349c/README.md)
- [YouVersion API Usage](https://developers.youversion.com/api-usage)
- [YouVersion版本license](https://developers.youversion.com/api/licenses)
- [YouVersion授權錯誤說明](https://developers.youversion.com/error-codes)
- [YouVersion Copyright FAQ](https://help.youversion.com/l/en/article/o8t2xmy9q2-copyright)
- [eBible繁體和合本來源與格式](https://ebible.org/bible/details.php?id=cmn-cu89t)
- [Wordproject中文音訊](https://www.wordproject.org/bibles/audio/04_chinese/index.htm)
- [Wordproject音訊與分發條款](https://www.wordproject.org/contact/new_chinese/disclaim.htm)
- [Family Link App時間](https://support.google.com/families/answer/7103028?hl=en)
- [Google身份驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [LINE群組Messaging API](https://developers.line.biz/en/docs/messaging-api/group-chats/)

本文件給實作者使用，沒有另外製作展示頁。與先前web方案衝突時，以本文件的C優先/B備援、App資料歸屬與內容放行條件為準。
