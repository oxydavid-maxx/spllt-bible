import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';
import type { CompletionAwardEvent } from '../services/completionController';
import { taipeiDate } from '../domain/gamificationV1';
import { theme } from './Theme';

export function buildCompletionAwardMessage(event: CompletionAwardEvent, today = taipeiDate()): string {
  const dateLabel = event.taskDate === today
    ? '今日'
    : `${Number(event.taskDate.slice(5, 7))}月${Number(event.taskDate.slice(8, 10))}日`;
  return `+${event.pointsDelta} 分　完成${dateLabel}讀經了！`;
}

/** `bottomOffset` floats the award up from just above a bottom action (the Reader's ○) instead of under the header. */
export function CompletionAwardFeedback({ event, onFinished, bottomOffset }: { event: CompletionAwardEvent | null; onFinished: (operationId: string) => void; bottomOffset?: number }) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduceMotion(enabled); }).catch(() => { if (active) setReduceMotion(false); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => setReduceMotion(enabled));
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!event || reduceMotion === null) return undefined;
    opacity.setValue(0);
    translateY.setValue(reduceMotion ? 0 : 8);
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: reduceMotion ? 0 : 250, useNativeDriver: true }),
      ]),
      Animated.delay(1_750),
      Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) onFinishedRef.current(event.operationId); });
    return () => animation.stop();
  }, [event?.operationId, reduceMotion, opacity, translateY]);

  if (!event || reduceMotion === null) return null;
  return <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.container, bottomOffset !== undefined && [styles.aboveAction, { bottom: bottomOffset }], { opacity, transform: [{ translateY }] }]}>
    <Text style={styles.label}>{buildCompletionAwardMessage(event)}</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 82, left: theme.spacing.lg, right: theme.spacing.lg, alignItems: 'center', zIndex: 20 },
  aboveAction: { top: undefined, right: theme.spacing.sm, alignItems: 'flex-end' },
  label: { color: theme.colors.white, backgroundColor: theme.colors.ink, borderRadius: theme.radius.chip, overflow: 'hidden', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
});
