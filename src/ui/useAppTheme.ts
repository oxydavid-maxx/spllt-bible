import { createContext, createElement, useContext, type ReactNode } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { colorsFor, type AppColors, type ColorScheme } from './Theme';

/**
 * The scheme the app shows now (夜間模式, docs/features/night-mode.md) and its colours. src/ui/NightModeProvider.tsx
 * supplies it at the root; anything rendered without that provider (component tests) is light.
 *
 * A screen reads colours here while it renders, never when its file loads: a style made at load time keeps the
 * colours of that moment, and the screen would stay white after the app turned dark at 18:00.
 */
export interface AppTheme { scheme: ColorScheme; colors: AppColors }

const themes: Partial<Record<ColorScheme, AppTheme>> = {};

export function appThemeFor(scheme: ColorScheme): AppTheme {
  const existing = themes[scheme];
  if (existing) return existing;
  const made: AppTheme = Object.freeze({ scheme, colors: colorsFor(scheme) });
  themes[scheme] = made;
  return made;
}

/** Only the scheme travels through React; its colours are looked up when a component renders. */
export const AppThemeContext = createContext<ColorScheme>('light');

export function AppThemeScope({ scheme, children }: { scheme: ColorScheme; children?: ReactNode }) {
  return createElement(AppThemeContext.Provider, { value: scheme }, children);
}

let shownScheme: ColorScheme = 'light';

/** NightModeProvider reports the scheme on screen, for the few things drawn outside React (the OTA reload screen). */
export function setShownScheme(scheme: ColorScheme): void {
  shownScheme = scheme;
}

/** The colours on screen right now, read when called. Only inside a function: read when a file loads, it stays light. */
export function currentColors(): AppColors {
  return colorsFor(shownScheme);
}

export function useAppTheme(): AppTheme {
  return appThemeFor(useContext(AppThemeContext));
}

export function useColors(): AppColors {
  return appThemeFor(useContext(AppThemeContext)).colors;
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * `const useStyles = makeStyles((colors) => ({ ... }))` at the bottom of a screen file, `const styles = useStyles()`
 * in each component. One style sheet per scheme, made the first time a component asks for it and then shared.
 * Typed like StyleSheet.create, so a misspelt style key still fails the typecheck.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<any>>(factory: (colors: AppColors) => T & NamedStyles<any>): () => T {
  const made: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const scheme = useContext(AppThemeContext);
    const existing = made[scheme];
    if (existing) return existing;
    const created = StyleSheet.create(factory(colorsFor(scheme))) as T;
    made[scheme] = created;
    return created;
  };
}
