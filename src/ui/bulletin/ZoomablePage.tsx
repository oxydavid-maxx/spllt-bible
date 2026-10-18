import { useMemo, useRef } from 'react';
import { Animated, PanResponder, View, type GestureResponderEvent, type ImageSourcePropType } from 'react-native';
import { clampOffset, distance, fitSize, pinchScale, type Point } from './zoomMath';

/**
 * One 週刊 page in the viewer: two fingers zoom (up to 4×), one finger moves a zoomed page. At normal size a
 * one-finger swipe is left to the pager, so pages still turn. Built on React Native's own touch responder:
 * reanimated is deliberately not linked in this app (docs/design/lean-reader-sheets.md).
 */
export function ZoomablePage({ source, page, view, label, onZoomChange }: {
  source: ImageSourcePropType;
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

  return <View style={{ width: view.width, height: view.height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} {...responder.panHandlers}>
    <Animated.Image
      accessibilityLabel={label}
      source={source}
      resizeMode="contain"
      style={{ width: fitted.width, height: fitted.height, transform: [{ translateX: offsetX }, { translateY: offsetY }, { scale }] }}
    />
  </View>;
}
