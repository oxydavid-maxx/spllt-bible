export interface AudioRegistryEntry {
  id: string;
  matchingTextVersionId: string;
  coveredRefs: string[];
  licenseStatus: 'approved' | 'not_approved' | 'unavailable';
  streamingAllowed: boolean;
  offlineAllowed: boolean;
  uri: string;
  attribution?: string;
}

export interface AudioRequest {
  textVersionId: string;
  reference: string;
  mode: 'stream' | 'offline';
}

export function resolveAudio(
  entry: AudioRegistryEntry | undefined,
  request: AudioRequest,
): { status: 'READY'; uri: string; attribution?: string } | { status: 'UNAVAILABLE'; reason: string } {
  if (!entry || entry.licenseStatus !== 'approved') {
    return { status: 'UNAVAILABLE', reason: 'audio license is not approved' };
  }
  if (entry.matchingTextVersionId !== request.textVersionId || !entry.coveredRefs.includes(request.reference)) {
    return { status: 'UNAVAILABLE', reason: 'audio does not match the selected text/reference' };
  }
  if (request.mode === 'stream' && !entry.streamingAllowed) {
    return { status: 'UNAVAILABLE', reason: 'streaming is not licensed' };
  }
  if (request.mode === 'offline' && !entry.offlineAllowed) {
    return { status: 'UNAVAILABLE', reason: 'offline use is not licensed' };
  }
  return { status: 'READY', uri: entry.uri, attribution: entry.attribution };
}
