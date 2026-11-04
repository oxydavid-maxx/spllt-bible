import { Pressable, Text, View } from 'react-native';
import { AppModal } from './AppModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { theme } from './Theme';
import { AppThemeScope, makeStyles, useColors } from './useAppTheme';
import { useAutoUpdateHold } from './useAutoUpdateHold';

/**
 * 新功能 card (光佑 2026-11-04, mock C ①): once per phone after the update, over the reader. Same frame and buttons as
 * the 有新版本 prompt (UpdatePrompt). 知道了 puts it away; 改設定 puts it away and opens the four choices. Either way
 * it never comes back (src/services/nightMode.ts createNightModeNews).
 */
export const NIGHT_NEWS_TITLE = '新功能：晚上自動變深色';

export function NightModeNews({ visible, onDone, onChange, onClosed }: { visible: boolean; onDone: () => void; onChange: () => void; onClosed?: () => void }) {
  const styles = useStyles();
  // Not work in progress, but a reload under it would only show it again; holding keeps it from blinking away.
  useAutoUpdateHold(visible, '新功能卡開著');
  return <AppModal transparent animationType="fade" visible={visible} onRequestClose={onDone} onDismiss={onClosed}>
    <View style={styles.scrim}>
      <View style={styles.card} accessibilityViewIsModal accessibilityLabel={NIGHT_NEWS_TITLE}>
        <View style={styles.minis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.mini}>
            <AppThemeScope scheme="light"><MiniScreen kind="day" /></AppThemeScope>
            <Text style={styles.miniLabel}>06:00–18:00 白底</Text>
          </View>
          <View style={styles.mini}>
            <AppThemeScope scheme="dark"><MiniScreen kind="night" /></AppThemeScope>
            <Text style={styles.miniLabel}>18:00–06:00 深色</Text>
          </View>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{NIGHT_NEWS_TITLE}</Text>
        <Text style={styles.body}>{'晚上 6 點到早上 6 點，\nApp 會自動變深色，讀經不刺眼。'}</Text>
        <Text style={styles.hint}>想一直白底或跟手機，點讀經頁右上的 ⋯ →「夜間模式」，或到「我的帳戶」改。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="知道了" onPress={onDone} style={styles.done}>
          <Text style={styles.doneText}>知道了</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="改設定" onPress={onChange} style={styles.change}>
          <Text style={styles.changeText}>改設定</Text>
        </Pressable>
      </View>
    </View>
  </AppModal>;
}

/** A small phone screen in one scheme: the page, four lines of text, the sun or the moon. */
function MiniScreen({ kind }: { kind: 'day' | 'night' }) {
  const styles = useStyles();
  const colors = useColors();
  return <View style={styles.screen}>
    <View style={styles.mark}>
      {kind === 'day'
        ? <MaterialCommunityIcons name="white-balance-sunny" size={16} color={colors.sunMark} />
        : <MaterialCommunityIcons name="weather-night" size={16} color={colors.moonMark} />}
    </View>
    {[55, 85, 70, 80].map((width) => <View key={width} style={[styles.line, { width: `${width}%` }]} />)}
  </View>;
}

const useStyles = makeStyles((colors) => ({
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: theme.spacing.xl },
  card: { borderRadius: theme.radius.card, backgroundColor: colors.surface, padding: theme.spacing.xl, gap: theme.spacing.md },
  minis: { flexDirection: 'row', gap: theme.spacing.md },
  mini: { flex: 1, alignItems: 'center', gap: 6 },
  screen: { alignSelf: 'stretch', height: 72, borderRadius: 10, borderWidth: theme.control.hairline, borderColor: colors.sketchFrame, backgroundColor: colors.readerSurface, paddingTop: 10, paddingHorizontal: 10, gap: 6 },
  mark: { position: 'absolute', right: 8, top: 8 },
  line: { height: 5, borderRadius: 3, backgroundColor: colors.sketchLine },
  miniLabel: { color: colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  title: { color: colors.ink, fontSize: 18, lineHeight: 25, fontWeight: '800', marginTop: 2 },
  body: { color: colors.ink, fontSize: theme.type.label.size, lineHeight: 22 },
  hint: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: 19 },
  done: { minHeight: theme.control.tap + 8, justifyContent: 'center', alignItems: 'center', borderRadius: theme.radius.button, backgroundColor: colors.primaryFill },
  doneText: { color: colors.onFill, fontSize: theme.type.label.size + 2, fontWeight: '800' },
  change: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  changeText: { color: colors.muted, fontSize: theme.type.label.size, fontWeight: '700' },
}));
