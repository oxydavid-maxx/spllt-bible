# ScoreProfile chart delta

這次把 `ScoreProfile` 的既有六個月圖表改成共用的 earned-score chart。自己、好友與管理者都使用同一個 `ScoreProfileChart`；好友回應只包含公開的總積分、梯隊與 chart，後端仍省略 `private`。

## Range contract

`GET /api/points/profiles/:memberId` 保留原本的 `anchorMonth` 與 `months` 六桶欄位。新 client 可選擇附加：

```text
chartRange=week|month|year|all
chartAnchor=YYYY-MM-DD  # week
             YYYY-MM     # month
             YYYY         # year
```

省略 chart query 時，server 回傳目前 `anchorMonth` 的 month chart，讓舊 client 忽略 optional `chart` 仍能運作。回應的 `chart` 會帶 `range`、正規化後的 `anchor`、`periodStart`、`periodEnd`、`earnedPoints`、`buckets`、前後期間 anchor；`all` 以有紀錄的年份作桶，沒有 active 紀錄時回傳空桶與 0。

切換週/月/年/全部時省略 `chartAnchor`，由 server 以 Taipei today 選擇目前期間；期間內的箭頭才會送出明確 anchor。

| Range | Buckets | Anchor / navigation |
|---|---|---|
| 週 | Taipei calendar Mon-Sun 7 daily buckets | `YYYY-MM-DD`，前後週；未來週不提供 next |
| 月 | 該月每一天 daily buckets | `YYYY-MM`，前後月；未來月拒絕 |
| 年 | 12 個 monthly buckets | `YYYY`，前後年；未來年拒絕 |
| 全部 | 有 earned history 覆蓋的 yearly buckets | 不需要 anchor 或 arrows |

## Aggregation rules

- 所有 chart amount 都只從 `daily_point_entitlements WHERE active = 1` 依 `task_date` 聚合，語意時區是 `Asia/Taipei`。
- current period 的 future calendar dates 只呈現 0；不由 UI 填入示例得分。
- `REDEMPTION_DEBIT`、`REDEMPTION_REVERSAL` 與 wallet balance 不參與 chart，因此兌換不會降低 earned history、總積分或 chart total。
- 已成立的 legacy active awards 即使其 `task_date` 晚於目前 Taipei 日期，也屬於 earned history，read projection 會保留；只有不存在實際 award 的未來 calendar day 才顯示 0。
- inactive entitlement 不進 chart；completion reversal 由 active 狀態改變而反映回原 task date。

## UI behavior

`ScoreProfileChart` 顯示 `週/月/年/全部` 的 48dp range controls、前後期間箭頭、期間標籤與本期 earned total。bars 共用 zero baseline 與依實際值定位的整數 y-axis；0 值不渲染綠色 bar，也不放一層全高灰色 track。每個 bucket 是可被 screen reader 讀取的資料圖像，accessibility label 包含日期/期間與 points；圖表下方以實際 48dp 前後資料柱控制項及 adjustable selection 讀取/切換選取值，避免 31 個 daily bars 變成窄小的假 48dp targets。

既有沒有 `chart` 的 response 會隱藏 range selector/period arrows，顯示誠實的「近六個月」六桶 monthly fallback 與合計；不把 legacy `months` 解讀成日資料。

既有未帶 `chart` 的 profile fixture 會退回 `months` 的 month chart，保留 client 與舊 server 相容。箭頭或 range 改變時由 profile route 以同一 member/scope 重新查詢 chart；admin scope 的既有 unlock lifecycle 仍是必要條件。

## Evidence and remaining proof

Focused tests cover Taipei Monday-Sunday weeks, Dec/Jan boundary, daily month buckets, 12 month year buckets, all-history year buckets, future period rejection, bounded early-year anchors, active/inactive rows, redemption independence, empty zero charts, friend private-field stripping, client query encoding, latest chart response wins, and rendered accessibility labels/48dp controls.

The chart was rendered through the existing React test renderer with a synthetic fixture only; this is not release data. A native Pixel/phone proof is still required for actual dp measurement, no horizontal overflow, and visual confirmation on the production font/device. Garmin Reports documentation was used as a timeframe reference, not as a claim of exact Garmin UI reproduction.

The same real component was also bundled with the existing `esbuild` + `react-native-web` + `ReactDOM` toolchain into `.tmp/score-profile-chart-preview.html`. Browser readback at the preview's 390px content width found 31 accessible data images, 11 rendered green bars, 0 persistent grey tracks, all bar bottoms at the same baseline, eight chart/range/data navigation controls at 48px high, and `scrollWidth === clientWidth`. The preview uses only the synthetic TEST fixture in `.tmp` and is not part of the app bundle.
