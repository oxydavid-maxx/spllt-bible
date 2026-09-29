import { AppState } from 'react-native';

/**
 * Whether the member can see the app at all: Android reports 'background' with the screen off or
 * another app in front, iOS also 'inactive' while the app switcher covers it. Anything else, including
 * 'unknown' before the first native report, counts as visible, so a missing report never hides a screen.
 */
export function isHiddenAppState(state: string | null | undefined): boolean {
  return state === 'background' || state === 'inactive';
}

export function isAppHidden(): boolean {
  return isHiddenAppState(AppState.currentState);
}

/** Calls back with hidden = true/false on every foreground change. Returns the unsubscribe. */
export function subscribeAppHidden(listener: (hidden: boolean) => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => listener(isHiddenAppState(state)));
  return () => subscription.remove();
}

/** Calls back each time the app becomes active (foreground). Returns the unsubscribe. */
export function subscribeAppActive(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') listener(); });
  return () => subscription.remove();
}
