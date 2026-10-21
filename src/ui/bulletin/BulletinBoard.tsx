import { useState } from 'react';
import { FlatList, Image, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import { bulletinListWidth } from '../../domain/bulletinWidths';
import { bulletinHeading, type BulletinPage, type BulletinWeek } from '../../services/bulletinClient';
import { theme } from '../Theme';
import { PAGE_FAILED, PAGE_LOADING, PageStatus, usePageLoad } from './BulletinPageStatus';
import { BulletinViewer } from './BulletinViewer';

/**
 * 公告「主堂」 (維護者 2026-10-17, mock 3): only the 週刊, newest Sunday first, pages in the order they were posted,
 * 8 Sundays kept by the backend. Tapping a page opens it full screen.
 *
 * 2026-10-20 (Pixel, 0.5.35, LTE): the list downloads the backend's phone copy of each page (`width`, the smallest of
 * src/domain/bulletinWidths.ts that covers the list), not the 2481 × 3509 original; full screen asks for the original.
 * Until a page is in it shows a grey box its own shape with 週刊載入中…; a page that fails says so, and a tap asks for
 * it again instead of opening it.
 */
export function BulletinBoard({ weeks, status, sourceFor, onRetry }: {
  weeks: BulletinWeek[];
  status: 'loading' | 'ready' | 'error';
  sourceFor: (date: string, index: number, width?: number) => ImageSourcePropType;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState<{ week: BulletinWeek; index: number } | null>(null);
  const window = useWindowDimensions();
  // The pages are as wide as the list less its side padding (styles.list).
  const listWidth = bulletinListWidth(PixelRatio.getPixelSizeForLayoutSize(window.width - theme.spacing.md * 2)) ?? undefined;
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
        {week.pages.map((page, position) => <PageTile
          key={page.index}
          heading={bulletinHeading(week.date)}
          page={page}
          source={sourceFor(week.date, page.index, listWidth)}
          onOpen={() => setOpen({ week, index: position })}
        />)}
      </View>}
    />
    {open ? <BulletinViewer
      week={open.week}
      startIndex={open.index}
      sourceFor={(index) => sourceFor(open.week.date, index)}
      previewFor={listWidth ? (index) => sourceFor(open.week.date, index, listWidth) : undefined}
      onClose={() => setOpen(null)}
    /> : null}
  </>;
}

/** One page in the list. Its label carries its state, for VoiceOver, TalkBack and the iOS flow (44-bulletin). */
function PageTile({ heading, page, source, onOpen }: { heading: string; page: BulletinPage; source: ImageSourcePropType; onOpen: () => void }) {
  const load = usePageLoad();
  const failed = load.state === 'error';
  return <Pressable
    accessibilityRole={failed ? 'button' : 'imagebutton'}
    accessibilityLabel={failed ? `${heading}第 ${page.index} 頁載不到，點一下再試` : `${heading}第 ${page.index} 頁，${load.state === 'ready' ? '點了放大' : '載入中'}`}
    onPress={failed ? load.retry : onOpen}
    style={[styles.page, { aspectRatio: page.width / page.height }]}
  >
    <Image key={load.attempt} source={source} resizeMode="contain" onLoad={load.onLoad} onError={load.onError} style={StyleSheet.absoluteFill} />
    {load.state === 'ready' ? null : <PageStatus text={failed ? PAGE_FAILED : PAGE_LOADING} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl, gap: theme.spacing.lg },
  week: { gap: theme.spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  headingText: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  count: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  page: { width: '100%', borderRadius: 6, overflow: 'hidden', borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  message: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md, gap: theme.spacing.sm, alignItems: 'flex-start' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  retry: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  retryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
});
