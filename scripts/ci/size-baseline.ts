/**
 * One-time native-dependency adoption, using a measured increment instead of widening size ratios.
 *
 * The allowance is what expo-updates added natively, measured once at its adoption (before/after runs on
 * the same main commit). It is added to whatever main measures now, so other PRs merging first and
 * moving main by a few KB do not matter. It applies only while the commit that produced main's baseline
 * does not yet depend on expo-updates; once main contains it, the comparison is against main alone.
 */
export interface SizeBaselineDecision { bytes: number; allowanceBytes: number; note: string }
export interface SizeBaselineContext {
  /** This candidate's package-lock.json, parsed. */
  currentLock: unknown;
  /** package.json at the commit that produced main's baseline, parsed; null when it could not be read. */
  basePackageJson: unknown;
}

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

export function selectSizeBaseline(field: string, mainBytes: number, allowance: unknown, context: SizeBaselineContext): SizeBaselineDecision {
  const none = (note = ''): SizeBaselineDecision => ({ bytes: mainBytes, allowanceBytes: 0, note });
  if (field !== 'apkBytes' && field !== 'appBytes') return none();
  const value = record(allowance);
  if (!value) return none();
  const dependency = record(value.dependency);
  const measured = record(value.measurements?.[field]);
  if (!value.reason || !dependency || typeof dependency.name !== 'string' || typeof dependency.version !== 'string' || !measured) return none('原生套件增量資料不完整，不採用');
  if (!positiveInteger(measured.beforeBytes) || !positiveInteger(measured.afterBytes) || measured.afterBytes <= measured.beforeBytes
    || !/^\d+$/.test(String(measured.beforeRunId ?? '')) || !/^\d+$/.test(String(measured.afterRunId ?? ''))
    || !/^[a-f0-9]{40}$/.test(String(measured.beforeCommit ?? '')) || !/^[a-f0-9]{40}$/.test(String(measured.afterCommit ?? ''))
    || !positiveInteger(mainBytes)) return none('原生套件增量不是完整的實測數字，不採用');
  // The measurement describes one exact version; a bumped or missing dependency needs a new measurement.
  if (record(context.currentLock)?.packages?.[`node_modules/${dependency.name}`]?.version !== dependency.version) {
    return none(`這個候選裝的 ${dependency.name} 不是實測的 ${dependency.version}，不採用增量`);
  }
  const base = record(context.basePackageJson);
  if (!base || !record(base.dependencies)) return none(`無法確認 main 基準是否已含 ${dependency.name}，不採用增量`);
  if ([base.dependencies, base.devDependencies, base.optionalDependencies].some((deps) => record(deps)?.[dependency.name] !== undefined)) {
    return none(`main 基準已含 ${dependency.name}，只和 main 比`);
  }
  const increment = measured.afterBytes - measured.beforeBytes;
  return { bytes: mainBytes + increment, allowanceBytes: increment, note: `main 基準還沒有 ${dependency.name}，加上導入時實測的原生增量 ${increment}bytes` };
}
