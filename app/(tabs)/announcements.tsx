import { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createAnnouncementClient, type Announcement } from '../../src/services/announcementClient';
import { AnnouncementBoard } from '../../src/ui/AnnouncementBoard';
import { useAuthSnapshot } from '../../src/services/authSession';
import { runtimeConfig } from '../../src/config/runtime';
import { eventDateFromLabel, fetchEventRegistrations, type EventRegistrationSummary } from '../../src/services/eventRegistrationClient';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { checkAppUpdate, startAppUpdate } from '../../src/services/appUpdate';
import { NO_UPDATE, type UpdateState } from '../../src/services/updateCheck';
import { UpdateCard } from '../../src/ui/UpdateCard';
import { installedVersionCode } from '../../src/ui/UpdatePrompt';
import { theme } from '../../src/ui/Theme';
import { useCongregation } from '../../src/ui/congregation/congregationStore';
import { SIDE_NAME, SIDE_ORDER } from '../../src/ui/congregation/congregationCopy';
import type { Congregation } from '../../src/services/devotionClient';
import { BulletinBoard } from '../../src/ui/bulletin/BulletinBoard';
import { bulletinPageSource, fetchBulletins, type BulletinWeek } from '../../src/services/bulletinClient';

/**
 * The one tab that does not need the backend.
 *
 * Everything else here — the plan, the points, the journal sync — goes through a server running on
 * one person's machine. This reads a few kilobytes of published JSON, so the notice board stays up
 * when that machine is off, which is exactly when somebody is most likely to be checking where to
 * be on Sunday.
 *
 * Links open in a Chrome Custom Tab rather than a WebView: the reader already keeps one of those
 * alive at around 170 MB, and Google's own viewers handle a deck or an audio file better than
 * anything built here would.
 *
 * 「主堂｜青少」 (維護者 2026-10-17; 主堂 on the left since 2026-10-31, the same order as 積分, SIDE_ORDER): the tab
 * opens on the member's own side and either can be chosen. 主堂 shows only the 週刊 kept from the church LINE group;
 * that side does need the backend.
 */

const SIDES = SIDE_ORDER.map((value) => ({ value, name: SIDE_NAME[value] }));
type Side = Congregation;

export default function AnnouncementsScreen() {
  const [client] = useState(() => createAnnouncementClient({
    storage: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
    },
  }));
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    let active = true;
    let remoteSettled = false;
    void client.readCached().then((cached) => {
      if (!active || remoteSettled || !cached) return;
      setAnnouncement(cached); setStale(true); setLoaded(true);
    });
    void client.load().then((result) => {
      remoteSettled = true;
      if (!active) return;
      setAnnouncement(result.announcement);
      setStale(result.stale);
      setLoaded(true);
    });
    return () => { active = false; client.cancel(); };
  }, [client]);

  // Coming back to the tab re-checks. Nothing polls: this changes twice a week.
  useFocusEffect(load);

  // Sign-ups need the backend and a signed-in member; without either the card simply has no status line.
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const nextDate = announcement?.next?.date ? eventDateFromLabel(announcement.next.date) : null;
  const [registration, setRegistration] = useState<EventRegistrationSummary | null>(null);
  const loadRegistration = useCallback(() => {
    if (!session || !nextDate) { setRegistration(null); return; }
    let active = true;
    void fetchEventRegistrations({
      baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl,
      token: session.sessionToken,
      memberId: session.memberId,
    }, nextDate).then((result) => { if (active) setRegistration(result); });
    return () => { active = false; };
  }, [session?.sessionToken, session?.memberId, nextDate]);
  useFocusEffect(loadRegistration);

  // The update stays findable here after the prompt is dismissed; asked again each time the tab shows.
  const [update, setUpdate] = useState<UpdateState>(NO_UPDATE);
  const loadUpdate = useCallback(() => {
    let active = true;
    void checkAppUpdate(installedVersionCode(), Platform.OS).then((next) => { if (active) setUpdate(next); });
    return () => { active = false; };
  }, []);
  useFocusEffect(loadUpdate);

  const congregation = useCongregation();
  const [picked, setPicked] = useState<Side | null>(null);
  const side: Side = picked ?? (congregation.value === 'main' ? 'main' : 'youth');
  const apiBaseUrl = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl;
  const [bulletins, setBulletins] = useState<{ status: 'loading' | 'ready' | 'error'; weeks: BulletinWeek[] }>({ status: 'loading', weeks: [] });
  const [bulletinRetry, setBulletinRetry] = useState(0);
  const loadBulletins = useCallback(() => {
    if (side !== 'main' || !session) return;
    let active = true;
    void fetchBulletins({ baseUrl: apiBaseUrl, token: session.sessionToken, memberId: session.memberId }).then((weeks) => {
      if (active) setBulletins((now) => (weeks ? { status: 'ready', weeks } : { status: 'error', weeks: now.weeks }));
    });
    return () => { active = false; };
  }, [side, apiBaseUrl, session?.sessionToken, session?.memberId, bulletinRetry]);
  useFocusEffect(loadBulletins);

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <View style={styles.toolbar}>
      <Text accessibilityRole="header" style={styles.title}>公告</Text>
      <AccountEntryButton />
    </View>
    <View accessibilityRole="tablist" style={styles.sides}>
      {SIDES.map((item) => <Pressable
        key={item.value}
        accessibilityRole="tab"
        accessibilityLabel={item.name}
        accessibilityState={{ selected: side === item.value }}
        onPress={() => setPicked(item.value)}
        style={[styles.side, side === item.value && styles.sideActive]}
      >
        <Text style={[styles.sideText, side === item.value && styles.sideTextActive]}>{item.name}</Text>
      </Pressable>)}
    </View>
    <UpdateCard state={update} onUpdate={() => { void startAppUpdate(update, (url) => Linking.openURL(url)); }} />
    {side === 'main'
      ? <BulletinBoard
          weeks={bulletins.weeks}
          status={bulletins.status}
          sourceFor={(date, index, width) => bulletinPageSource(apiBaseUrl, session?.sessionToken ?? '', date, index, width)}
          onRetry={() => { setBulletins((now) => ({ ...now, status: 'loading' })); setBulletinRetry((count) => count + 1); }}
        />
      : announcement
      ? <AnnouncementBoard
          announcement={announcement}
          stale={stale}
          onOpen={(url) => { void WebBrowser.openBrowserAsync(url); }}
          registration={registration && registration.date === nextDate ? registration : null}
        />
      : <Text style={styles.empty}>{loaded ? '還沒有本週公告。' : '載入中…'}</Text>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  title: { color: theme.colors.ink, fontSize: theme.type.title.size, fontWeight: '800' },
  sides: { flexDirection: 'row', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  side: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface },
  sideActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  sideText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  sideTextActive: { color: theme.colors.white },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
});
