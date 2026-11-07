import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import { makeStyles } from '../useAppTheme';

/**
 * A 週刊 page before its picture is in (2026-10-20): on LTE the list stayed white for 2–5 s with nothing to say why
 * (Pixel, 0.5.35). Every page now shows a grey box its own shape with 週刊載入中…, and says when it could not be
 * loaded; a tap asks for it again. Used by the list (BulletinBoard) and full screen (ZoomablePage).
 */
export const PAGE_LOADING = '週刊載入中…';
export const PAGE_FAILED = '這頁載不到，點一下再試';
// The box is colors.imagePlaceholder: grey enough to read as "something is coming" against the page cards, with
// colors.muted on it at 4.5:1 or more in both schemes (scripts/check-contrast.ts).

export type PageLoad = 'loading' | 'ready' | 'error';

/**
 * One picture's state. `attempt` is the key of its Image: a retry mounts a new Image, which asks for the picture again
 * (React Native's image loaders keep no record of a failure).
 */
export function usePageLoad() {
  const [state, setState] = useState<PageLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  return {
    state,
    attempt,
    onLoad: () => setState('ready'),
    onError: () => setState('error'),
    retry: () => { setState('loading'); setAttempt((count) => count + 1); },
  };
}

/** The grey box over the whole page, with its line (none when the line is shown elsewhere). */
export function PageStatus({ text }: { text?: string }) {
  const styles = useStyles();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.box]}>
    {text ? <Text style={styles.text}>{text}</Text> : null}
  </View>;
}

const useStyles = makeStyles((colors) => ({
  box: { backgroundColor: colors.imagePlaceholder, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.md },
  text: { color: colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700', textAlign: 'center' },
}));
