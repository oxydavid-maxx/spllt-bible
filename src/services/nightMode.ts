/**
 * 夜間模式 (光佑 2026-11-04, docs/features/night-mode.md): four choices, kept on this phone only.
 *
 *   晚上自動 (default)  18:00–06:00 by the phone's own clock is dark (18:00 counts, 06:00 does not), other hours light.
 *                       Fixed hours, not sunset and sunrise.
 *   跟手機              whatever the phone's own dark setting says, and it follows the moment the phone changes.
 *   一直深色 / 一直白底  always dark / always light.
 *
 * Plain module, no react-native: the rules here are what the tests pin down; src/ui/NightModeProvider.tsx connects
 * them to the phone (storage, the system scheme, the clock).
 */
export type NightModeChoice = 'auto' | 'system' | 'dark' | 'light';
export type Scheme = 'light' | 'dark';

export const DEFAULT_NIGHT_MODE: NightModeChoice = 'auto';
export const NIGHT_START_HOUR = 18;
export const NIGHT_END_HOUR = 6;

/** The words on the 夜間模式 page and the 我的帳戶 card, in this order (光佑 2026-11-04). */
export const NIGHT_MODE_TITLE = '夜間模式';
export const NIGHT_MODE_SUBTITLE = '只改這支手機';
export const NIGHT_MODE_OPTIONS: ReadonlyArray<{ choice: NightModeChoice; label: string; note: string }> = [
  { choice: 'auto', label: '晚上自動', note: '18:00–06:00 深色，其他時間白底 (預設)' },
  { choice: 'system', label: '跟手機', note: '手機設成深色，這裡就跟著深色' },
  { choice: 'dark', label: '一直深色', note: '一直是深色' },
  { choice: 'light', label: '一直白底', note: '一直是白底' },
];

export function nightModeLabel(choice: NightModeChoice): string {
  return NIGHT_MODE_OPTIONS.find((option) => option.choice === choice)?.label ?? NIGHT_MODE_OPTIONS[0].label;
}

export function nightModeNote(choice: NightModeChoice): string {
  return NIGHT_MODE_OPTIONS.find((option) => option.choice === choice)?.note ?? NIGHT_MODE_OPTIONS[0].note;
}

export function parseNightModeChoice(value: unknown): NightModeChoice {
  return value === 'auto' || value === 'system' || value === 'dark' || value === 'light' ? value : DEFAULT_NIGHT_MODE;
}

/** 18:00 up to (not including) 06:00, by the phone's local clock. */
export function isNightTime(now: Date): boolean {
  const hour = now.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

export function resolveScheme(choice: NightModeChoice, now: Date, system: Scheme | null): Scheme {
  if (choice === 'dark') return 'dark';
  if (choice === 'light') return 'light';
  if (choice === 'system') return system === 'dark' ? 'dark' : 'light';
  return isNightTime(now) ? 'dark' : 'light';
}

/** The next 06:00 or 18:00 after `now` (local time): the one moment 晚上自動 can change by itself. */
export function nextNightBoundary(now: Date): Date {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  const hour = now.getHours();
  if (hour < NIGHT_END_HOUR) next.setHours(NIGHT_END_HOUR);
  else if (hour < NIGHT_START_HOUR) next.setHours(NIGHT_START_HOUR);
  else { next.setDate(next.getDate() + 1); next.setHours(NIGHT_END_HOUR); }
  return next;
}

export interface NightModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NightModeSystem {
  /** The phone's own scheme; null when it cannot be read. */
  current(): Scheme | null;
  /** Called whenever the phone's scheme changes. */
  subscribe(listener: (scheme: Scheme | null) => void): () => void;
  /** Make the app's native parts (dialogs, keyboard, system bars) show `scheme`; 'unspecified' gives them back to the phone. */
  apply(scheme: Scheme | 'unspecified'): void;
}

export interface NightModeClock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface NightModeSnapshot { choice: NightModeChoice; scheme: Scheme }

export const NIGHT_MODE_KEY = 'qingmu.nightMode.v1';
export const NIGHT_MODE_NEWS_KEY = 'qingmu.nightMode.news.v1';

/**
 * The one owner of the choice and the scheme on screen. 晚上自動 changes by itself only at 06:00 and 18:00, so it keeps
 * a single timer to the next of those moments (no polling); `refresh` re-reads the clock when the app comes back to
 * the foreground, where a phone may have slept through the moment or changed its time zone.
 */
export function createNightModeController({ storage, system, clock }: { storage: NightModeStorage; system: NightModeSystem; clock: NightModeClock }) {
  let choice = readChoice();
  let systemScheme = system.current();
  let snapshot: NightModeSnapshot = { choice, scheme: resolveScheme(choice, clock.now(), systemScheme) };
  let timer: unknown = null;
  let applied: Scheme | 'unspecified' | null = null;
  const listeners = new Set<() => void>();
  let unsubscribeSystem: (() => void) | null = null;

  function readChoice(): NightModeChoice {
    try { return parseNightModeChoice(storage.getItem(NIGHT_MODE_KEY)); } catch { return DEFAULT_NIGHT_MODE; }
  }

  function applyNative() {
    // 跟手機 hands the native parts back to the phone; the other three tell them which scheme the app shows.
    const wanted = choice === 'system' ? 'unspecified' : snapshot.scheme;
    if (wanted === applied) return;
    applied = wanted;
    try { system.apply(wanted); } catch { /* the app's own screens still follow the snapshot */ }
  }

  function schedule() {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    if (choice !== 'auto' || listeners.size === 0) return;
    const now = clock.now();
    const wait = Math.max(1000, nextNightBoundary(now).getTime() - now.getTime());
    timer = clock.setTimeout(() => { timer = null; update(); }, wait);
  }

  function update() {
    const next: NightModeSnapshot = { choice, scheme: resolveScheme(choice, clock.now(), systemScheme) };
    const changed = next.choice !== snapshot.choice || next.scheme !== snapshot.scheme;
    snapshot = next;
    applyNative();
    schedule();
    if (changed) listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: (): NightModeSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeSystem = system.subscribe((scheme) => {
          // While the app tells the native parts which scheme to show, the reported scheme is the app's own, not the
          // phone's; only 跟手機 listens to it.
          if (choice !== 'system') return;
          systemScheme = scheme;
          update();
        });
        update();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeSystem?.(); unsubscribeSystem = null;
          if (timer !== null) { clock.clearTimeout(timer); timer = null; }
        }
      };
    },
    setChoice(next: NightModeChoice) {
      if (next === choice) return;
      choice = next;
      try { storage.setItem(NIGHT_MODE_KEY, next); } catch { /* still applies until the app closes */ }
      if (next === 'system') {
        // Hand the native parts back first, then read what the phone itself says.
        applyNative();
        systemScheme = system.current();
      }
      update();
    },
    refresh() {
      if (choice === 'system') systemScheme = system.current();
      update();
    },
    /** For tests: the pending timer's delay is what proves there is one timer and no polling. */
    hasTimer: () => timer !== null,
  };
}

export type NightModeController = ReturnType<typeof createNightModeController>;

/**
 * The 新功能 card (光佑 2026-11-04): once per phone, after the update; any of its buttons puts it away for good.
 */
export function createNightModeNews(storage: NightModeStorage) {
  let seen = (() => { try { return storage.getItem(NIGHT_MODE_NEWS_KEY) === 'seen'; } catch { return false; } })();
  return {
    shouldShow: () => !seen,
    dismiss() {
      seen = true;
      try { storage.setItem(NIGHT_MODE_NEWS_KEY, 'seen'); } catch { /* shown again next start at worst */ }
    },
  };
}
