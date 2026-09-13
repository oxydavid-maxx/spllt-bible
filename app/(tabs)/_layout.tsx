import { Tabs } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from '../../src/ui/Theme';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';

export default function TabsLayout() {
  const accountEntry = () => <AccountEntryButton />;
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerRight: accountEntry,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="today" options={{ title: '今日', headerShown: false, tabBarAccessibilityLabel: '今日讀經', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="home-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="reader" options={{ title: '讀經', headerShown: false, headerRight: accountEntry, tabBarStyle: { display: 'none' }, tabBarAccessibilityLabel: '讀經入口', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="book-open-page-variant-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="progress" options={{ title: '進度', tabBarAccessibilityLabel: '個人與小組進度', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="chart-line" color={color} size={size} /> }} />
      <Tabs.Screen name="groups" options={{ title: '小組', tabBarAccessibilityLabel: '小組與RPG入口', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-group-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
