import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The strip at the bottom of an AppModal window that it now shares with the Android navigation bar (src/ui/AppModal.tsx
 * makes that bar transparent over the panel, 2026-11-05). A panel that does not lay itself out with SafeAreaView keeps
 * its content above this strip, where the content ended before. An iPhone's Modal never changed, so it is 0 there: the
 * one place this platform difference is decided.
 */
export function useModalNavigationBarInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'android' ? insets.bottom : 0;
}
