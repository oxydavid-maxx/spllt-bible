# origin/main test harness sync (2026-09-24)

- RC before merge: $mergeBaseHead on codex/qm-compact-rc.
- Incoming origin/main: 8abab27a867f18c9cd44ae693e35573f88b7d7d3, a fast-forward descendant of the original 561b83d8719d12ee55d2a1c5466a9cbbcab3074 base.
- The incoming commit changes nine test/config files and no product source, dependencies, lockfile, or version metadata.

## Named conflict resolutions

- 	ests/ui/compactToday.test.ts: kept the W1 R01 tests that the visible Today tab selects Taipei today and redirects to Reader, and that four visible tabs remain. The older Today-home/account/sign-in/completion assertions described a screen that now intentionally returns 
ull and redirects, so they were not restored. Replaced the fixed 	aipeiDate mock with a fake clock at 2026-09-23T04:00:00Z (12:00 in Taipei) and the real 	aipeiDate() implementation so the route assertion remains deterministic and exercises the timezone conversion.
- 	ests/ui/focusedReaderRoute.test.ts: kept W1 review03's dynamic immersion contract: Reader's per-screen 	abBarStyle is unset; the parent Tabs layout hides the visible bar only while the shared immersion state is active, then restores it. The incoming static display: none assertion would keep tabs hidden outside immersion, so it was not carried forward. Reader remains a hidden route and the visible tabs retain the account entry.

The remaining test doubles, Vitest aliases, stale expectations, browser headless-shell selection, and React Native ScrollView mock updates from 8abab27 were merged unchanged. The exact merged candidate must pass the selected integrated pack before build.
