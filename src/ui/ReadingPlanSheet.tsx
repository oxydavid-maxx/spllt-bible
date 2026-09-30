import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createApiClient, type ReadingDaySnapshot } from '../services/apiClient';
import { getAuthSnapshot, useAuthSnapshot } from '../services/authSession';
import { runtimeConfig } from '../config/runtime';
import type { CompletionRecord } from '../domain/completion';
import { taipeiDate } from '../domain/gamificationV1';
import { formatReferenceListZhTw } from '../domain/scriptureReference';
import { getReadingPlan } from './readingSession';
import { formatReadingDateLabel, formatReadingDateWithWeekday } from './ReadingDateNavigator';
import { SheetBackdrop } from './SheetBackdrop';
import { theme } from './Theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
}

/** Both entry points mount this same sheet only while open: no idle reads or polling. */
export function ReadingPlanSheet({ visible, ...props }: Props) {
  return visible ? <OpenReadingPlanSheet {...props} /> : null;
}

function OpenReadingPlanSheet({ onClose, onSelectDate }: Omit<Props, 'visible'>) {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const ownerKey = JSON.stringify([session?.memberId, session?.sessionToken, auth.epoch]);
  const [plan] = useState(getReadingPlan);
  const [completion, setCompletion] = useState<{ owner: string; remote: Map<string, ReadingDaySnapshot>; local: Map<string, CompletionRecord>; loading: boolean; offline: boolean }>(
    () => ({ owner: ownerKey, remote: new Map(), local: new Map(), loading: Boolean(session), offline: false }),
  );
  const today = taipeiDate();
  // On a rest day, land at the next reading; outside the plan, land at its nearest end.
  const targetDate = plan.dates.find(date => date >= today) ?? plan.dates[plan.dates.length - 1];
  const scroll = useRef<ScrollView>(null);
  const targetY = useRef<number | null>(null);
  const contentHeight = useRef(0);
  const modalShown = useRef(false);
  const viewportHeight = useRef(0);
  const positioned = useRef(false);
  const scrollToToday = () => {
    if (positioned.current || !modalShown.current || viewportHeight.current <= 0 || targetY.current === null || contentHeight.current <= targetY.current || !scroll.current) return;
    // Keep a few previous days above today, as in the approved mock, using the measured viewport.
    scroll.current.scrollTo({ y: Math.max(0, targetY.current - viewportHeight.current * 0.4), animated: false });
    positioned.current = true;
  };

  useEffect(() => {
    let active = true;
    const owns = () => {
      const current = getAuthSnapshot();
      return active && current.epoch === auth.epoch && current.session?.memberId === session?.memberId && current.session?.sessionToken === session?.sessionToken;
    };
    if (!session) return () => { active = false; };
    const client = createApiClient({
      baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl,
      token: session.sessionToken, memberId: session.memberId,
    });
    const local = new Map<string, CompletionRecord>();
    // Lazy native storage import keeps the closed sheet inert, including on the other tab.
    const loadLocal = import('../storage/mobileDatabase').then(({ openQingmuRepository }) => {
      if (!owns()) return;
      const repository = openQingmuRepository();
      for (const day of plan.days) {
        const record = repository.get({ memberId: session.memberId, planId: day.planId ?? plan.planId, taskDate: day.date });
        if (record) local.set(day.date, record);
      }
      if (owns()) setCompletion({ owner: ownerKey, remote: new Map(), local, loading: true, offline: false });
    }).catch(() => undefined);
    // The existing API caps a range at 62 days, so load each month once on opening.
    const months = [...new Set(plan.dates.map(date => date.slice(0, 7)))];
    const loadRemote = Promise.all(months.map(async month => {
      const end = new Date(`${month}-01T12:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      try { return await client.getReadingDays(`${month}-01`, end.toISOString().slice(0, 10)); }
      catch { return null; }
    }));
    void Promise.all([loadLocal, loadRemote]).then(([, results]) => {
      if (!owns()) return;
      const remote = new Map(results.flatMap(result => result?.days.map(day => [day.taskDate, day] as const) ?? []));
      setCompletion({ owner: ownerKey, remote, local, loading: false, offline: results.some(result => result === null) });
    });
    return () => { active = false; };
  }, [plan, ownerKey]);

  const visible = completion.owner === ownerKey ? completion : { remote: new Map<string, ReadingDaySnapshot>(), local: new Map<string, CompletionRecord>(), loading: Boolean(session), offline: false };
  const days = plan.days.map(day => {
    const remote = visible.remote.get(day.date);
    const local = visible.local.get(day.date);
    const useLocal = local && (!remote || local.syncStatus !== 'CONFIRMED' || local.revision > remote.revision);
    return { ...day, references: remote?.references ?? day.references, completed: (useLocal ? local.status : remote?.status ?? local?.status) === 'COMPLETED' };
  });
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const summary = first && last ? `${formatReadingDateLabel(first)}–${formatReadingDateLabel(last)}，共 ${days.length} 天，已讀 ${days.filter(day => day.completed).length} 天` : '目前沒有讀經計畫';

  return <Modal visible transparent animationType="slide" onShow={() => { modalShown.current = true; scrollToToday(); }} onRequestClose={onClose}>
    <SafeAreaProvider><SheetBackdrop label="關閉整份讀經計畫" onPress={onClose} style={styles.scrim}>
      <View style={styles.sheetWrap}>
        <SafeAreaView style={styles.sheet} edges={['bottom', 'left', 'right']} accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>整份讀經計畫</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="關閉計畫" onPress={onClose} style={styles.close}><Text style={styles.closeText}>關閉</Text></Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{summary}</Text>
          {visible.loading ? <Text style={styles.notice}>正在更新完成記錄…</Text> : visible.offline ? <Text style={styles.notice}>尚未連上更新，先顯示這支手機的完成記錄。</Text> : null}
          <ScrollView ref={scroll} style={styles.list} onLayout={event => { viewportHeight.current = event.nativeEvent.layout.height; scrollToToday(); }} onContentSizeChange={(_width, height) => { contentHeight.current = height; scrollToToday(); }}>
            {days.flatMap((day, index) => {
              const isToday = day.date === today;
              const passages = formatReferenceListZhTw(day.references);
              const month = day.date.slice(0, 7);
              return [
                ...(index === 0 || days[index - 1].date.slice(0, 7) !== month ? [<Text key={month} accessibilityRole="header" style={styles.month}>{`${Number(month.slice(5))} 月`}</Text>] : []),
                <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`讀 ${day.date} ${passages}${isToday ? ' 今天' : ''}${day.completed ? ' 已完成' : ''}`}
                  onLayout={day.date === targetDate ? event => { targetY.current = event.nativeEvent.layout.y; scrollToToday(); } : undefined}
                  onPress={() => { onClose(); onSelectDate(day.date); }} style={[styles.row, isToday && styles.today]}>
                  <Text style={[styles.date, isToday && styles.todayText]}>{formatReadingDateWithWeekday(day.date)}</Text>
                  <Text style={[styles.passages, isToday && styles.todayText]}>{passages}</Text>
                  <View style={styles.status}>
                    {isToday ? <Text style={styles.todayTag}>今天</Text> : null}
                    {day.completed ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                </Pressable>,
              ];
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </SheetBackdrop></SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,48,42,0.28)' },
  sheetWrap: { width: '100%', height: '82%' },
  sheet: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, overflow: 'hidden' },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  header: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  title: { flexShrink: 1, color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' },
  close: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  subtitle: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  notice: { color: theme.colors.muted, fontSize: theme.type.caption.size, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs },
  list: { flex: 1, minHeight: 0, borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border },
  month: { color: theme.colors.muted, backgroundColor: theme.colors.surfaceMuted, fontSize: theme.type.caption.size, fontWeight: '700', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  row: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  date: { width: 98, color: theme.colors.muted, fontSize: theme.type.label.size },
  passages: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  status: { minWidth: 44, alignItems: 'flex-end', gap: theme.spacing.xxs },
  today: { backgroundColor: theme.colors.primarySoft },
  todayText: { color: theme.colors.ink, fontWeight: '800' },
  todayTag: { color: theme.colors.primary, fontSize: theme.type.micro.size, fontWeight: '800', borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.xs },
  tick: { color: theme.colors.white, backgroundColor: theme.colors.primary, borderRadius: 12, overflow: 'hidden', width: 24, height: 24, textAlign: 'center', lineHeight: 24, fontSize: theme.type.caption.size, fontWeight: '800' },
});
