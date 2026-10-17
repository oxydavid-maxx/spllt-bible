/** Pinch-zoom arithmetic for the 週刊 viewer, kept apart from the gesture wiring so it can be tested on its own. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

export interface Point { x: number; y: number }

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The scale after fingers that started `startDistance` apart are now `currentDistance` apart. */
export function pinchScale(startScale: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0) return startScale;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * (currentDistance / startDistance)));
}

/** Keeps a zoomed page covering the view: it can move only as far as its enlarged edges allow. */
export function clampOffset(offset: Point, scale: number, view: { width: number; height: number }, content: { width: number; height: number }): Point {
  const limit = (viewSize: number, contentSize: number) => Math.max(0, (contentSize * scale - viewSize) / 2);
  const clamp = (value: number, bound: number) => (bound === 0 ? 0 : Math.min(bound, Math.max(-bound, value)));
  return { x: clamp(offset.x, limit(view.width, content.width)), y: clamp(offset.y, limit(view.height, content.height)) };
}

/** The page's displayed size inside the view, keeping its proportions. */
export function fitSize(view: { width: number; height: number }, page: { width: number; height: number }): { width: number; height: number } {
  if (view.width <= 0 || view.height <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(view.width / page.width, view.height / page.height);
  return { width: page.width * ratio, height: page.height * ratio };
}
