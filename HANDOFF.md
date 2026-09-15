# 青牧讀經 App handoff

這是新session的最小入口。先讀：

1. [docs/handoff/README.md](docs/handoff/README.md)
2. [已核准 Detailed Implementation Design Spec v1.0](docs/design/reading-gamification-v1.md)
3. [docs/handoff/product-context.md](docs/handoff/product-context.md)
4. [docs/handoff/operations.md](docs/handoff/operations.md)
5. [docs/handoff/evidence-index.md](docs/handoff/evidence-index.md)
6. [docs/handoff/acceptance-status.md](docs/handoff/acceptance-status.md)

產品程式基準是 branch `codex/qm-gamification-v1`、commit `5ee870ca9beead8c07e9381eeb50a9eb65335aed`。本handoff文件會以後續docs-only commit保存；不要把該文件commit誤當成新的產品candidate。Public repository為 [oxydavid-maxx/spllt-bible](https://github.com/oxydavid-maxx/spllt-bible)；`spllt-bible`是核准名稱，不要更正拼字。

最新安裝候選為 Android 0.2.5/code7，APK SHA-256 `0dfabf3c55ec6aeb2375cc8d5d0663e21a3d59faede61326ec85f77ffbd68d24`。不要把「已完成所有產品驗收」當成現況：兩個獨立Google帳號的好友QR/可見性/移除仍缺真機驗收；public APK尚未release，main尚未merge。

Local-only歷史/evidence在`.handoff/`（Git ignored）。工具payload與secret-shaped values已從session-history匯出排除。
