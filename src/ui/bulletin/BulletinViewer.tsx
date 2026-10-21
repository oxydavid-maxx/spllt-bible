import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BulletinWeek } from '../../services/bulletinClient';
import { theme } from '../Theme';
import { useAutoUpdateHold } from '../useAutoUpdateHold';
import { ZoomablePage } from './ZoomablePage';

/**
 * A 週刊 page full screen on black (維護者 2026-10-17, mock 4): two fingers zoom, swipe turns the page, × closes.
 * The hint shows until the first zoom or swipe.
 *
 * Under the status bar (2026-10-20): 0.5.35 drew the black title bar from the top edge, and with the app's dark status
 * bar icons on black the clock and battery disappeared (Pixel). The status bar area keeps the app's light background,
 * as on every other screen, and the black viewer starts under it. Android lays every Modal out edge to edge (React
 * Native 0.85 ReactModalHostView) and the iOS full-screen Modal starts at the top edge too, so this one layout is the
 * same on both platforms.
 */
export function BulletinViewer({ week, startIndex, sourceFor, previewFor, onClose }: {
  week: BulletinWeek;
  startIndex: number;
  /** The original page (full screen is where the detail is). */
  sourceFor: (index: number) => ImageSourcePropType;
  /** The phone copy the list already loaded, shown until the original is in. */
  previewFor?: (index: number) => ImageSourcePropType;
  onClose: () => void;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The space under the status bar, as laid out; the window less the inset until then.
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const view = stage ?? { width: window.width, height: window.height - insets.top };
  const [current, setCurrent] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const [hint, setHint] = useState(true);
  // Full screen over the app, like a panel: a downloaded update waits until it is closed (2026-10-21).
  useAutoUpdateHold(true, '週刊全螢幕');
  const [, month, day] = week.date.split('-').map(Number);
  return <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.screen}>
      <View testID="bulletin-viewer-status-area" style={[styles.statusArea, { height: insets.top }]} />
      <View
        style={styles.stage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setStage((now) => (now && now.width === width && now.height === height ? now : { width, height }));
        }}
      >
        <FlatList
          key={view.width}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          data={week.pages}
          keyExtractor={(page) => String(page.index)}
          initialScrollIndex={current}
          getItemLayout={(_, index) => ({ length: view.width, offset: view.width * index, index })}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => setHint(false)}
          onMomentumScrollEnd={(event) => setCurrent(Math.round(event.nativeEvent.contentOffset.x / view.width))}
          renderItem={({ item }) => <ZoomablePage
            source={sourceFor(item.index)}
            preview={previewFor?.(item.index)}
            page={item}
            view={view}
            label={`${month}/${day} 週刊第 ${item.index} 頁`}
            onZoomChange={(next) => { setZoomed(next); setHint(false); }}
          />}
        />
        <View testID="bulletin-viewer-bar" style={styles.bar}>
          <Text accessibilityRole="header" style={styles.title}>{`${month}/${day} 週刊 ${current + 1} / ${week.pages.length}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="關閉週刊" onPress={onClose} hitSlop={8} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        {hint ? <View pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 20 }]}><Text style={styles.hintText}>兩指放大縮小・左右滑換頁</Text></View> : null}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  statusArea: { backgroundColor: theme.colors.background },
  stage: { flex: 1, backgroundColor: '#111111' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.65)' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  closeText: { color: '#FFFFFF', fontSize: 26, lineHeight: 30 },
  hint: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.7)' },
  hintText: { color: '#FFFFFF', fontSize: 15 },
});
