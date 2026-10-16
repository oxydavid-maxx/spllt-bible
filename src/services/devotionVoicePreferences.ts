import type { ReaderPreferencesStorage } from './readerPreferences';
import { DEFAULT_DEVOTION_VOICE, isDevotionVoice, type DevotionVoice } from '../domain/devotionVoice';

function storageKey(memberId: string) {
  return `qingmu.devotion.voice.v1.m-${Array.from(memberId, c => c.codePointAt(0)!.toString(16)).join('_') || 'empty'}`;
}
export function createDevotionVoiceStore(storage: ReaderPreferencesStorage) {
  const values = new Map<string, DevotionVoice>();
  const writes = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    getVoice: (member: string | null): DevotionVoice => member ? values.get(member) ?? DEFAULT_DEVOTION_VOICE : DEFAULT_DEVOTION_VOICE,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load(member: string | null) {
      if (!member || values.has(member)) return;
      let stored: unknown;
      try { stored = await storage.getItem(storageKey(member)); } catch { /* Use the default. */ }
      if (values.has(member)) return;
      values.set(member, isDevotionVoice(stored) ? stored : DEFAULT_DEVOTION_VOICE); notify();
    },
    async update(member: string | null, voice: DevotionVoice) {
      if (!member || !isDevotionVoice(voice)) return;
      values.set(member, voice); notify();
      const write = (writes.get(member) ?? Promise.resolve()).then(() => storage.setItem(storageKey(member), voice)).catch(() => undefined);
      writes.set(member, write);
      await write;
      if (writes.get(member) === write) writes.delete(member);
    },
  };
}
