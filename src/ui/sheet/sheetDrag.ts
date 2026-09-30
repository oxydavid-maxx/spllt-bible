import type { RefObject } from 'react';
import { Animated, Easing, PanResponder } from 'react-native';

export const SHEET_CLOSE_MS = 200;
const DRAG_CLOSE_FRACTION = 0.25;
const DRAG_CLOSE_VELOCITY = 0.5;

/** Attach only to the handle/header, so a sheet's content keeps its own scrolling. */
export function createSheetDrag({ translateY, height, close, running, canDrag }: {
  translateY: Animated.Value;
  height: () => number;
  close: () => void;
  running: RefObject<Animated.CompositeAnimation | null>;
  canDrag: () => boolean;
}) {
  return PanResponder.create({
    // Modal claims unhandled starts, so waiting until move would lose the whole gesture.
    // Bubble (not capture) lets a child close button handle its own tap first.
    onStartShouldSetPanResponder: () => canDrag(),
    onMoveShouldSetPanResponder: (_event, gesture) => canDrag() && gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => { running.current?.stop(); running.current = null; },
    onPanResponderMove: (_event, gesture) => { if (canDrag()) translateY.setValue(Math.max(0, gesture.dy)); },
    onPanResponderRelease: (_event, gesture) => {
      if (!canDrag()) return;
      if (gesture.dy > height() * DRAG_CLOSE_FRACTION || (gesture.dy > 4 && gesture.vy > DRAG_CLOSE_VELOCITY)) { close(); return; }
      running.current?.stop();
      const back = Animated.timing(translateY, { toValue: 0, duration: SHEET_CLOSE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
      running.current = back;
      back.start(() => { if (running.current === back) running.current = null; });
    },
    onPanResponderTerminate: () => {
      if (!canDrag()) return;
      running.current?.stop();
      running.current = null;
      translateY.setValue(0);
    },
  });
}
