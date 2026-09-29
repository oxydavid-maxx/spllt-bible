import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The system's reduce-motion setting (Android 移除動畫, iOS 減少動態). Where the platform cannot say,
 * it reads as off, and scrolls animate as usual.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof AccessibilityInfo?.isReduceMotionEnabled !== 'function') return;
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (alive) setReduceMotion(enabled); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; subscription?.remove?.(); };
  }, []);
  return reduceMotion;
}
