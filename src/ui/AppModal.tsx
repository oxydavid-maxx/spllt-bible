import { useEffect, useState } from 'react';
import { Modal, type ModalProps } from 'react-native';
import { useAppTheme } from './useAppTheme';

/** How long after the app changes scheme a panel that is open redraws its system bars (see below). */
export const SYSTEM_BARS_SETTLE_MS = 200;

/**
 * Every panel and dialog of the app goes through here instead of React Native's Modal (tests/tools/appModalGuard.test.ts).
 *
 * On Android a Modal is its own window, and React Native 0.85 sets its system bars once, when it is shown
 * (node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt):
 *   - without navigationBarTranslucent the window turns edge-to-edge off (updateProperties, lines 389–395), so the
 *     navigation bar takes the dialog theme's light grey even at night (Pixel, 2026-11-05);
 *   - updateSystemAppearance (418–447) copies the activity's status bar icon colour only when the dialog is created, and
 *     never the navigation bar's, so switching 夜間模式 with a panel open left dark icons on a dark page.
 * With statusBarTranslucent and navigationBarTranslucent the window is edge-to-edge (WindowUtil.kt enableEdgeToEdge,
 * 106–126): both bars are transparent over the panel's own background and the navigation bar's icons follow the night
 * mode the app set. When the scheme changes while a panel is open, flipping hardwareAccelerated (a no-op for drawing: the
 * app window is hardware accelerated anyway) is a property that makes React Native build the dialog again
 * (createNewDialog), which reapplies both; it waits SYSTEM_BARS_SETTLE_MS so the activity's status bar style (StatusBar
 * in NightModeProvider) is in place first, because the new dialog copies it. The content keeps its state: React Native
 * moves the same view tree into the new dialog.
 *
 * The panels draw under the bars now, so their content keeps clear with safe-area insets (SafeAreaView edges, or
 * useSafeAreaInsets). All three properties are Android-only: an iPhone shows exactly what it showed before.
 */
export function AppModal(props: ModalProps) {
  const { scheme } = useAppTheme();
  const [barsScheme, setBarsScheme] = useState(scheme);
  useEffect(() => {
    if (scheme === barsScheme) return undefined;
    const timer = setTimeout(() => setBarsScheme(scheme), SYSTEM_BARS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [scheme, barsScheme]);
  return <Modal {...props} statusBarTranslucent navigationBarTranslucent hardwareAccelerated={barsScheme === 'dark'} />;
}
