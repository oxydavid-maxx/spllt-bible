import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAutoUpdateHold } from './useAutoUpdateHold';

/**
 * The dimmed area behind a modal sheet, laid out BESIDE the sheet rather than around it.
 *
 * Sheets used to sit inside their backdrop Pressable, with a do-nothing Pressable around the sheet to swallow
 * taps. A Pressable is an accessibility element, and iOS hides every descendant of one, so on an iPhone
 * VoiceOver — and XCUITest, which the simulator flows drive — found a single "關閉…" button and none of the
 * sheet's actions. As siblings, a tap on the sheet never reaches the backdrop, and both platforms reach every
 * action. `onPress` absent means the sheet holds work in progress and an outside tap does nothing.
 */
export function SheetBackdrop({ label, onPress, style, children }: { label: string; onPress?: () => void; style: StyleProp<ViewStyle>; children: ReactNode }) {
  // Every panel stands on this backdrop, so an open panel holds a downloaded update back (光佑 2026-10-21).
  useAutoUpdateHold(true, '面板開著');
  return <View style={style}>
    <Pressable
      accessible={onPress !== undefined}
      accessibilityRole={onPress ? 'button' : 'none'}
      accessibilityLabel={onPress ? label : undefined}
      onPress={onPress}
      style={StyleSheet.absoluteFill}
    />
    {children}
  </View>;
}
