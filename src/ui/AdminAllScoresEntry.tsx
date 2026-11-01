import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useViewerCapabilities } from '../services/viewerCapabilities';
import { requestOpenAllScores } from '../services/allScoresRequest';
import { adminRowStyles } from './admin/adminRowStyles';

/**
 * 全體, the first row of the 管理者 card on 我的帳戶 (AdminSection). It used to sit faded at the foot of the
 * page (維護者 2026-10-14), which read like the delete link; since 2026-10-31 it sits with the other two
 * administrator rows. Shown only to an account the server says may view all scores; the 積分 screen still
 * asks for the device unlock before opening it, and only then shows its 全體 (管理) tab.
 */
export function AdminAllScoresEntry() {
  if (!useViewerCapabilities()?.canViewAllScores) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="全體" accessibilityHint="每個人的積分、在哪邊聚會、手機版本" onPress={() => { requestOpenAllScores(); router.navigate('/progress'); }} style={adminRowStyles.row}>
    <View style={adminRowStyles.text}>
      <Text style={adminRowStyles.title}>全體</Text>
      <Text style={adminRowStyles.note}>每個人的積分、在哪邊聚會、手機版本</Text>
    </View>
    <Text style={adminRowStyles.chevron}>›</Text>
  </Pressable>;
}
