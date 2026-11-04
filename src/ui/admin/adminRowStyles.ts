import { StyleSheet } from 'react-native';
import { theme } from '../Theme';
import { makeStyles } from '../useAppTheme';

/**
 * One row of the 管理者 card on 我的帳戶 (維護者 2026-10-31, mock A): title, a one-line note under it, and a › or a
 * switch on the right. The card and the 「管理者 · 只有你看得到」 heading are AdminSection's; a row never labels
 * itself 管理者 again.
 */
export const useAdminRowStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, minHeight: 56, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  text: { flex: 1, gap: theme.spacing.xxs },
  title: { color: colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  note: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  chevron: { color: colors.muted, fontSize: theme.type.body.size },
}));
