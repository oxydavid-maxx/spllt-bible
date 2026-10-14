import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DomWebView, type DomWebViewRef } from '@expo/dom-webview';
import Svg, { Path } from 'react-native-svg';
import type { DevotionalPost } from '../../services/devotionClient';
import { READ_ALONG_HIGHLIGHT } from '../readAlongBridge';
import { theme } from '../Theme';

/**
 * The 靈修 tab (維護者 2026-10-14): the pastor's post for the day, the paragraph being read aloud lit,
 * and the day's song at the end. The song's player is loaded only when it is played, so an idle tab
 * makes no request; it plays only while the screen is on (YouTube does not allow background play)
 * and pauses the moment the app leaves the screen.
 *
 * The words follow the reader's 調整字體 size and spacing, and the paragraph being read is lit in
 * the same grey as scripture, so the two tabs read as one page (維護者 2026-10-14).
 */

/** The SDK's own defaults (BIBLE_READER_FONT.DEFAULT, READER_LINE_SPACING.DEFAULT): unchanged readers see the old page. */
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_SPACING = 1.7;

export type DevotionalState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; post: DevotionalPost };

export interface DevotionalViewProps {
  state: DevotionalState;
  onEndChange?: (atEnd: boolean) => void;
  /** The paragraph being read, counted across sections in reading order; -1 when none. */
  activeIndex: number;
  /** `${api}/api/devotional/player`: a page on our own server, so YouTube sees a real embedding site. */
  playerUrl: string;
  /** Raised when the reading has finished and the song should follow. */
  songRequest: number;
  songFollows: boolean;
  insets: { top: number; bottom: number };
  /** The reader's 調整字體 settings; the SDK defaults when the member never changed them. */
  fontSize?: number;
  lineSpacing?: number;
  /** The 靈修 is being read aloud now: starting or resuming moves to the paragraph being read. */
  speaking?: boolean;
}

type SongState = 'poster' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export function devotionMeta(post: DevotionalPost): string {
  return `傳道 · ${post.date.replaceAll('-', '.')} (${post.weekday}) 讀經：${post.passages}`;
}

export function songCaption(song: SongState, songFollows: boolean): string {
  if (song === 'playing') return '播放中 · 螢幕關掉就停';
  if (song === 'error') return '詩歌暫時無法播放，點一下再試';
  if (song === 'paused') return '已暫停 · 螢幕亮著才播';
  return songFollows ? '朗讀完自動播放 · 螢幕亮著才播' : '點一下播放 · 螢幕亮著才播';
}

const PLAY = 'window.qmPlay&&window.qmPlay();true;';
const PAUSE = 'window.qmPause&&window.qmPause();true;';

export function DevotionalView({ state, activeIndex, playerUrl, songRequest, songFollows, insets, onEndChange, fontSize = DEFAULT_FONT_SIZE, lineSpacing = DEFAULT_LINE_SPACING, speaking = false }: DevotionalViewProps) {
  const viewport = useRef({ height: 0, content: 0, y: 0 });
  const reportEnd = () => {
    const v = viewport.current;
    onEndChange?.(state.kind === 'ready' && v.height > 0 && v.content > 0 && v.y + v.height >= v.content - 2);
  };
  const scroller = useRef<ScrollView | null>(null);
  const sectionTops = useRef(new Map<number, number>());
  const paragraphTops = useRef(new Map<number, { section: number; y: number }>());
  const player = useRef<DomWebViewRef | null>(null);
  const [song, setSong] = useState<SongState>('poster');
  const post = state.kind === 'ready' ? state.post : null;
  const songKey = post ? `${post.date}:${post.song.youtubeId}` : '';

  useEffect(() => { onEndChange?.(false); viewport.current = { height: 0, content: 0, y: 0 }; setSong('poster'); sectionTops.current.clear(); paragraphTops.current.clear(); }, [songKey]);
  // Follows the reading only while it is heard: a paused page stays where the member scrolled it.
  useEffect(() => {
    if (!speaking || activeIndex < 0) return;
    // The first paragraph carries the title and heading in its speech, so the page starts at the top.
    if (activeIndex === 0) { scroller.current?.scrollTo({ y: 0, animated: true }); return; }
    const place = paragraphTops.current.get(activeIndex);
    if (!place) return;
    scroller.current?.scrollTo({ y: Math.max(0, (sectionTops.current.get(place.section) ?? 0) + place.y - 24), animated: true });
  }, [activeIndex, speaking]);
  const handledRequest = useRef(songRequest);
  useEffect(() => {
    if (songRequest === handledRequest.current) return;
    handledRequest.current = songRequest;
    // With the screen off the song waits for a tap.
    if (!post || AppState.currentState !== 'active') return;
    if (song === 'paused') player.current?.injectJavaScript(PLAY);
    else if (song !== 'playing' && song !== 'loading') setSong('loading');
  }, [songRequest, post, song]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      player.current?.injectJavaScript(PAUSE);
      setSong((current) => current === 'playing' || current === 'loading' ? 'paused' : current);
    });
    return () => subscription.remove();
  }, []);

  if (state.kind !== 'ready') {
    return <View style={[styles.center, { paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom }]}>
      {state.kind === 'loading' ? <><ActivityIndicator color={theme.colors.primary} /><Text style={styles.note}>正在載入今天的靈修…</Text></>
        : state.kind === 'missing' ? <Text style={styles.note}>這一天的靈修還沒有上傳</Text>
          : <><Text accessibilityRole="alert" style={styles.note}>靈修暫時無法載入</Text><Pressable accessibilityRole="button" accessibilityLabel="重試載入靈修" onPress={state.onRetry} style={styles.retry}><Text style={styles.retryText}>重試</Text></Pressable></>}
    </View>;
  }

  const devotional = state.post;
  const songTitle = devotional.song.title ?? '今天的詩歌';
  const caption = songCaption(song, songFollows);
  let unit = -1;
  const playerMounted = song !== 'poster' && song !== 'error';
  const scale = fontSize / DEFAULT_FONT_SIZE;
  const text = {
    title: { fontSize: Math.round(19 * scale), lineHeight: Math.round(26 * scale) },
    heading: { fontSize: Math.round(theme.type.body.size * scale), lineHeight: Math.round(theme.type.body.line * scale) },
    paragraph: { fontSize, lineHeight: Math.round(fontSize * lineSpacing) },
  };
  return <ScrollView ref={scroller} accessibilityLabel="靈修" scrollEventThrottle={100}
    onLayout={(event) => { viewport.current.height = event.nativeEvent.layout.height; reportEnd(); }}
    onContentSizeChange={(_width, height) => { viewport.current.content = height; reportEnd(); }}
    onScroll={(event) => { const e = event.nativeEvent; viewport.current = { y: e.contentOffset.y, height: e.layoutMeasurement.height, content: e.contentSize.height }; reportEnd(); }}
    style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom }]}>
    <View style={styles.titleBlock}>
      <Text accessibilityRole="header" style={[styles.title, text.title]}>{`《${devotional.title}》`}</Text>
      <Text style={styles.meta}>{devotionMeta(devotional)}</Text>
    </View>
    {devotional.sections.map((section, sectionIndex) => <View key={`${sectionIndex}:${section.heading}`} onLayout={(event) => { sectionTops.current.set(sectionIndex, event.nativeEvent.layout.y); }} style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, text.heading]}>{section.heading}</Text>
      {section.paragraphs.map((paragraph, paragraphIndex) => {
        unit += 1;
        const index = unit;
        return <Text key={paragraphIndex} onLayout={(event) => { paragraphTops.current.set(index, { section: sectionIndex, y: event.nativeEvent.layout.y }); }} style={[styles.paragraph, index === activeIndex && styles.paragraphLit, text.paragraph]}>{paragraph}</Text>;
      })}
    </View>)}
    {playerMounted ? <View style={styles.songCard}>
      <View style={styles.songMedia}>
        <DomWebView
          ref={player}
          source={{ uri: `${playerUrl}?v=${encodeURIComponent(devotional.song.youtubeId)}` }}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          scrollEnabled={false}
          style={styles.fill}
          containerStyle={styles.fill}
          onMessage={(event) => {
            const message = event.nativeEvent.data;
            if (message === 'ready') { if (AppState.currentState === 'active') player.current?.injectJavaScript(PLAY); else setSong('paused'); }
            else if (message === 'playing') { if (AppState.currentState === 'active') setSong('playing'); else { player.current?.injectJavaScript(PAUSE); setSong('paused'); } }
            else if (message === 'paused') setSong('paused');
            else if (message === 'ended') setSong('ended');
            else if (message.startsWith('error')) setSong('error');
          }}
        />
        {song === 'loading' ? <View pointerEvents="none" style={styles.songPlay}><ActivityIndicator color={theme.colors.white} /></View> : null}
      </View>
      <View style={styles.songCaption}>
        <Text numberOfLines={1} style={styles.songTitle}>{songTitle}</Text>
        <Text style={styles.songNote}>{caption}</Text>
      </View>
    </View> : <Pressable accessibilityRole="button" accessibilityLabel={`播放詩歌 ${songTitle}`} onPress={() => setSong('loading')} style={styles.poster}>
      <View pointerEvents="none" style={styles.songPlay}><Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M8 5v14l11-7z" fill={theme.colors.white} /></Svg></View>
      <View pointerEvents="none" style={styles.posterCaption}>
        <Text numberOfLines={1} style={styles.songTitle}>{songTitle}</Text>
        <Text style={styles.songNote}>{caption}</Text>
      </View>
    </Pressable>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.colors.surface },
  content: { paddingHorizontal: theme.spacing.lg, gap: 14 },
  center: { flex: 1, alignItems: 'center', gap: theme.spacing.md, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.lg },
  note: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, textAlign: 'center' },
  retry: { minHeight: theme.control.tap, paddingHorizontal: theme.spacing.xl, borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  titleBlock: { gap: 2 },
  title: { color: theme.colors.ink, fontSize: 19, lineHeight: 26, fontWeight: '800' },
  meta: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  section: { gap: 6 },
  heading: { color: theme.colors.primary, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '800' },
  paragraph: { color: theme.colors.ink, fontSize: 16, lineHeight: 27 },
  paragraphLit: { backgroundColor: `#${READ_ALONG_HIGHLIGHT}`, borderRadius: 8, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 6, marginHorizontal: -8 },
  poster: { borderRadius: theme.radius.button, overflow: 'hidden', backgroundColor: theme.colors.ink, aspectRatio: 16 / 9, justifyContent: 'flex-end' },
  posterCaption: { paddingHorizontal: theme.spacing.md, paddingVertical: 10, gap: 2 },
  songCard: { borderRadius: theme.radius.button, overflow: 'hidden', backgroundColor: theme.colors.ink },
  songMedia: { aspectRatio: 16 / 9 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  songPlay: { position: 'absolute', left: '50%', top: '42%', width: 54, height: 54, marginLeft: -27, marginTop: -27, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  songCaption: { paddingHorizontal: theme.spacing.md, paddingVertical: 10, gap: 2 },
  songTitle: { color: theme.colors.white, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
  songNote: { color: theme.colors.primarySoft, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
});
