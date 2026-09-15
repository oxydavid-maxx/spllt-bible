# Evidence index

Local-only evidence位於`.handoff/archive/`，由`.git/info/exclude`排除。

- `source-tmp/`：原source `.tmp`測試、手機、API與設計proof。
- `native-receipts/`：`C:/w/qm/docs/receipts`完整release receipts與歷史APK。
- `origin-attachments/`：原session的exact images；session ID只保存在local private context。
- `removed-from-old-obsidian/origin-thread-attachments/`：從舊ec5b Obsidian worktree移出的同一組15個attachments，作為可回復原件；active Vault已無該thread附件。
- `vault-cleanup/2026-W38-系統建議.before.md`：live Vault週檢視清理前exact snapshot；只移除7條已失效qingmu legacy repo建議，其他bytes保留。
- `rollback-manifest.json`：原path→archive path、bytes、SHA-256與runtime dependency位置。
- `../session-history.md`/`.json`：只含user/assistant文字，tool payload與secret-shaped values已排除。

關鍵proof：

- 最新release receipt：`.handoff/archive/native-receipts/modal-hide-5ee870c-release-proof.json`
- 0.2.2品質總結：`.handoff/archive/source-tmp/device-quality-v022-20260915/quality-report.md`與`quality-receipt.json`
- 0.2.5 modal proof：`.handoff/archive/source-tmp/redemption-quality-20260915/v025-device-receipt.json`及`quality-report.md`
- Full approved spec：[../design/reading-gamification-v1.md](../design/reading-gamification-v1.md)

0.2.4的15秒screenrecord只有1 frame，不能當15秒PASS。使用0.2.5 timestamped repeated UI dumps/screens作為穩定性證據。

Vault內`2026-09-14.md`與`2026-09-15.md`提到App的是個人daily反思prompt，分類為incidental user records，特意保留；不要把字串搜尋結果當成可刪開發殘留。
