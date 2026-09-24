import { router, Tabs, usePathname } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { ComponentRef, Ref } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from '../../src/ui/Theme';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { taipeiDate } from '../../src/domain/gamificationV1';
import { useAuthSnapshot } from '../../src/services/authSession';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import { getReadingSessionSnapshot, requestTodayReaderTabPress, setJournalEntryDate } from '../../src/ui/readingSession';
import { useReaderImmersionSnapshot } from '../../src/ui/readerImmersionState';

export default function TabsLayout() {
  const readerImmersed = useReaderImmersionSnapshot();
  const auth = useAuthSnapshot();
  const memberId = auth.session?.memberId ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? fixtureProfile.memberId : null);
  const pathname = usePathname();
  // Reader is a hidden sibling route; keep its visible reading entry selected for users and screen readers.
  const readerRouteSelected = pathname === '/reader';
  const accountEntry = () => <AccountEntryButton />;
  return (
    <Tabs
      initialRouteName="today"
      screenListeners={({ route }) => ({
        tabPress: event => {
          if (event.defaultPrevented) return;
          if (route.name === 'today') {
            // Diary is another surface of the same reading session. Returning from it must not
            // run the explicit Today-entry reset or remount the shared audio owner.
            if (pathname === '/journal') {
              event.preventDefault();
              router.replace('/reader');
              return;
            }
            requestTodayReaderTabPress(taipeiDate(), memberId, auth.epoch);
            return;
          }
          if (route.name === 'journal' && pathname !== '/journal') {
            const entryDate = pathname === '/reader' ? getReadingSessionSnapshot().selectedDate : taipeiDate();
            setJournalEntryDate(entryDate);
          }
        },
      })}
      screenOptions={{
        headerShown: true,
        headerRight: accountEntry,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: readerImmersed ? { display: 'none' } : undefined,
      }}
    >
      <Tabs.Screen name="announcements" options={{ title: '公告', headerShown: false, tabBarAccessibilityLabel: '公告', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="bullhorn-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="today" options={{
        title: '讀經',
        headerShown: false,
        headerRight: accountEntry,
        tabBarAccessibilityLabel: '讀經入口',
        tabBarButton: ({ ref, accessibilityState, 'aria-selected': ariaSelected, ...buttonProps }) => {
          const logicalSelected = readerRouteSelected || Boolean(ariaSelected ?? accessibilityState?.selected);
          return (
            <Pressable
              {...buttonProps}
              ref={ref as Ref<ComponentRef<typeof Pressable>> | undefined}
              aria-selected={logicalSelected}
              accessibilityState={{ ...accessibilityState, selected: logicalSelected }}
            />
          );
        },
        tabBarLabel: ({ color }) => <Text style={{ color: readerRouteSelected ? theme.colors.primary : color, fontSize: 12, fontWeight: '600' }}>讀經</Text>,
        tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="book-open-page-variant-outline" color={readerRouteSelected ? theme.colors.primary : color} size={size} />,
      }} />
      <Tabs.Screen name="progress" options={{ title: '積分', tabBarAccessibilityLabel: '積分', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="chart-line" color={color} size={size} /> }} />
      <Tabs.Screen name="journal" options={{ title: '日記', headerShown: false, tabBarAccessibilityLabel: '靈修日記', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="notebook-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="reader" options={{ href: null, title: '讀經閱讀器', headerShown: false, tabBarAccessibilityLabel: '讀經閱讀器', freezeOnBlur: false }} />
      <Tabs.Screen name="groups" options={{ href: null, title: '讀經', headerShown: false }} />
    </Tabs>
  );
}
