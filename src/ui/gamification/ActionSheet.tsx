import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAndroidKeyboardVisible } from '../useAndroidKeyboardVisible';
import { theme } from '../Theme';

export interface ActionSheetAction { label: string; onPress: () => void; destructive?: boolean; disabled?: boolean; }
/**
 * `dismissOnOutsideTap` is per sheet, not global, and the default is the safe one.
 *
 * A sheet that only shows things should close when you tap away; that is what people expect and it
 * was missing. But some of these hold work in progress — a redemption being confirmed in front of a
 * student, a reason being typed, a camera mid-scan — and closing those on a stray tap loses what
 * someone was doing. Each caller says which kind it is.
 */
export function ActionSheet({ visible, title, actions, onClose, children, dismissOnOutsideTap = false }: { visible: boolean; title: string; actions?: ActionSheetAction[]; onClose: () => void; children?: React.ReactNode; dismissOnOutsideTap?: boolean }) {
  const androidKeyboardVisible = useAndroidKeyboardVisible();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
    <SafeAreaProvider><KeyboardAvoidingView style={styles.keyboardRoot} behavior="padding" enabled={Platform.OS !== 'android' || androidKeyboardVisible}><Pressable accessibilityRole={dismissOnOutsideTap ? 'button' : 'none'} accessibilityLabel={dismissOnOutsideTap ? `關閉${title}` : undefined} onPress={dismissOnOutsideTap ? onClose : undefined} style={styles.scrim}><Pressable onPress={() => undefined}><SafeAreaView style={styles.sheet} edges={['bottom', 'left', 'right']}><View style={styles.heading}><Text style={styles.title}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="關閉操作" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View><ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">{children}{actions?.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label} disabled={action.disabled} onPress={action.onPress} style={[styles.action, action.destructive && styles.destructive, action.disabled && styles.disabled]}><Text style={[styles.actionText, action.destructive && styles.destructiveText]}>{action.label}</Text></Pressable>)}</ScrollView></SafeAreaView></Pressable></Pressable></KeyboardAvoidingView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,48,42,0.28)' },
  sheet: { width: '100%', maxHeight: '85%', backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  keyboardRoot: { flex: 1 },
  heading: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  title: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800', flexShrink: 1 },
  close: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: theme.colors.ink, fontSize: 28 },
  body: { flexShrink: 1, minHeight: 0 },
  bodyContent: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm },
  action: { minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  actionText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '800' },
  destructive: { backgroundColor: theme.colors.accentSoft },
  destructiveText: { color: theme.colors.accent },
  disabled: { opacity: 0.45 },
});
