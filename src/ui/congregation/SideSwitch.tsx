import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import type { Congregation } from '../../services/devotionClient';

/**
 * The small 「全教會｜青少」 / 「主堂獎品｜青少獎品」 switch (維護者 2026-10-20, mock v3 ② ④). It only changes which side is
 * on screen; where the member counts is the separate 「改」. 主堂 first on both, so the two switches read alike. The
 * side on screen is filled green like the 自己/好友 tabs above it; 36dp tall, 48dp to the finger with the slop.
 */
export function SideSwitch({ labels, selected, onSelect }: { labels: Record<Congregation, string>; selected: Congregation; onSelect: (side: Congregation) => void }) {
  return <View style={styles.track} accessibilityRole="tablist">
    {(['main', 'youth'] as const).map((side) => {
      const on = side === selected;
      return <Pressable
        key={side}
        accessibilityRole="tab"
        accessibilityLabel={labels[side]}
        accessibilityState={{ selected: on }}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={() => { if (!on) onSelect(side); }}
        style={[styles.item, on && styles.itemOn]}
      >
        <Text style={[styles.text, on && styles.textOn]}>{labels[side]}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignSelf: 'flex-start', gap: 3, padding: 3, borderRadius: theme.radius.chip, backgroundColor: theme.colors.surfaceMuted, borderWidth: theme.control.hairline, borderColor: theme.colors.border },
  item: { minHeight: 36, minWidth: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: theme.spacing.md, borderRadius: 8 },
  itemOn: { backgroundColor: theme.colors.primary },
  text: { color: theme.colors.muted, fontSize: theme.type.label.size, fontWeight: '800' },
  textOn: { color: theme.colors.white },
});
