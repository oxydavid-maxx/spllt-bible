import { useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type ImageSourcePropType } from 'react-native';
import { theme } from '../Theme';
import { PAGE_FAILED, PAGE_LOADING, PageStatus, usePageLoad } from './BulletinPageStatus';
import { clampOffset, distance, fitSize, pinchScale, type Point } from './zoomMath';

/**
 * One 週刊 page in the viewer: two fingers zoom (up to 4×), one finger moves a zoomed page. At normal size a
 * one-finger swipe is left to the pager, so pages still turn. Built on React Native's own touch responder:
 * reanimated is deliberately not linked in this app (docs/design/lean-reader-sheets.md).
 *
 * The original is downloaded here, not in the list (2026-10-20). Until it is in, the page shows the phone copy the list
 * already has (`preview`), or the grey 週刊載入中… box when there is none yet; the label says 載入中 until the original
 * is in. When the original cannot be loaded, a button says so and asks for it again.
 */
export function ZoomablePage({ source, preview, page, view, label, onZoomChange }: {
  source: ImageSourcePropType;
  preview?: ImageSourcePropType;
  page: { width: number; height: number };
  view: { width: number; height: number };
  label: string;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const fitted = fitSize(view, page);
  const scale = useRef(new Animated.Value(1)).current;
  const offsetX = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;
  const state = useRef({ scale: 1, offset: { x: 0, y: 0 } as Point, pinching: false, startScale: 1, startDistance: 0, startTouch: { x: 0, y: 0 } as Point, startOffset: { x: 0, y: 0 } as Point });
  const zoomChange = useRef(onZoomChange);
  zoomChange.current = onZoomChange;
  const original = usePageLoad();
  const [previewShown, setPreviewShown] = useState(false);

  const responder = useMemo(() => {
    const now = state.current;
    const apply = (nextScale: number, offset: Point) => {
      now.scale = nextScale; now.offset = clampOffset(offset, nextScale, view, fitted);
      scale.setValue(nextScale); offsetX.setValue(now.offset.x); offsetY.setValue(now.offset.y);
    };
    const begin = (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches;
      now.pinching = touches.length >= 2;
      if (now.pinching) {
        now.startDistance = distance({ x: touches[0].pageX, y: touches[0].pageY }, { x: touches[1].pageX, y: touches[1].pageY });
        now.startScale = now.scale;
        zoomChange.current(true);
      } else if (touches.length === 1) {
        now.startTouch = { x: touches[0].pageX, y: touches[0].pageY };
      }
      now.startOffset = now.offset;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || now.scale > 1,
      onPanResponderGrant: begin,
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          if (!now.pinching) begin(event);
          apply(pinchScale(now.startScale, now.startDistance, distance({ x: touches[0].pageX, y: touches[0].pageY }, { x: touches[1].pageX, y: touches[1].pageY })), now.offset);
        } else if (touches.length === 1 && now.scale > 1) {
          if (now.pinching) begin(event);
          apply(now.scale, { x: now.startOffset.x + touches[0].pageX - now.startTouch.x, y: now.startOffset.y + touches[0].pageY - now.startTouch.y });
        }
      },
      onPanResponderRelease: () => {
        // Nearly back to normal size snaps to it, so the page lines up again for the pager.
        if (now.scale < 1.05) apply(1, { x: 0, y: 0 });
        now.pinching = false;
        zoomChange.current(now.scale > 1);
      },
      onPanResponderTerminationRequest: () => now.scale <= 1,
    });
  }, [view.width, view.height, fitted.width, fitted.height, scale, offsetX, offsetY]);

  const failed = original.state === 'error';
  const shown = original.state === 'ready' || previewShown;
  return <View style={{ width: view.width, height: view.height }}>
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={original.state === 'ready' ? label : `${label}，載入中`}
      style={styles.fill}
      {...responder.panHandlers}
    >
      <Animated.View style={{ width: fitted.width, height: fitted.height, transform: [{ translateX: offsetX }, { translateY: offsetY }, { scale }] }}>
        {preview ? <Image testID="bulletin-page-preview" source={preview} resizeMode="contain" onLoad={() => setPreviewShown(true)} style={StyleSheet.absoluteFill} /> : null}
        <Image key={original.attempt} testID="bulletin-page-original" source={source} resizeMode="contain" onLoad={original.onLoad} onError={original.onError} style={StyleSheet.absoluteFill} />
        {shown ? null : <PageStatus text={failed ? undefined : PAGE_LOADING} />}
      </Animated.View>
    </View>
    {failed ? <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.fill]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}載不到，點一下再試`} onPress={original.retry} style={styles.retry}>
        <Text style={styles.retryText}>{PAGE_FAILED}</Text>
      </Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  retry: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: 'rgba(0,0,0,0.75)' },
  retryText: { color: '#FFFFFF', fontSize: theme.type.body.size, fontWeight: '700' },
});
