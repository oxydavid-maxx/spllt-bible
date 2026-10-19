import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useViewerCapabilities } from '../services/viewerCapabilities';
import { requestOpenAllScores } from '../services/allScoresRequest';
import { theme } from './Theme';

/**
 * 全體 (管理), faded at the bottom of 我的帳戶 (維護者 2026-10-14). Shown only to an account the
 * server says may view all scores; the 積分 screen still asks for the device unlock before opening it.
 */
export function AdminAllScoresEntry() {
  if (!useViewerCapabilities()?.canViewAllScores) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="全體 (管理)" onPress={() => { requestOpenAllScores(); router.navigate('/progress'); }} style={styles.entry}>
    <Text style={styles.text}>全體 (管理) ›</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  entry: { minHeight: theme.control.tap, alignSelf: 'stretch', justifyContent: 'center', marginTop: theme.spacing.xxl },
  text: { color: theme.colors.borderStrong, fontSize: theme.type.label.size, fontWeight: '600' },
});
