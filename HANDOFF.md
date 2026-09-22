# 青牧讀經 App handoff

這是新session的最小入口。先讀：

**2026-09-17 Fable 接手補充：** 本機接手請先讀 Git ignored 的 `.handoff/FABLE-HANDOFF.md`，內含最新使用者回饋、未提交修正、路徑搬移現況及完整剩餘主線；不要將本機交接或私人附件公開。以下版本狀態是既有已安裝基準，不包含該補充中的未發布修改。

1. [docs/handoff/README.md](docs/handoff/README.md)
2. [已核准 Detailed Implementation Design Spec v1.0](docs/design/reading-gamification-v1.md)
3. [docs/handoff/product-context.md](docs/handoff/product-context.md)
4. [docs/handoff/operations.md](docs/handoff/operations.md)
5. [docs/handoff/evidence-index.md](docs/handoff/evidence-index.md)
6. [docs/handoff/acceptance-status.md](docs/handoff/acceptance-status.md)

產品程式基準是 branch `codex/qm-gamification-v1`、commit `5ee870ca9beead8c07e9381eeb50a9eb65335aed`。本handoff文件會以後續docs-only commit保存；不要把該文件commit誤當成新的產品candidate。Public repository為 [oxydavid-maxx/spllt-bible](https://github.com/oxydavid-maxx/spllt-bible)；`spllt-bible`是核准名稱，不要更正拼字。

最新安裝候選為 Android 0.5.7/code28（2026-09-22）。不要把「已完成所有產品驗收」當成現況，以下各項各有各的理由未驗：

- 兩個獨立 Google 帳號的好友 QR／可見性／移除，仍缺真機驗收。
- 一人三票的上限，在**單一成員**的系統上永遠觸發不到（規則是一人一案，所以最多只會有一個提案）。它由 5 個伺服器測試與 6 個畫面測試成立，不是由實機成立。
- 飛航模式下的排隊與回送，未在遠端驗證過：關掉網路會同時切斷遠端偵錯的連線。
- 關閉提案輪次、核准／婉拒提案、兌換與反轉，皆會動到正式資料，未在正式帳號上執行。

public APK 尚未 release，`main` 尚未 merge（落後產品分支 34 個 commit 以上）。

Local-only歷史/evidence在`.handoff/`（Git ignored）。工具payload與secret-shaped values已從session-history匯出排除。
