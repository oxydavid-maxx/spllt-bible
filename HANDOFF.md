# 青牧讀經 App handoff

這是新session的最小入口。先讀：

**2026-09-23 最新狀態：** 先讀 [0.5.9 接手單 r4](docs/handoff/HANDOFF-20260923-r4.md) 與 [code review 摘要](docs/reviews/2026-09-22.md)。本機受限證據保存在 Git 忽略的 `.handoff/work-20260923/`；不要公開日記、測試 session 或相機畫面。

1. [docs/handoff/README.md](docs/handoff/README.md)
2. [已核准 Detailed Implementation Design Spec v1.0](docs/design/reading-gamification-v1.md)
3. [docs/handoff/product-context.md](docs/handoff/product-context.md)
4. [docs/handoff/operations.md](docs/handoff/operations.md)
5. [docs/handoff/evidence-index.md](docs/handoff/evidence-index.md)
6. [docs/handoff/acceptance-status.md](docs/handoff/acceptance-status.md)

產品程式已透過 [PR #2](https://github.com/oxydavid-maxx/spllt-bible/pull/2) 合併至 `main`；0.5.9/code30 APK 建自 `ff125ca`。Public repository 為 [oxydavid-maxx/spllt-bible](https://github.com/oxydavid-maxx/spllt-bible)；`spllt-bible` 是核准名稱。

目前 Pixel 安裝 Android 0.5.9/code30 個人試用版。高亮、系統掃碼預覽與取消已在 Pixel 核實；以下條件尚待家庭/後續驗收：

- 兩個獨立 Google 帳號的好友 QR／可見性／移除，仍缺真機驗收。
- 一人三票的上限，在**單一成員**的系統上永遠觸發不到（規則是一人一案，所以最多只會有一個提案）。它由 5 個伺服器測試與 6 個畫面測試成立，不是由實機成立。
- 飛航模式下的排隊與回送，未在遠端驗證過：關掉網路會同時切斷遠端偵錯的連線。
- 關閉提案輪次、核准／婉拒提案、兌換與反轉，皆會動到正式資料，未在正式帳號上執行。

已發布 [0.5.9 pre-release](https://github.com/oxydavid-maxx/spllt-bible/releases/tag/android-beta-2026-09-23-0.5.9)，其 APK 的直接網址已寫入 `announcements/app-version.json` 並線上回讀。這只完成光佑個人試用階段；家庭測試通過前不提供學生。

Local-only歷史/evidence在`.handoff/`（Git ignored）。工具payload與secret-shaped values已從session-history匯出排除。
