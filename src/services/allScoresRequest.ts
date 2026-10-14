/**
 * 全體 (管理) moved off the 積分 tabs to the bottom of 我的帳戶 (維護者 2026-10-14): only admins use
 * it, so it no longer takes a tab every member sees. The account page asks; the 積分 screen opens
 * the 'all' scope once it is focused and in front, through the same unlock guard as before.
 */

let requested = false;
const listeners = new Set<() => void>();

export function requestOpenAllScores(): void {
  requested = true;
  for (const listener of [...listeners]) listener();
}

export function consumeOpenAllScores(): boolean {
  const value = requested;
  requested = false;
  return value;
}

export function subscribeOpenAllScores(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
