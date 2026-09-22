import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchUpdateState, NO_UPDATE, type UpdateState } from '../services/updateCheck';
import { theme } from './Theme';

/**
 * One line at the top of the reading tab when a newer build exists.
 *
 * Deliberately not a modal. The native equivalent — Play's immediate in-app update — takes over the
 * screen and is the right shape for a mandatory security fix, but it needs a Play Core native
 * module and this project does not prebuild. Between "interrupt everybody with a dialog we wrote
 * ourselves" and "a line they can act on or ignore", the line is the honest version of what this
 * can actually enforce.
 *
 * When the published record says mandatory, the dismiss control is simply absent. That is as far as
 * enforcement goes without native support, and pretending otherwise would be worse than the limit.
 *
 * Nothing is rendered until the check answers, and a failed check renders nothing at all — a member
 * with no signal gets their reading, not an error.
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>(NO_UPDATE);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    const installed = Application.nativeBuildVersion ? Number(Application.nativeBuildVersion) : null;
    void fetchUpdateState(Number.isFinite(installed) ? installed : null).then((next) => {
      if (active) setState(next);
    });
    return () => { active = false; };
  }, []);

  if (!state.available || (dismissed && !state.mandatory)) return null;

  return <View style={[styles.banner, state.mandatory && styles.mandatory]} accessibilityLabel="有新版本">
    <View style={styles.copy}>
      {/* On the mandatory variant the background IS primary, so ink-on-primary and muted-on-primary
          both fall below readable contrast. The text has to change with the background, not sit on
          top of it unchanged. */}
      <Text style={[styles.title, state.mandatory && styles.onPrimary]}>{`有新版本 ${state.versionName}`}</Text>
      {state.note ? <Text style={[styles.note, state.mandatory && styles.onPrimarySoft]} numberOfLines={2}>{state.note}</Text> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`更新到 ${state.versionName}`}
      onPress={() => { if (state.url) void WebBrowser.openBrowserAsync(state.url); }}
      style={[styles.action, state.mandatory && styles.actionOnPrimary]}>
      <Text style={[styles.actionText, state.mandatory && styles.actionTextOnPrimary]}>更新</Text>
    </Pressable>
    {state.mandatory ? null : <Pressable accessibilityRole="button" accessibilityLabel="稍後再說"
      onPress={() => setDismissed(true)} style={styles.dismiss}>
      <Text style={styles.dismissText}>稍後</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.card, backgroundColor: theme.colors.primarySoft, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  mandatory: { backgroundColor: theme.colors.primary },
  copy: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  title: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  onPrimary: { color: theme.colors.white },
  onPrimarySoft: { color: 'rgba(255,255,255,0.86)' },
  action: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  actionText: { color: theme.colors.white, fontSize: theme.type.label.size, fontWeight: '800' },
  actionOnPrimary: { backgroundColor: theme.colors.white },
  actionTextOnPrimary: { color: theme.colors.primaryDeep },
  dismiss: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  dismissText: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
});
