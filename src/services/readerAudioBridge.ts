import { useSyncExternalStore } from 'react';

export type ReaderAudioState = 'inactive' | 'loading' | 'playing' | 'paused' | 'retry' | 'unavailable';

export interface ReaderAudioSnapshot {
  chapterUsfm: string;
  state: ReaderAudioState;
}

type Listener = () => void;
const listeners = new Set<Listener>();
const empty: ReaderAudioSnapshot = { chapterUsfm: '', state: 'inactive' };
let snapshot = empty;
let owner: object | null = null;
let toggle: (() => void) | null = null;

/** One mounted Reader control owns the player; Diary only receives its state and command. */
export function updateReaderAudioOwner(ownerId: object, next: ReaderAudioSnapshot, onToggle: () => void): void {
  if (owner !== null && owner !== ownerId) return;
  owner = ownerId;
  toggle = onToggle;
  if (snapshot.chapterUsfm === next.chapterUsfm && snapshot.state === next.state) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}

export function clearReaderAudioOwner(ownerId: object): void {
  if (owner !== ownerId) return;
  owner = null;
  toggle = null;
  if (snapshot === empty) return;
  snapshot = empty;
  listeners.forEach(listener => listener());
}

export function requestReaderAudioToggle(): void {
  toggle?.();
}

export function getReaderAudioSnapshot(): ReaderAudioSnapshot {
  return snapshot;
}

export function subscribeReaderAudio(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReaderAudioSnapshot(): ReaderAudioSnapshot {
  return useSyncExternalStore(subscribeReaderAudio, getReaderAudioSnapshot, getReaderAudioSnapshot);
}
