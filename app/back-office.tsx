import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackOfficePage } from '../src/ui/admin/BackOffice';
import { makeStyles } from '../src/ui/useAppTheme';

export default function BackOfficeScreen() {
  const styles = useStyles();
  return <><Stack.Screen options={{ title: '後台規則與文件', headerShown: true, headerBackButtonDisplayMode: 'minimal', headerBackTitle: '返回' }} /><SafeAreaView edges={['bottom', 'left', 'right']} style={styles.page}><BackOfficePage /></SafeAreaView></>;
}

const useStyles = makeStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.background },
}));
