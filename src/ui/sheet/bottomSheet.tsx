/**
 * The app's own bottom sheet, standing in for the small part of @gorhom/bottom-sheet that the
 * YouVersion reader SDK uses (its settings, chapter, version, verse-action, highlight-consent and
 * sign-in sheets all go through the SDK's NativeSheet). metro.config.js resolves
 * '@gorhom/bottom-sheet' to this file.
 *
 * Why: Gorhom needs react-native-reanimated, and on React Native 0.85 reanimated + worklets cost
 * this app ~155 MB of native memory (a second Hermes runtime with every Expo class installed again)
 * and a UI-thread frame loop that ran even with every sheet closed. Measured on a Pixel, 2026-09-28:
 * native heap 209 MB -> 47 MB, idle main thread 6.9% -> 5.0% (docs/design/lean-reader-sheets.md).
 *
 * Built on React Native's own Animated with the native driver, so an open or closed sheet does no
 * per-frame work. Only the handle drags the sheet: the content is a DOM WebView, and dragging it
 * would fight its own scrolling.
 */
import { createContext, forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const OPEN_MS = 250;
const CLOSE_MS = 200;
const DRAG_CLOSE_FRACTION = 0.25;
const DRAG_CLOSE_VELOCITY = 0.5;
const BACKDROP_OPACITY = 0.5;

type Index = -1 | 0;
export interface BottomSheetMethods {
  snapToIndex(index: number): void;
  close(): void;
}
interface BackdropProps {
  style?: StyleProp<ViewStyle>;
  pressBehavior?: 'close' | 'none';
  appearsOnIndex?: number;
  disappearsOnIndex?: number;
}
export interface BottomSheetProps {
  children?: ReactNode;
  index?: number;
  enablePanDownToClose?: boolean;
  enableHandlePanningGesture?: boolean;
  backdropComponent?: ((props: BackdropProps) => ReactNode) | null;
  backgroundComponent?: null;
  backgroundStyle?: StyleProp<ViewStyle>;
  handleComponent?: null;
  handleIndicatorStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  onChange?: (index: number) => void;
  onAnimate?: (fromIndex: number, toIndex: number) => void;
  accessible?: boolean;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  // Accepted for Gorhom compatibility; this sheet sizes to its content and never detaches.
  enableDynamicSizing?: boolean;
  animateOnMount?: boolean;
  detached?: boolean;
  bottomInset?: number;
  activeOffsetY?: number | number[];
  enableContentPanningGesture?: boolean;
}

interface SheetContextValue {
  progress: Animated.Value;
  isOpen: boolean;
  close(): void;
  reportContentHeight(height: number): void;
}
const SheetContext = createContext<SheetContextValue | null>(null);

const BottomSheet = forwardRef<BottomSheetMethods, BottomSheetProps>(function BottomSheet(props, ref) {
  const {
    children, enablePanDownToClose = false, enableHandlePanningGesture = true, backdropComponent, backgroundComponent,
    backgroundStyle, handleComponent, handleIndicatorStyle, style, containerStyle, accessible, accessibilityElementsHidden,
    importantForAccessibility,
  } = props;
  const { height: windowHeight } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(windowHeight));
  const [progress] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState<Index>(-1);
  const indexRef = useRef<Index>(-1);
  const targetRef = useRef<Index>(-1);
  const contentHeightRef = useRef<number | null>(null);
  const pendingOpenRef = useRef(false);
  const runningRef = useRef<Animated.CompositeAnimation | null>(null);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const closedOffset = windowHeight;

  const animateTo = useCallback((target: Index) => {
    if (targetRef.current === target && (runningRef.current || indexRef.current === target)) return;
    runningRef.current?.stop();
    const from = targetRef.current;
    targetRef.current = target;
    callbacksRef.current.onAnimate?.(from, target);
    const config = { duration: target === 0 ? OPEN_MS : CLOSE_MS, easing: target === 0 ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: true };
    const animation = Animated.parallel([
      Animated.timing(translateY, { ...config, toValue: target === 0 ? 0 : closedOffset }),
      Animated.timing(progress, { ...config, toValue: target === 0 ? 1 : 0 }),
    ]);
    runningRef.current = animation;
    animation.start(({ finished }) => {
      if (runningRef.current === animation) runningRef.current = null;
      if (!finished) return;
      indexRef.current = target;
      setIndex(target);
      callbacksRef.current.onChange?.(target);
    });
  }, [closedOffset, progress, translateY]);

  const close = useCallback(() => {
    pendingOpenRef.current = false;
    animateTo(-1);
  }, [animateTo]);

  useImperativeHandle(ref, () => ({
    snapToIndex(next: number) {
      if (next !== 0) return;
      if (contentHeightRef.current === null) { pendingOpenRef.current = true; return; }
      animateTo(0);
    },
    close,
  }), [animateTo, close]);

  const reportContentHeight = useCallback((height: number) => {
    contentHeightRef.current = height;
    if (pendingOpenRef.current) {
      pendingOpenRef.current = false;
      animateTo(0);
    }
  }, [animateTo]);

  const sheetHeightRef = useRef(0);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => { translateY.setValue(Math.max(0, gesture.dy)); },
    onPanResponderRelease: (_event, gesture) => {
      const height = sheetHeightRef.current || contentHeightRef.current || windowHeight;
      if (gesture.dy > height * DRAG_CLOSE_FRACTION || gesture.vy > DRAG_CLOSE_VELOCITY) { close(); return; }
      const back = Animated.timing(translateY, { toValue: 0, duration: CLOSE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
      runningRef.current = back;
      back.start(() => { if (runningRef.current === back) runningRef.current = null; });
    },
    onPanResponderTerminate: () => { translateY.setValue(0); },
  }), [close, translateY, windowHeight]);

  const context = useMemo<SheetContextValue>(() => ({ progress, isOpen: index === 0, close, reportContentHeight }), [progress, index, close, reportContentHeight]);
  const dragEnabled = enablePanDownToClose && enableHandlePanningGesture;
  return (
    <SheetContext.Provider value={context}>
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, containerStyle]}>
        {backdropComponent ? backdropComponent({ style: StyleSheet.absoluteFill }) : null}
        <Animated.View
          testID="lean-bottom-sheet"
          pointerEvents={index === 0 ? 'auto' : 'none'}
          accessible={accessible}
          // Closed sheets stay mounted (the SDK pre-warms their WebViews on iOS), so they must be hidden from
          // VoiceOver / TalkBack explicitly. Android's SDK path already asked for this; now both platforms get it.
          accessibilityElementsHidden={index !== 0 ? true : accessibilityElementsHidden ?? false}
          importantForAccessibility={index !== 0 ? 'no-hide-descendants' : importantForAccessibility ?? 'auto'}
          onLayout={(event: LayoutChangeEvent) => { sheetHeightRef.current = event.nativeEvent.layout.height; }}
          style={[styles.sheet, style, { maxHeight: windowHeight - top, transform: [{ translateY }] }]}
        >
          {backgroundComponent === null ? null : <View testID="lean-bottom-sheet-background" pointerEvents="none" style={[styles.background, backgroundStyle]} />}
          {handleComponent === null ? null : (
            <View testID="lean-bottom-sheet-handle" style={styles.handle} {...(dragEnabled ? pan.panHandlers : {})}>
              <View style={[styles.indicator, handleIndicatorStyle]} />
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    </SheetContext.Provider>
  );
});
export default BottomSheet;

export function BottomSheetView({ children, style, onLayout, ...rest }: { children?: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (event: LayoutChangeEvent) => void } & Record<string, unknown>) {
  const sheet = useContext(SheetContext);
  return (
    <View {...rest} style={style} onLayout={(event: LayoutChangeEvent) => { sheet?.reportContentHeight(event.nativeEvent.layout.height); onLayout?.(event); }}>
      {children}
    </View>
  );
}

export function BottomSheetBackdrop({ style, pressBehavior = 'close' }: BackdropProps) {
  const sheet = useContext(SheetContext);
  if (!sheet) return null;
  const opacity = sheet.progress.interpolate({ inputRange: [0, 1], outputRange: [0, BACKDROP_OPACITY] });
  return (
    <Animated.View pointerEvents={sheet.isOpen ? 'auto' : 'none'} style={[style, styles.backdrop, { opacity }]}
      accessibilityElementsHidden={!sheet.isOpen} importantForAccessibility={sheet.isOpen ? 'auto' : 'no-hide-descendants'}>
      <Pressable
        testID="lean-bottom-sheet-backdrop"
        accessibilityRole="button"
        accessibilityLabel="關閉面板"
        style={StyleSheet.absoluteFill}
        onPress={pressBehavior === 'close' ? sheet.close : undefined}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  // Gorhom's defaults, so the SDK's sheets look the same: 15 pt top corners, a 30 x 4 indicator
  // in a 24 pt handle row.
  background: { ...StyleSheet.absoluteFill, backgroundColor: 'white', borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  handle: { paddingVertical: 10, alignItems: 'center' },
  indicator: { width: 30, height: 4, borderRadius: 4, backgroundColor: 'rgba(0, 0, 0, 0.75)' },
  backdrop: { backgroundColor: 'black' },
});
