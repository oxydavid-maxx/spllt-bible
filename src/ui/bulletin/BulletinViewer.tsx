import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BulletinWeek } from '../../services/bulletinClient';
import { ZoomablePage } from './ZoomablePage';

/**
 * A 週刊 page full screen on black (維護者 2026-10-17, mock 4): two fingers zoom, swipe turns the page, × closes.
 * The hint shows until the first zoom or swipe.
 */
export function BulletinViewer({ week, startIndex, sourceFor, onClose }: {
  week: BulletinWeek;
  startIndex: number;
  sourceFor: (index: number) => ImageSourcePropType;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const [hint, setHint] = useState(true);
  const [, month, day] = week.date.split('-').map(Number);
  return <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.screen}>
      <FlatList
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        data={week.pages}
        keyExtractor={(page) => String(page.index)}
        initialScrollIndex={startIndex}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => setHint(false)}
        onMomentumScrollEnd={(event) => setCurrent(Math.round(event.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <ZoomablePage
          source={sourceFor(item.index)}
          page={item}
          view={{ width, height }}
          label={`${month}/${day} 週刊第 ${item.index} 頁`}
          onZoomChange={(next) => { setZoomed(next); setHint(false); }}
        />}
      />
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <Text accessibilityRole="header" style={styles.title}>{`${month}/${day} 週刊 ${current + 1} / ${week.pages.length}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉週刊" onPress={onClose} hitSlop={8} style={styles.close}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      {hint ? <View pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 20 }]}><Text style={styles.hintText}>兩指放大縮小・左右滑換頁</Text></View> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111111' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.65)' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  closeText: { color: '#FFFFFF', fontSize: 26, lineHeight: 30 },
  hint: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.7)' },
  hintText: { color: '#FFFFFF', fontSize: 15 },
});
