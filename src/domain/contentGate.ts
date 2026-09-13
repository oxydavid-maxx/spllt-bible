import type { ContentGateResult, ContentGateStatus } from './types';

interface VersionEntry {
  id?: string;
  coveredRefs?: string[];
  licenseStatus?: string;
}

interface AudioEntry extends VersionEntry {
  matchingTextVersionId?: string;
  streamingAllowed?: boolean;
  offlineAllowed?: boolean;
}

export interface ContentRegistry {
  appKey?: string | null;
  access?: {
    requiresAppKey: boolean;
    provider?: string;
  };
  textVersions?: VersionEntry[];
  audioEditions?: AudioEntry[];
  textProbeOnly?: boolean;
  technicalProbePassed?: boolean;
  explicitUnavailable?: {
    reason: string;
    evidenceRefs: string[];
  };
}

function covers(entry: VersionEntry | undefined, requiredRefs: string[]): boolean {
  if (!entry || entry.licenseStatus !== 'approved') return false;
  const refs = new Set(entry.coveredRefs ?? []);
  return requiredRefs.every((reference) => refs.has(reference));
}

export function evaluateContentGate(
  registry: ContentRegistry,
  requiredRefs: string[],
): ContentGateResult {
  const unavailable = registry.explicitUnavailable;
  if (unavailable && unavailable.reason.trim() && unavailable.evidenceRefs.length > 0) {
    return {
      status: 'C_NOT_AVAILABLE',
      reason: unavailable.reason,
      evidenceRefs: unavailable.evidenceRefs,
    };
  }

  const requiresAppKey = registry.access?.requiresAppKey ?? true;
  if (requiresAppKey && !registry.appKey) {
    return {
      status: 'C_PENDING_ACCESS',
      reason: 'YouVersion App Key or approved provider access is not configured',
      evidenceRefs: [],
    };
  }

  const text = registry.textVersions?.find((entry) => covers(entry, requiredRefs));
  if (!text) {
    return {
      status: 'C_PENDING_ACCESS',
      reason: 'No approved text version covers every required September reference',
      evidenceRefs: [],
    };
  }

  const audio = registry.audioEditions?.find(
    (entry) => entry.matchingTextVersionId === text.id && covers(entry, requiredRefs),
  );
  if (!audio) {
    if (registry.textProbeOnly) {
      return {
        status: 'C_TECHNICAL_PROBE',
        reason: 'Verified text candidate is available for a limited native probe; approved Chinese audio is still pending',
        evidenceRefs: [text.id ?? 'text-entry'],
      };
    }
    return {
      status: 'C_PENDING_ACCESS',
      reason: 'No approved matching Chinese audio edition covers every required reference',
      evidenceRefs: [],
    };
  }

  if (registry.technicalProbePassed !== true) {
    return {
      status: 'C_TECHNICAL_PROBE',
      reason: 'Approved content exists but native playback and family-control probe is pending',
      evidenceRefs: [],
    };
  }

  return {
    status: 'C_READY',
    reason: 'Approved text/audio coverage and native probe evidence are present',
    evidenceRefs: [text.id ?? 'text-entry', audio.id ?? 'audio-entry'],
  };
}

export function resolveReaderMode(
  gate: ContentGateStatus,
): 'c-native' | 'b-external' | 'pending' {
  if (gate === 'C_READY') return 'c-native';
  if (gate === 'C_NOT_AVAILABLE') return 'b-external';
  return 'pending';
}
