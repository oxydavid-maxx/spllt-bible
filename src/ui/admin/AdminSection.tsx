import { StyleSheet, Text, View } from 'react-native';
import { useViewerCapabilities } from '../../services/viewerCapabilities';
import { AdminAllScoresEntry } from '../AdminAllScoresEntry';
import { BackOfficeEntry } from './BackOffice';
import { AdminOtaUpdatesEntry } from './OtaUpdates';
import { theme } from '../Theme';

/**
 * 我的帳戶的「管理者」區塊 (維護者 2026-10-31，選 A：「同意：我的帳戶管理入口照 A 收成一個管理者區塊」). The three
 * administrator entries used to be drawn three ways: a card marked 管理者 ›, a card whose note began 只給管理者：,
 * and a faint 全體 (管理) › at the foot of the page that read like the delete link. Now one heading says who sees
 * it, once, over one card of three rows. Everyone else sees nothing; the rows share one capabilities lookup.
 */
export function AdminSection() {
  if (!useViewerCapabilities()?.canViewAllScores) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>管理者 · 只有你看得到</Text>
    <View style={styles.card}>
      <AdminAllScoresEntry />
      <View style={styles.divider} />
      <BackOfficeEntry />
      <View style={styles.divider} />
      <AdminOtaUpdatesEntry />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing.xs, marginTop: theme.spacing.xs },
  heading: { color: theme.colors.muted, fontSize: theme.type.label.size, fontWeight: '700', paddingHorizontal: theme.spacing.xs },
  card: { borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, backgroundColor: theme.colors.surface, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
});
