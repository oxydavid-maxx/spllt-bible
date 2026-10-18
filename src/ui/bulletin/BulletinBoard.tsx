import { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { bulletinHeading, type BulletinWeek } from '../../services/bulletinClient';
import { theme } from '../Theme';
import { BulletinViewer } from './BulletinViewer';

/**
 * 公告「主堂」 (維護者 2026-10-17, mock 3): only the 週刊, newest Sunday first, pages in the order they were posted,
 * 8 Sundays kept by the backend. Tapping a page opens it full screen.
 */
export function BulletinBoard({ weeks, status, sourceFor, onRetry }: {
  weeks: BulletinWeek[];
  status: 'loading' | 'ready' | 'error';
  sourceFor: (date: string, index: number) => ImageSourcePropType;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState<{ week: BulletinWeek; index: number } | null>(null);
  if (!weeks.length) {
    return <View style={styles.message}>
      <Text style={styles.empty}>{status === 'loading' ? '載入中…' : status === 'error' ? '暫時讀不到週刊。' : '還沒有週刊。公布欄貼出週刊後，會出現在這裡。'}</Text>
      {status === 'error' ? <Pressable accessibilityRole="button" accessibilityLabel="重新讀取週刊" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>重新讀取</Text></Pressable> : null}
    </View>;
  }
  return <>
    <FlatList
      data={weeks}
      keyExtractor={(week) => week.date}
      contentContainerStyle={styles.list}
      renderItem={({ item: week }) => <View style={styles.week}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.headingText}>{bulletinHeading(week.date)}</Text>
          <Text style={styles.count}>{`${week.pages.length} 張・點圖片放大`}</Text>
        </View>
        {week.pages.map((page, position) => <Pressable
          key={page.index}
          accessibilityRole="imagebutton"
          accessibilityLabel={`${bulletinHeading(week.date)}第 ${page.index} 頁，點了放大`}
          onPress={() => setOpen({ week, index: position })}
          style={styles.page}
        >
          <Image source={sourceFor(week.date, page.index)} resizeMode="contain" style={{ width: '100%', aspectRatio: page.width / page.height }} />
        </Pressable>)}
      </View>}
    />
    {open ? <BulletinViewer week={open.week} startIndex={open.index} sourceFor={(index) => sourceFor(open.week.date, index)} onClose={() => setOpen(null)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl, gap: theme.spacing.lg },
  week: { gap: theme.spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  headingText: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  count: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  page: { borderRadius: 6, overflow: 'hidden', borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  message: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md, gap: theme.spacing.sm, alignItems: 'flex-start' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  retry: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  retryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
});
