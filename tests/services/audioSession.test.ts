import { describe, expect, it } from 'vitest';

import { getAudioAvailability } from '../../src/config/youVersionContent';
import { createAudioSession } from '../../src/services/audioSession';

describe('audio session seam', () => {
  it('keeps 1392 and 312 separate and blocks controls while provider status is pending', async () => {
    const biblica = getAudioAvailability(1392)!;
    const csbt = getAudioAvailability(312)!;
    expect(biblica).toMatchObject({ status: 'PENDING_PROVIDER', versionId: 1392, publisher: 'Biblica', recordingId: null });
    expect(csbt).toMatchObject({ status: 'PENDING_PROVIDER', versionId: 312, publisher: '全球聖經促進會', recordingId: null });
    expect(csbt.reason).not.toContain('Biblica');
    await expect(createAudioSession(biblica).play()).rejects.toThrow('AUDIO_NOT_READY');
  });

  it('only delegates playback after a verified READY provider is supplied', async () => {
    const calls: string[] = [];
    const session = createAudioSession({ status: 'READY', versionId: 1392, publisher: 'Biblica', recordingId: 'approved-recording', reason: 'verified' }, { play: async () => { calls.push('play'); }, pause: async () => { calls.push('pause'); }, seekBy: async () => { calls.push('seek'); }, setRate: async () => { calls.push('rate'); }, setSleepTimer: async () => { calls.push('timer'); } });
    await session.play();
    expect(calls).toEqual(['play']);
  });
});
