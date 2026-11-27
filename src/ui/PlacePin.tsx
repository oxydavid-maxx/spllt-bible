import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import type { Congregation } from '../services/devotionClient';
import { theme } from './Theme';

/**
 * Where each side meets, pinned at the top of 公告 (維護者 2026-11-27, 作答頁 Q13347 照做).
 * Fixed in code, not in the 主日 sheet: the 常設 tab that sheet was meant to carry was never made, and these two
 * addresses change once in years. 青年館's map link is the one the maintainer chose (青崇 SOP: never swap the pin);
 * 竹科靈糧堂's is Google Maps' own listing for the church.
 */
export type Place = { side: Congregation; name: string; fullName: string; address: string; mapUrl: string };

export const PLACES: Record<Congregation, Place> = {
  main: {
    side: 'main', name: '竹科靈糧堂', fullName: '竹科靈糧堂',
    address: '新竹市東區慈雲路65號', mapUrl: 'https://maps.google.com/?cid=2334640645045630095',
  },
  youth: {
    side: 'youth', name: '青年館', fullName: '竹科靈糧堂 青年館',
    address: '新竹市東區龍山西路107號2樓', mapUrl: 'https://maps.app.goo.gl/k9NFs6UmogC2sGqj9',
  },
};

/** What 複製 puts on the clipboard: name, address and map link on three lines, ready to paste into LINE. */
export function placeCopyText(place: Place): string {
  return `${place.fullName}\n${place.address}\n${place.mapUrl}`;
}

export function PlacePin({ place }: { place: Place }) {
  // Closed every time the tab mounts: one line until someone asks for it.
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => { await Clipboard.setStringAsync(placeCopyText(place)); setCopied(true); };
  return <View style={styles.card} accessibilityLabel={`${place.name}地址`}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}地址，${open ? '收起' : '展開'}`}
      accessibilityState={{ expanded: open }}
      onPress={() => { setOpen((now) => !now); setCopied(false); }}
      style={styles.head}
    >
      <Text style={styles.dot}>●</Text>
      <Text style={styles.name}>{place.name}</Text>
      <Text style={styles.chevron}>{open ? '︿' : '﹀'}</Text>
    </Pressable>
    {open ? <View style={styles.body}>
      <Text selectable style={styles.address}>{place.address}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`複製${place.name}地址和地圖連結`} onPress={() => { void copy(); }} style={styles.secondary}>
        <Text style={styles.secondaryText}>{copied ? '已複製，可以貼到 LINE' : '複製地址和地圖連結'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`開${place.name}地圖`} onPress={() => { void Linking.openURL(place.mapUrl); }} style={styles.primary}>
        <Text style={styles.primaryText}>開地圖</Text>
      </Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm, backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  head: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md },
  dot: { color: theme.colors.primary, fontSize: theme.type.caption.size },
  name: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  chevron: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  body: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
  address: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  secondary: { minHeight: theme.control.tap, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', borderColor: theme.colors.primary, borderWidth: theme.control.hairline, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.md },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  primary: { minHeight: theme.control.tap, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md },
  primaryText: { color: theme.colors.white, fontSize: theme.type.label.size, fontWeight: '700' },
});
