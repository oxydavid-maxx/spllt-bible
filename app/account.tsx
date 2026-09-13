import { Stack } from 'expo-router';
import { AccountSurface } from '../src/ui/accountSurfaceComponent';

export default function AccountScreen() {
  return <><Stack.Screen options={{ title: '我的帳戶', headerShown: true }} /><AccountSurface /></>;
}
