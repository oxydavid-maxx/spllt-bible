import { useSyncExternalStore } from 'react';

/**
 * Between the reader and the 新功能 card (src/ui/NightModeNewsHost.tsx). The card lives at the app's root, not inside
 * the reader: the reader unmounts and mounts again while it starts (its account settings load once the profile is in),
 * and a dialog presented by a reader that is going away vanished on the iPhone simulator (run 41831056740). The reader
 * only says when it is on screen with no panel open, and opens 夜間模式 when the card's 改設定 asks.
 */
let readerFree = false;
let pagePending = false;
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

/** 改設定: open ⋯ 更多閱讀工具 → 夜間模式 on the reader; waits for a reader on screen if there is none right now. */
export function requestNightModePage(): void {
  pagePending = true;
  emit();
}

/** The reader takes the request when it opens the page. */
export function takeNightModePageRequest(): boolean {
  if (!pagePending) return false;
  pagePending = false;
  emit();
  return true;
}

export function useNightModePageRequested(): boolean {
  return useSyncExternalStore(subscribe, () => pagePending, () => pagePending);
}
