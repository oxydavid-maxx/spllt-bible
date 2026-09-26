import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchUpdateState, NO_UPDATE, type UpdateState } from '../services/updateCheck';
import { theme } from './Theme';

function installedVersionCode(): number | null {
  const code = Number(Application.nativeBuildVersion);
  return Number.isInteger(code) && code > 0 ? code : null;
}

/**
 * 光佑 (2026-09-26): until the Play listing exists, every member needs a button that takes them to
 * the newest build, however many releases they skipped. The one-line notice (UpdateBanner) ended up
 * at the bottom of the reader's 更多閱讀工具 sheet after the reader redesign, where nobody saw it.
 *
 * So this opens over whatever screen is showing, sign-in included, when the app starts and each time
 * it comes back to the foreground. 更新 opens the install page in the browser, which always carries
 * the newest APK — the same Chrome flow its steps describe. 稍後 puts it away until the next time the
 * app comes back, and a mandatory release asks just as often. It never locks anyone out: a phone that
 * cannot install the new build still gets today's reading.
 */
export function UpdatePrompt({
  check = () => fetchUpdateState(installedVersionCode()),
  open = (url: string) => { void Linking.openURL(url).catch(() => undefined); },
}: {
  check?: () => Promise<UpdateState>;
  open?: (url: string) => void;
}) {
  const [state, setState] = useState<UpdateState>(NO_UPDATE);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    const ask = () => {
      void check().then((next) => {
        if (!active) return;
        setState(next);
        setDismissed(false);
      });
    };
    ask();
    const subscription = AppState.addEventListener('change', (status) => { if (status === 'active') ask(); });
    return () => { active = false; subscription.remove(); };
    // `check` is fixed for the life of the prompt; re-subscribing on every render would re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = state.available && !dismissed;
  return <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setDismissed(true)}>
    <View style={styles.scrim}>
      <View style={styles.card} accessibilityViewIsModal accessibilityLabel="有新版本">
        <Text accessibilityRole="header" style={styles.title}>{`有新版本 ${state.versionName ?? ''}`}</Text>
        {state.note ? <Text style={styles.note}>{state.note}</Text> : null}
        <Text style={styles.hint}>按「更新」會打開安裝頁，照步驟下載後按「更新」，資料都會保留。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`更新到 ${state.versionName}`}
          onPress={() => { if (state.url) open(state.url); }} style={styles.update}>
          <Text style={styles.updateText}>更新</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="稍後再說" onPress={() => setDismissed(true)} style={styles.later}>
          <Text style={styles.laterText}>稍後</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: theme.spacing.xl },
  card: { borderRadius: theme.radius.card, backgroundColor: theme.colors.surface, padding: theme.spacing.xl, gap: theme.spacing.md },
  title: { color: theme.colors.ink, fontSize: theme.type.label.size + 4, fontWeight: '800' },
  note: { color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.size + 8 },
  hint: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  update: { minHeight: theme.control.tap + 8, justifyContent: 'center', alignItems: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  updateText: { color: theme.colors.white, fontSize: theme.type.label.size + 2, fontWeight: '800' },
  later: { minHeight: theme.control.tap, justifyContent: 'center', alignItems: 'center' },
  laterText: { color: theme.colors.muted, fontSize: theme.type.label.size, fontWeight: '700' },
});
