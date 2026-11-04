import { useSyncExternalStore } from 'react';

/**
 * Between the reader and the 新功能 card (src/ui/NightModeNewsHost.tsx). The card lives at the app's root, not inside
 * the reader: the reader unmounts and mounts again while it starts (its account settings load), and a dialog presented
 * by a reader that is going away vanished on the iPhone simulator (run 41831056740). The reader only says when it is
 * on screen with no panel open, and opens 夜間模式 when the card's 改設定 asks.
 */
let readerFree = false;
let pageRequest = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The reader is focused and has no panel open: a place where the card may first appear. */
export function setReaderFreeForNews(free: boolean): void {
  if (readerFree === free) return;
  readerFree = free;
  emit();
}

export function useReaderFreeForNews(): boolean {
  return useSyncExternalStore(subscribe, () => readerFree, () => readerFree);
}

/** 改設定: open ⋯ 更多閱讀工具 → 夜間模式 on the reader. */
export function requestNightModePage(): void {
  pageRequest += 1;
  emit();
}

export function useNightModePageRequest(): number {
  return useSyncExternalStore(subscribe, () => pageRequest, () => pageRequest);
}
