/** One-time native-dependency adoption, using measured bytes instead of widening size ratios. */
export function selectSizeBaseline(field: string, mainBytes: number, reset: unknown, packageLockGitBlobSha256: string): number {
  if (field !== 'apkBytes' && field !== 'appBytes') return mainBytes;
  if (!reset || typeof reset !== 'object') return mainBytes;
  const value = reset as Record<string, any>;
  const measured = value.measurements?.[field];
  if (!measured || value.packageLockGitBlobSha256 !== packageLockGitBlobSha256
    || !/^[a-f0-9]{64}$/.test(packageLockGitBlobSha256)
    || !value.reason || measured.beforeBytes !== mainBytes
    || typeof measured.afterBytes !== 'number' || !Number.isFinite(measured.afterBytes)
    || measured.afterBytes <= mainBytes || mainBytes <= 0
    || !/^\d+$/.test(String(measured.beforeRunId ?? '')) || !/^\d+$/.test(String(measured.afterRunId ?? ''))
    || !/^[a-f0-9]{40}$/.test(measured.beforeCommit ?? '') || !/^[a-f0-9]{40}$/.test(measured.afterCommit ?? '')) return mainBytes;
  return measured.afterBytes;
}
