import { describe, expect, it, vi } from 'vitest';
import {
  createNightModeController, createNightModeNews, isNightTime, nextNightBoundary, NIGHT_MODE_KEY, NIGHT_MODE_NEWS_KEY, NIGHT_MODE_OPTIONS,
  resolveScheme, type NightModeChoice, type NightModeClock, type Scheme,
} from '../../src/services/nightMode';

// 夜間模式 (光佑 2026-11-04, docs/features/night-mode.md). Times are the phone's local clock.
const at = (hhmm: string, day = '2026-11-04') => new Date(`${day}T${hhmm}:00`);

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

function fakeSystem(initial: Scheme | null) {
  let scheme = initial;
  const listeners = new Set<(scheme: Scheme | null) => void>();
  const applied: Array<Scheme | 'unspecified'> = [];
  return {
    applied,
    /** The phone's own setting changes (Settings → Display). */
    flip(next: Scheme) { scheme = next; listeners.forEach((listener) => listener(next)); },
    system: {
      current: () => scheme,
      subscribe: (listener: (scheme: Scheme | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      apply: (value: Scheme | 'unspecified') => { applied.push(value); },
    },
  };
}

/** A clock whose timers are visible: the test sees every one the controller asks for and its delay. */
function fakeClock(start: Date) {
  let now = start.getTime();
  let seq = 0;
  const timers = new Map<number, { at: number; ms: number; run: () => void }>();
  const clock: NightModeClock = {
    now: () => new Date(now),
    setTimeout: (run, ms) => { const id = ++seq; timers.set(id, { at: now + ms, ms, run }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
  };
  return {
    clock, timers,
    /** Moves the clock forward and runs every timer that falls due, as the phone would. */
    advanceTo(next: Date) {
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= next.getTime()).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].run();
      }
      now = next.getTime();
    },
  };
}

describe('the four choices', () => {
  const cases: Array<[NightModeChoice, string, Scheme | null, Scheme]> = [
    ['auto', '17:59', null, 'light'], ['auto', '18:00', null, 'dark'], ['auto', '05:59', null, 'dark'], ['auto', '06:00', null, 'light'],
    ['dark', '17:59', null, 'dark'], ['dark', '18:00', null, 'dark'], ['dark', '05:59', null, 'dark'], ['dark', '06:00', null, 'dark'],
    ['light', '17:59', null, 'light'], ['light', '18:00', null, 'light'], ['light', '05:59', null, 'light'], ['light', '06:00', null, 'light'],
    ['system', '17:59', 'dark', 'dark'], ['system', '18:00', 'light', 'light'], ['system', '05:59', 'light', 'light'], ['system', '06:00', 'dark', 'dark'],
  ];
  it.each(cases)('%s at %s (phone %s) shows %s', (choice, time, system, expected) => {
    expect(resolveScheme(choice, at(time), system)).toBe(expected);
  });

  it('晚上自動 counts 18:00 and stops before 06:00, by fixed hours', () => {
    expect(isNightTime(at('18:00'))).toBe(true);
    expect(isNightTime(at('17:59'))).toBe(false);
    expect(isNightTime(at('05:59'))).toBe(true);
    expect(isNightTime(at('06:00'))).toBe(false);
    expect(isNightTime(at('00:00'))).toBe(true);
    expect(isNightTime(at('12:00'))).toBe(false);
  });

  it('names the choices with the approved words, in order', () => {
    expect(NIGHT_MODE_OPTIONS.map((option) => option.label)).toEqual(['晚上自動', '跟手機', '一直深色', '一直白底']);
    expect(NIGHT_MODE_OPTIONS.map((option) => option.note)).toEqual([
      '18:00–06:00 深色，其他時間白底 (預設)', '手機設成深色，這裡就跟著深色', '一直是深色', '一直是白底',
    ]);
  });

  it('the next moment 晚上自動 can change is the next 06:00 or 18:00', () => {
    expect(nextNightBoundary(at('05:59'))).toEqual(at('06:00'));
    expect(nextNightBoundary(at('06:00'))).toEqual(at('18:00'));
    expect(nextNightBoundary(at('17:59'))).toEqual(at('18:00'));
    expect(nextNightBoundary(at('18:00'))).toEqual(at('06:00', '2026-11-05'));
    expect(nextNightBoundary(at('23:30'))).toEqual(at('06:00', '2026-11-05'));
  });
});

describe('the controller', () => {
  it('starts with 晚上自動 on a phone that never chose, and keeps a choice across restarts', () => {
    const storage = memoryStorage();
    const first = createNightModeController({ storage, system: fakeSystem('light').system, clock: fakeClock(at('20:00')).clock });
    expect(first.getSnapshot()).toEqual({ choice: 'auto', scheme: 'dark' });
    first.setChoice('light');
    expect(storage.values.get(NIGHT_MODE_KEY)).toBe('light');
    // The app is closed and opened again.
    const second = createNightModeController({ storage, system: fakeSystem('light').system, clock: fakeClock(at('20:00')).clock });
    expect(second.getSnapshot()).toEqual({ choice: 'light', scheme: 'light' });
  });

  it('reads an unknown stored value as the default', () => {
    const controller = createNightModeController({ storage: memoryStorage({ [NIGHT_MODE_KEY]: 'purple' }), system: fakeSystem(null).system, clock: fakeClock(at('09:00')).clock });
    expect(controller.getSnapshot().choice).toBe('auto');
  });

  it('跟手機 follows the phone the moment it changes', () => {
    const phone = fakeSystem('light');
    const controller = createNightModeController({ storage: memoryStorage(), system: phone.system, clock: fakeClock(at('12:00')).clock });
    const seen: Scheme[] = [];
    const stop = controller.subscribe(() => seen.push(controller.getSnapshot().scheme));
    controller.setChoice('system');
    expect(controller.getSnapshot().scheme).toBe('light');
    seen.length = 0;
    phone.flip('dark');
    expect(controller.getSnapshot().scheme).toBe('dark');
    phone.flip('light');
    expect(controller.getSnapshot().scheme).toBe('light');
    expect(seen).toEqual(['dark', 'light']);
    // The app hands its native parts back to the phone instead of forcing a scheme.
    expect(phone.applied.at(-1)).toBe('unspecified');
    stop();
  });

  it('ignores the reported scheme while it forces one itself (the report is then its own)', () => {
    const phone = fakeSystem('light');
    const controller = createNightModeController({ storage: memoryStorage(), system: phone.system, clock: fakeClock(at('12:00')).clock });
    const stop = controller.subscribe(() => undefined);
    controller.setChoice('dark');
    expect(phone.applied.at(-1)).toBe('dark');
    phone.flip('light');
    expect(controller.getSnapshot().scheme).toBe('dark');
    stop();
  });

  it('while open, 晚上自動 turns dark at 18:00 and light at 06:00 with one timer to the next boundary, never polling', () => {
    const time = fakeClock(at('17:30'));
    const phone = fakeSystem('light');
    const controller = createNightModeController({ storage: memoryStorage(), system: phone.system, clock: time.clock });
    const stop = controller.subscribe(() => undefined);
    expect(controller.getSnapshot().scheme).toBe('light');
    expect([...time.timers.values()].map((timer) => timer.ms)).toEqual([30 * 60_000]);
    time.advanceTo(at('17:59'));
    expect(controller.getSnapshot().scheme).toBe('light');
    time.advanceTo(at('18:00'));
    expect(controller.getSnapshot().scheme).toBe('dark');
    expect(phone.applied.at(-1)).toBe('dark');
    // Twelve hours to the next one, still a single timer.
    expect([...time.timers.values()].map((timer) => timer.ms)).toEqual([12 * 3_600_000]);
    time.advanceTo(at('05:59', '2026-11-05'));
    expect(controller.getSnapshot().scheme).toBe('dark');
    time.advanceTo(at('06:00', '2026-11-05'));
    expect(controller.getSnapshot().scheme).toBe('light');
    expect(time.timers.size).toBe(1);
    stop();
    expect(time.timers.size).toBe(0);
  });

  it('keeps no timer for the choices that never change by the clock', () => {
    const time = fakeClock(at('17:30'));
    const controller = createNightModeController({ storage: memoryStorage(), system: fakeSystem('light').system, clock: time.clock });
    const stop = controller.subscribe(() => undefined);
    for (const choice of ['dark', 'light', 'system'] as const) {
      controller.setChoice(choice);
      expect(time.timers.size, choice).toBe(0);
    }
    controller.setChoice('auto');
    expect(time.timers.size).toBe(1);
    stop();
  });

  it('catches up when the app comes back after a boundary it slept through', () => {
    const time = fakeClock(at('17:30'));
    const controller = createNightModeController({ storage: memoryStorage(), system: fakeSystem('light').system, clock: time.clock });
    const stop = controller.subscribe(() => undefined);
    // The phone slept and its timer did not run; the clock moved on anyway.
    time.timers.clear();
    time.advanceTo(at('19:10'));
    expect(controller.getSnapshot().scheme).toBe('light');
    controller.refresh();
    expect(controller.getSnapshot().scheme).toBe('dark');
    stop();
  });

  it('survives storage that cannot be read or written', () => {
    const broken = { getItem: vi.fn(() => { throw new Error('locked'); }), setItem: vi.fn(() => { throw new Error('locked'); }) };
    const controller = createNightModeController({ storage: broken, system: fakeSystem('light').system, clock: fakeClock(at('09:00')).clock });
    expect(controller.getSnapshot().choice).toBe('auto');
    controller.setChoice('dark');
    expect(controller.getSnapshot()).toEqual({ choice: 'dark', scheme: 'dark' });
  });
});

describe('the 新功能 card', () => {
  it('shows once per phone: any button puts it away for good', () => {
    const storage = memoryStorage();
    const first = createNightModeNews(storage);
    expect(first.shouldShow()).toBe(true);
    first.dismiss();
    expect(first.shouldShow()).toBe(false);
    expect(storage.values.get(NIGHT_MODE_NEWS_KEY)).toBe('seen');
    // Next start of the app on the same phone.
    expect(createNightModeNews(storage).shouldShow()).toBe(false);
  });

  it('shows again on a start where nothing was pressed', () => {
    const storage = memoryStorage();
    expect(createNightModeNews(storage).shouldShow()).toBe(true);
    expect(createNightModeNews(storage).shouldShow()).toBe(true);
  });
});
