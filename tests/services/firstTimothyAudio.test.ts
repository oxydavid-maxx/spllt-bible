import { describe, expect, it } from 'vitest';
import { evaluateContentCapability } from '../../server/contentCapabilities';
import { validateCapability } from '../../src/domain/chapterAudioContract';
import { resolveChapterAudioSession } from '../../src/services/audioChapterResolver';

const now = Date.parse('2026-09-13T00:00:00Z');
describe('observed first Timothy recording through the real chapter contract', () => {
  it('makes the reported missing chapter playable through the service and actual App resolver', () => {
    const capability = evaluateContentCapability(1392, '1TI.1', { nowMs: now });
    expect(capability.audio).toBe(true);
    expect(validateCapability(capability, { versionId: 1392, usfm: '1TI.1' }, now).ok).toBe(true);
    if (!capability.uri || !capability.provenance) throw new Error('Observed source was not supplied');
    const resolved = resolveChapterAudioSession({ chapterUsfm: '1TI.1', versionId: 1392, audioAuthorized: true, qaTestAudioEnabled: false, capability: { ...capability, uri: capability.uri, provenance: capability.provenance } });
    expect(resolved.source?.chapterUsfm).toBe('1TI.1');
    expect(resolved.source?.uri).toBe('https://audio-bible-cdn.youversionapi.com/1320/32k/1TI/1-d448ce90d1e1cc3b6c6379b2de535013.mp3?version_id=1392');
    expect(capability.provenance?.publisher).toBe('Biblica');
  });
  it('does not invent a recording for the next unobserved chapter', () => {
    expect(evaluateContentCapability(1392, '1TI.2', { nowMs: now })).toMatchObject({ audio: false, status: 'pending_observation' });
  });
  it('never supplies this recording under a different translation', () => {
    expect(evaluateContentCapability(46, '1TI.1', { nowMs: now })).toMatchObject({ audio: false, identity: { versionId: 46, usfm: '1TI.1' } });
  });
});
