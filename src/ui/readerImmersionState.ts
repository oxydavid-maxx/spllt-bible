import { useSyncExternalStore } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();
let readerImmersed = false;

export function setReaderImmersed(immersed: boolean): void {
  if (readerImmersed === immersed) return;
  readerImmersed = immersed;
  listeners.forEach(listener => listener());
}

export function getReaderImmersionSnapshot(): boolean {
  return readerImmersed;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReaderImmersionSnapshot(): boolean {
  return useSyncExternalStore(subscribe, getReaderImmersionSnapshot, () => false);
}
