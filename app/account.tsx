import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountSurface } from '../src/ui/accountSurfaceComponent';
import { AdminAllScoresEntry } from '../src/ui/AdminAllScoresEntry';
import { theme } from '../src/ui/Theme';

export default function AccountScreen() {
  // The app draws under the system navigation bar (edge to edge) and this page has no tab bar to absorb
  // it, so the bottom edge stays in the safe area; the header already covers the top.
  // Minimal hides the visual title; an explicit back title also keeps the internal (tabs) name out of VoiceOver/XCUITest.
  return <><Stack.Screen options={{ title: '我的帳戶', headerShown: true, headerBackButtonDisplayMode: 'minimal', headerBackTitle: '返回' }} /><SafeAreaView edges={['bottom', 'left', 'right']} style={styles.page}><AccountSurface adminEntry={<AdminAllScoresEntry />} /></SafeAreaView></>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
});
