import { useSyncExternalStore } from 'react';

/**
 * Whether 有新版本 (UpdatePrompt) is on screen. The 新功能 card (NightModeNews) waits for it rather than opening a
 * second dialog over it. Plain module state: one app has one prompt.
 */
let showing = false;
const listeners = new Set<() => void>();

export function setUpdatePromptShowing(next: boolean): void {
  if (showing === next) return;
  showing = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useUpdatePromptShowing(): boolean {
  return useSyncExternalStore(subscribe, () => showing, () => showing);
}
