import type { AudioAvailability } from '../config/youVersionContent';

export interface AudioSession {
  availability: AudioAvailability;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekBy(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setSleepTimer(minutes: number | null): Promise<void>;
}

export interface AudioPlaybackImplementation {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekBy: (seconds: number) => Promise<void>;
  setRate: (rate: number) => Promise<void>;
  setSleepTimer: (minutes: number | null) => Promise<void>;
}

export function createAudioSession(availability: AudioAvailability, implementation?: AudioPlaybackImplementation): AudioSession {
  const requireProvider = (): AudioPlaybackImplementation => {
    if (availability.status !== 'READY') throw new Error('AUDIO_NOT_READY');
    if (!implementation) throw new Error('AUDIO_PROVIDER_REQUIRED');
    return implementation;
  };
  return {
    availability,
    play: async () => requireProvider().play(),
    pause: async () => requireProvider().pause(),
    seekBy: async (seconds) => requireProvider().seekBy(seconds),
    setRate: async (rate) => requireProvider().setRate(rate),
    setSleepTimer: async (minutes) => requireProvider().setSleepTimer(minutes),
  };
}
