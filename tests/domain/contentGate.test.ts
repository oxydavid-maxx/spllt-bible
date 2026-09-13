import { describe, expect, it } from 'vitest';
import {
  evaluateContentGate,
  resolveReaderMode,
} from '../../src/domain/contentGate';

const requiredRefs = ['JHN.12.27-50', 'JHN.13'];

const readyRegistry = {
  appKey: 'fixture-app-key',
  textVersions: [
    {
      id: 'text-fixture',
      coveredRefs: requiredRefs,
      licenseStatus: 'approved',
    },
  ],
  audioEditions: [
    {
      id: 'audio-fixture',
      coveredRefs: requiredRefs,
      matchingTextVersionId: 'text-fixture',
      licenseStatus: 'approved',
      streamingAllowed: true,
    },
  ],
  technicalProbePassed: true,
};

describe('C-first content gate', () => {
  it('stays pending when App Key or approved assets are missing', () => {
    expect(evaluateContentGate({}, requiredRefs).status).toBe('C_PENDING_ACCESS');
    expect(evaluateContentGate({ appKey: 'key' }, requiredRefs).status).toBe('C_PENDING_ACCESS');
    expect(
      evaluateContentGate(
        {
          ...readyRegistry,
          appKey: null,
        },
        requiredRefs,
      ).status,
    ).toBe('C_PENDING_ACCESS');
  });

  it('does not treat unapproved fixture content as C_READY', () => {
    const result = evaluateContentGate(
      {
        ...readyRegistry,
        textVersions: [{ ...readyRegistry.textVersions[0], licenseStatus: 'not_approved' }],
      },
      requiredRefs,
    );

    expect(result.status).not.toBe('C_READY');
  });

  it('allows a provider without a YouVersion App Key to enter the probe gate', () => {
    const result = evaluateContentGate(
      {
        access: { requiresAppKey: false, provider: 'public-domain-fixture' },
        textVersions: readyRegistry.textVersions,
        audioEditions: readyRegistry.audioEditions,
        technicalProbePassed: false,
      },
      requiredRefs,
    );
    expect(result.status).toBe('C_TECHNICAL_PROBE');
  });

  it('can expose an approved text-only probe while the release audio gate remains pending', () => {
    const result = evaluateContentGate(
      {
        access: { requiresAppKey: false, provider: 'public-provider-fixture' },
        textProbeOnly: true,
        textVersions: [{
          id: 'cuv-text-candidate',
          coveredRefs: requiredRefs,
          licenseStatus: 'approved',
        }],
      },
      requiredRefs,
    );
    expect(result.status).toBe('C_TECHNICAL_PROBE');
    expect(result.reason).toContain('audio');
  });

  it('requires the technical probe after content approval', () => {
    const result = evaluateContentGate(
      { ...readyRegistry, technicalProbePassed: false },
      requiredRefs,
    );

    expect(result.status).toBe('C_TECHNICAL_PROBE');
  });

  it('selects B only for explicit unavailability with evidence', () => {
    const result = evaluateContentGate(
      {
        explicitUnavailable: {
          reason: 'provider declined the required distribution use',
          evidenceRefs: ['provider-case-123'],
        },
      },
      requiredRefs,
    );

    expect(result.status).toBe('C_NOT_AVAILABLE');
    expect(result.evidenceRefs).toEqual(['provider-case-123']);
    expect(resolveReaderMode(result.status)).toBe('b-external');
  });

  it('keeps the reader pending for temporary access gaps', () => {
    const result = evaluateContentGate({}, requiredRefs);
    expect(resolveReaderMode(result.status)).toBe('pending');
  });

  it('returns C-native only after the ready gate', () => {
    const result = evaluateContentGate(readyRegistry, requiredRefs);
    expect(result.status).toBe('C_READY');
    expect(resolveReaderMode(result.status)).toBe('c-native');
  });
});
