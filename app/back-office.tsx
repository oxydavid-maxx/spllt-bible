import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackOfficePage } from '../src/ui/admin/BackOffice';
import { theme } from '../src/ui/Theme';

export default function BackOfficeScreen() {
  return <><Stack.Screen options={{ title: '後台規則與文件', headerShown: true, headerBackButtonDisplayMode: 'minimal', headerBackTitle: '返回' }} /><SafeAreaView edges={['bottom', 'left', 'right']} style={styles.page}><BackOfficePage /></SafeAreaView></>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
});
