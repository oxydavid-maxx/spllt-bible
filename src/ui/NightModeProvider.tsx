import * as SecureStore from 'expo-secure-store';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createNightModeController, createNightModeNews, type NightModeController, type NightModeStorage, type NightModeSystem, type Scheme } from '../services/nightMode';
import { NightModeContext, type NightModeBinding } from './nightModeContext';
import { colorsFor } from './Theme';
import { AppThemeScope, setShownScheme } from './useAppTheme';
import { NightModeNewsHost } from './NightModeNewsHost';

/**
 * 夜間模式 at the root (光佑 2026-11-04, docs/features/night-mode.md): the choice, the scheme on screen, the 新功能
 * card. Everything below reads its colours through src/ui/useAppTheme.ts; the navigation bars and headers get the
 * same colours through expo-router's theme, and the status bar follows.
 *
 * Kept on this phone only (expo-secure-store, like the other phone-only settings), read synchronously at start so
 * a dark night opens dark rather than flashing white first.
 *
 * The CI simulator (EXPO_PUBLIC_QINGMU_FIXTURE) must not turn dark or show the 新功能 card just because the runner's
 * clock reads 18:00–06:00 or the app was just installed: there 晚上自動 reads noon, and the card shows only when a
 * flow asks with the launch argument `qingmuWhatsNew: show` (.maestro/ios/45-night-mode.yaml). A real build never
 * reads either.
 */
const FIXTURE = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';

function readNative(): { Appearance?: { getColorScheme(): string | null | undefined; setColorScheme(scheme: string): void; addChangeListener(listener: (value: { colorScheme?: string | null }) => void): { remove(): void } }; AppState?: { addEventListener(event: 'change', listener: (state: string) => void): { remove(): void } }; Settings?: { get(key: string): unknown } } {
  // Named properties of require, never a wildcard or import() (AGENTS.md iOS note 1); read when used, so a test's
  // react-native double without them leaves the app light instead of failing to load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require('react-native') as Record<string, unknown>;
  const pick = <T,>(name: string): T | undefined => { try { return native[name] as T | undefined; } catch { return undefined; } };
  return { Appearance: pick('Appearance'), AppState: pick('AppState'), Settings: pick('Settings') };
}

const asScheme = (value: unknown): Scheme | null => (value === 'dark' ? 'dark' : value === 'light' ? 'light' : null);

export const nativeNightModeStorage: NightModeStorage = {
  getItem: (key) => SecureStore.getItem(key),
  setItem: (key, value) => SecureStore.setItem(key, value),
};

function nativeSystem(): NightModeSystem {
  return {
    current: () => { try { return asScheme(readNative().Appearance?.getColorScheme()); } catch { return null; } },
    subscribe: (listener) => {
      try {
        const subscription = readNative().Appearance?.addChangeListener(({ colorScheme }) => listener(asScheme(colorScheme)));
        return () => subscription?.remove();
      } catch { return () => undefined; }
    },
    // React Native's own override (iOS: the window's interface style; Android: AppCompat's night mode, which the
    // activity takes without restarting because its manifest handles uiMode).
    apply: (scheme) => { readNative().Appearance?.setColorScheme(scheme); },
  };
}

/** Noon today: the CI simulator's 晚上自動 never depends on when the runner happens to run. */
function fixtureNoon(): Date {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  return noon;
}

function fixtureLaunchArgument(key: string): unknown {
  if (!FIXTURE) return undefined;
  try { return readNative().Settings?.get(key); } catch { return undefined; }
}

let shared: { controller: NightModeController; news: ReturnType<typeof createNightModeNews> } | null = null;
function nativeNightMode() {
  if (!shared) {
    shared = {
      controller: createNightModeController({
        storage: nativeNightModeStorage,
        system: nativeSystem(),
        clock: {
          now: FIXTURE ? fixtureNoon : () => new Date(),
          setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      }),
      news: createNightModeNews(nativeNightModeStorage),
    };
  }
  return shared;
}

/** Re-reads the clock and the phone when the app comes back: a phone asleep at 18:00 may not have run the timer. */
function ForegroundRefresh({ controller }: { controller: NightModeController }) {
  useEffect(() => {
    try {
      const subscription = readNative().AppState?.addEventListener('change', (state) => { if (state === 'active') controller.refresh(); });
      return () => subscription?.remove();
    } catch { return undefined; }
  }, [controller]);
  return null;
}

export function NightModeProvider({ controller: given, news: givenNews, children }: {
  controller?: NightModeController;
  news?: { shouldShow(): boolean; dismiss(): void };
  children?: ReactNode;
}) {
  const [{ controller, news }] = useState(() => (given ? { controller: given, news: givenNews ?? { shouldShow: () => false, dismiss: () => undefined } } : nativeNightMode()));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { setShownScheme(snapshot.scheme); }, [snapshot.scheme]);
  const [newsDue, setNewsDue] = useState(() => (given ? news.shouldShow() : (FIXTURE ? fixtureLaunchArgument('qingmuWhatsNew') === 'show' : news.shouldShow())));
  const binding = useMemo<NightModeBinding>(() => ({
    choice: snapshot.choice,
    setChoice: (choice) => controller.setChoice(choice),
    newsDue,
    dismissNews: () => { news.dismiss(); setNewsDue(false); },
  }), [snapshot.choice, controller, news, newsDue]);
  const navigationTheme = useMemo(() => {
    const colors = colorsFor(snapshot.scheme);
    const base = snapshot.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, dark: snapshot.scheme === 'dark', colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.ink, border: colors.border, notification: colors.dangerFill } };
  }, [snapshot.scheme]);
  // ForegroundRefresh comes first, so its foreground listener is in place before the app's own.
  return <NightModeContext.Provider value={binding}>
    <ForegroundRefresh controller={controller} />
    <AppThemeScope scheme={snapshot.scheme}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={snapshot.scheme === 'dark' ? 'light' : 'dark'} />
        {children}
        <NightModeNewsHost />
      </ThemeProvider>
    </AppThemeScope>
  </NightModeContext.Provider>;
}
