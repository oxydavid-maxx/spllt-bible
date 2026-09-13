import { describe, expect, it } from 'vitest';
import { resolveAudio } from '../../src/services/audioProvider';

describe('licensed audio boundary', () => {
  const entry = {
    id: 'audio-cuv-fixture',
    matchingTextVersionId: 'text-cuv-fixture',
    coveredRefs: ['JHN.18'],
    licenseStatus: 'approved' as const,
    streamingAllowed: true,
    offlineAllowed: false,
    uri: 'https://provider.example/audio/JHN.18.mp3',
    attribution: 'Provider attribution',
  };

  it('allows approved matching streaming only', () => {
    expect(resolveAudio(entry, { textVersionId: 'text-cuv-fixture', reference: 'JHN.18', mode: 'stream' })).toMatchObject({ status: 'READY' });
    expect(resolveAudio(entry, { textVersionId: 'text-cuv-fixture', reference: 'JHN.18', mode: 'offline' })).toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('rejects unapproved, mismatched, and missing audio', () => {
    expect(resolveAudio(undefined, { textVersionId: 'text-cuv-fixture', reference: 'JHN.18', mode: 'stream' }).status).toBe('UNAVAILABLE');
    expect(resolveAudio({ ...entry, licenseStatus: 'not_approved' }, { textVersionId: entry.matchingTextVersionId, reference: 'JHN.18', mode: 'stream' }).status).toBe('UNAVAILABLE');
    expect(resolveAudio(entry, { textVersionId: 'other', reference: 'JHN.18', mode: 'stream' }).status).toBe('UNAVAILABLE');
  });
});
