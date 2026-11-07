import { Pressable, Text, View } from 'react-native';
import { NIGHT_MODE_OPTIONS, NIGHT_MODE_SUBTITLE, NIGHT_MODE_TITLE, nightModeLabel, nightModeNote, type NightModeChoice } from '../services/nightMode';
import { theme } from './Theme';
import { makeStyles } from './useAppTheme';
import { useNightMode } from './nightModeContext';

/**
 * 夜間模式's four choices (光佑 2026-11-04, mock C): the same row of four and the same line under it on the reader's
 * ⋯ 更多閱讀工具 → 夜間模式 page and on the 我的帳戶 card. A tap changes the screen at once; nothing else to confirm.
 */
export function NightModeOptions({ choice, onChoose }: { choice: NightModeChoice; onChoose: (choice: NightModeChoice) => void }) {
  const styles = useStyles();
  return <View style={styles.block}>
    <View accessibilityRole="radiogroup" accessibilityLabel={NIGHT_MODE_TITLE} style={styles.options}>
      {NIGHT_MODE_OPTIONS.map((option, index) => {
        const selected = option.choice === choice;
        return <Pressable
          key={option.choice}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: selected }}
          onPress={() => { if (!selected) onChoose(option.choice); }}
          style={[styles.option, index > 0 && styles.optionDivided, selected && styles.optionSelected]}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.note}>{nightModeNote(choice)}</Text>
  </View>;
}

/** The row under 調整字體 in ⋯ 更多閱讀工具: the choice in force and a ›, like a settings list. */
export function NightModeMenuRow({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const { choice } = useNightMode();
  const label = nightModeLabel(choice);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${NIGHT_MODE_TITLE}，${label}`} accessibilityHint="打開夜間模式的四個選項" onPress={onPress} style={styles.menuRow}>
    <Text style={styles.menuLabel}>{NIGHT_MODE_TITLE}</Text>
    <Text style={styles.menuValue}>{`${label} ›`}</Text>
  </Pressable>;
}

/** ⋯ 更多閱讀工具's next page, with 返回 like 選擇譯本. */
export function NightModePage({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const { choice, setChoice } = useNightMode();
  return <View style={styles.page}>
    <View style={styles.pageHeader}>
      <Text accessibilityRole="header" style={styles.pageTitle}>{NIGHT_MODE_TITLE}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="返回更多閱讀工具" onPress={onBack} style={styles.back}><Text style={styles.backText}>返回</Text></Pressable>
    </View>
    <Text style={styles.subtitle}>{NIGHT_MODE_SUBTITLE}</Text>
    <NightModeOptions choice={choice} onChoose={setChoice} />
  </View>;
}

/** 我的帳戶, under 我在青少聚會: the same four choices. */
export function NightModeCard() {
  const styles = useStyles();
  const { choice, setChoice } = useNightMode();
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{NIGHT_MODE_TITLE}</Text>
      <Text style={styles.subtitle}>{NIGHT_MODE_SUBTITLE}</Text>
    </View>
    <NightModeOptions choice={choice} onChoose={setChoice} />
  </View>;
}

const useStyles = makeStyles((colors) => ({
  block: { gap: theme.spacing.sm + 2 },
  options: { flexDirection: 'row', borderWidth: theme.control.hairline, borderColor: colors.borderStrong, borderRadius: theme.radius.chip, overflow: 'hidden' },
  option: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xxs },
  optionDivided: { borderLeftWidth: theme.control.hairline, borderLeftColor: colors.borderStrong },
  optionSelected: { backgroundColor: colors.primaryFill },
  optionText: { color: colors.ink, fontSize: theme.type.label.size, fontWeight: '500' },
  optionTextSelected: { color: colors.onFill, fontWeight: '800' },
  note: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  subtitle: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  menuRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderBottomWidth: theme.control.hairline, borderBottomColor: colors.border },
  menuLabel: { color: colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  menuValue: { color: colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  page: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm + 2 },
  pageHeader: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  pageTitle: { color: colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800', flexShrink: 1 },
  back: { minHeight: theme.control.tap, minWidth: theme.control.tap, alignItems: 'flex-end', justifyContent: 'center' },
  backText: { color: colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  card: { gap: theme.spacing.sm + 2, padding: theme.spacing.md, borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: colors.border, backgroundColor: colors.surface },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  cardTitle: { color: colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
}));
