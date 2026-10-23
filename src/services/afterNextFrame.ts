// No imports: also used by screens whose tests load no native module (src/ui/BibleContentPreloadHost.tsx).

/**
 * Runs `run` once the next frame has been drawn. Questions asked ahead start here: a request started in the same turn
 * as a switch would hold back the frame that shows it. Without frames (node tests) it runs at once.
 */
export function afterNextFrame(run: () => void): { cancel(): void } {
  if (typeof requestAnimationFrame !== 'function') { run(); return { cancel: () => undefined }; }
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => { timer = setTimeout(() => { timer = null; if (!cancelled) run(); }, 0); });
  return { cancel: () => { cancelled = true; cancelAnimationFrame?.(frame); if (timer !== null) clearTimeout(timer); } };
}
