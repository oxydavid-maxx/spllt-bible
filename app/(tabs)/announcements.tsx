import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { theme } from '../../src/ui/Theme';

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
 */

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

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <View style={styles.toolbar}>
      <Text accessibilityRole="header" style={styles.title}>公告</Text>
      <AccountEntryButton />
    </View>
    {announcement
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
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
});
