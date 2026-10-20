import { CongregationLine } from './CongregationLine';

/**
 * 我的帳戶 → 「我在主堂聚會 (不是青少)」 and 「改」 (維護者 2026-10-17; worded with "我" and changed through the same
 * sheet as the 積分 page since 2026-10-20). One setting, one line, one sheet: see CongregationLine.
 */
export function CongregationSetting() {
  return <CongregationLine variant="account" />;
}
