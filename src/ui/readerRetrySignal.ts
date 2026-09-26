import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * A counter the reader bumps whenever it comes back into view: its tab regains focus, or the app
 * returns to the foreground while it is showing. The SDK reader retries a chapter (and the book list
 * behind its title) that failed to load when this changes. A read that failed while the reader was
 * out of sight, such as a sign-in on the journal tab, then recovers the moment the member looks at it.
 */
export function useReaderRetrySignal(focused: boolean): number {
  const [signal, setSignal] = useState(0);
  const wasFocused = useRef(focused);

  useEffect(() => {
    if (focused && !wasFocused.current) setSignal((value) => value + 1);
    wasFocused.current = focused;
  }, [focused]);

  useEffect(() => {
    if (!focused) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setSignal((value) => value + 1);
    });
    return () => subscription.remove();
  }, [focused]);

  return signal;
}
