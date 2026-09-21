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
      <Tabs.Screen name="today" options={{ title: '讀經', headerShown: false, headerRight: accountEntry, tabBarAccessibilityLabel: '讀經入口', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="book-open-page-variant-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="progress" options={{ title: '積分', tabBarAccessibilityLabel: '積分', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="chart-line" color={color} size={size} /> }} />
      <Tabs.Screen name="announcements" options={{ title: '公告', headerShown: false, tabBarAccessibilityLabel: '公告', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="bullhorn-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="journal" options={{ title: '日記', headerShown: false, tabBarAccessibilityLabel: '靈修日記', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="notebook-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="reader" options={{ href: null, title: '讀經閱讀器', headerShown: false, tabBarStyle: { display: 'none' }, tabBarAccessibilityLabel: '讀經閱讀器' }} />
      <Tabs.Screen name="groups" options={{ href: null, title: '讀經', headerShown: false }} />
    </Tabs>
  );
}
