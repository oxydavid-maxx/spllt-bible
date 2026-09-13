import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useEffect, useState } from 'react';
import { theme } from './Theme';
import { buildReminderSettingsModel, type ReminderSettingsModelInput } from './reminderSettingsModel';
export { buildReminderSettingsModel } from './reminderSettingsModel';

export function ReminderSettings({
  ready = true,
  error = null,
  saving = false,
  onRetry,
  readingEnabled,
  meetingEnabled,
  remoteDeliveryStatus,
  permission,
  onReadingChange,
  onMeetingChange,
  onOpenSettings,
  readingTime,
  meetingAdvanceMinutes,
  onReadingTimeChange,
  onMeetingAdvanceChange,
}: ReminderSettingsModelInput & {
  onReadingChange: (enabled: boolean) => void;
  onMeetingChange: (enabled: boolean) => void;
  onOpenSettings?: () => void;
  onRetry?: () => Promise<void>;
  onReadingTimeChange: (value: string) => void;
  onMeetingAdvanceChange: (value: number) => void;
}) {
  const [draftReadingTime, setDraftReadingTime] = useState(readingTime);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => { setDraftReadingTime(readingTime); }, [readingTime]);
  const model = buildReminderSettingsModel({ ready, error, saving, readingEnabled, meetingEnabled, remoteDeliveryStatus, permission, readingTime, meetingAdvanceMinutes });
  return (
    <View accessibilityLabel="提醒設定" style={styles.card}>
      <Text style={styles.title}>提醒</Text>
      <Text accessibilityLabel="提醒設定狀態" accessibilityLiveRegion="polite" accessibilityRole={error ? 'alert' : undefined} style={styles.body}>{model.readinessLabel}</Text>
      {error && onRetry ? <Pressable accessibilityRole="button" accessibilityLabel={error === 'load' ? '重試讀取提醒設定' : '重試儲存提醒設定'} disabled={retrying} onPress={() => { setRetrying(true); void onRetry().catch(() => undefined).finally(() => setRetrying(false)); }} style={styles.button}><Text style={styles.buttonText}>{retrying ? '重試中…' : error === 'load' ? '重新讀取' : '重試儲存'}</Text></Pressable> : null}
      <Pressable style={styles.row} accessibilityRole="switch" accessibilityLabel="讀經提醒列" accessibilityState={{ checked: readingEnabled }} onPress={() => onReadingChange(!readingEnabled)}>
        <View style={styles.copy}><Text style={styles.label}>讀經提醒</Text><Text style={styles.body}>{model.permissionLabel}</Text></View>
        <Switch accessibilityLabel="讀經提醒" value={readingEnabled} onValueChange={onReadingChange} />
      </Pressable>
      <View style={styles.timeRow}>
        <Text style={styles.label}>{model.readingTimeLabel}</Text>
        <TextInput accessibilityLabel="每日讀經時間" value={draftReadingTime} onChangeText={setDraftReadingTime} onEndEditing={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(draftReadingTime)) onReadingTimeChange(draftReadingTime); }} placeholder="08:00" keyboardType="numbers-and-punctuation" style={styles.timeInput} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.label}>{model.meetingAdvanceLabel}</Text>
        <View style={styles.chips}>{[5, 15, 30, 60].map((minutes) => <Pressable key={minutes} accessibilityRole="button" accessibilityLabel={`聚會提前${minutes}分鐘`} accessibilityState={{ selected: meetingAdvanceMinutes === minutes }} onPress={() => onMeetingAdvanceChange(minutes)} style={[styles.chip, meetingAdvanceMinutes === minutes && styles.chipActive]}><Text style={[styles.chipText, meetingAdvanceMinutes === minutes && styles.chipTextActive]}>{minutes}</Text></Pressable>)}</View>
      </View>
      <Pressable style={styles.row} accessibilityRole="switch" accessibilityLabel="聚會提醒列" accessibilityState={{ checked: meetingEnabled }} onPress={() => onMeetingChange(!meetingEnabled)}>
        <View style={styles.copy}><Text style={styles.label}>聚會提醒</Text><Text style={styles.body}>{model.deliveryLabel}</Text></View>
        <Switch accessibilityLabel="聚會提醒" value={meetingEnabled} onValueChange={onMeetingChange} />
      </Pressable>
      {permission === 'denied' && onOpenSettings ? <Pressable accessibilityRole="button" accessibilityLabel="開啟系統通知設定" onPress={onOpenSettings} style={styles.button}><Text style={styles.buttonText}>開啟系統設定</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Settings read as a ruled list: one hairline-separated row per decision, each
  // row at least 52dp. Control boundaries move to borderStrong (3.57:1) so the
  // text field and the unselected chips satisfy WCAG 1.4.11; border was 1.53:1.
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.xs },
  title: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  row: { minHeight: 52, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, paddingTop: theme.spacing.xs },
  copy: { flex: 1, gap: theme.spacing.xxs },
  label: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  body: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  button: { minHeight: theme.control.tap, borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft, borderWidth: 1.5, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: theme.colors.accent, fontSize: theme.type.label.size, fontWeight: '700' },
  timeRow: { borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, gap: theme.spacing.xs, paddingTop: theme.spacing.sm },
  timeInput: { minHeight: theme.control.tap, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, borderRadius: theme.radius.button, color: theme.colors.ink, fontSize: theme.type.body.size, paddingHorizontal: theme.spacing.md },
  chips: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
  chip: { minWidth: theme.control.tap, minHeight: theme.control.tapCompact, alignItems: 'center', justifyContent: 'center', borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, borderRadius: theme.radius.button, paddingHorizontal: theme.spacing.sm },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  chipTextActive: { color: theme.colors.white },
});
