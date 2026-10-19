import { useEffect, useState } from 'react';
import { consumeInterruptedGoogleLogin } from '../services/googleNative';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BRAND_ICON } from './brandIcon';
import { GoogleLoginCard } from './GoogleLoginCard';
import { AppleLoginCard } from './AppleLoginCard';
import { theme } from './Theme';

const FEATURES = [
  ['✓', '跟著教會的進度讀經，讀完按完成'],
  ['♪', '經文和靈修都可以聽朗讀'],
  ['♡', '累積積分換獎品，和朋友互相加油'],
] as const;

/**
 * The first screen when nobody is signed in. Everything the app keeps (completion, the journal,
 * points, friends) belongs to an account, so sign-in comes before the tabs instead of hiding in the
 * reader's ⋯ menu. The same Google sign-in as everywhere else; the first sign-in creates the member.
 */
export function SignInScreen({ baseUrl }: { baseUrl: string }) {
  const [interrupted, setInterrupted] = useState(false);
  useEffect(() => {
    let active = true;
    void consumeInterruptedGoogleLogin(false).then(show => { if (active) setInterrupted(show); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Image source={BRAND_ICON} style={styles.icon} accessibilityIgnoresInvertColors />
      <Text accessibilityRole="header" style={styles.title}>竹科聖經</Text>
      <Text style={styles.tagline}>竹科靈糧堂的每日讀經</Text>
      <View style={styles.features}>
        {FEATURES.map(([mark, line]) => <View key={line} style={styles.feature}>
          <Text style={styles.mark}>{mark}</Text>
          <Text style={styles.featureText}>{line}</Text>
        </View>)}
      </View>
      {interrupted && <Text style={styles.interrupted}>剛才的登入沒有完成，請再按一次。</Text>}
      <GoogleLoginCard baseUrl={baseUrl} variant="welcome" onSignInStart={() => setInterrupted(false)} />
      <AppleLoginCard baseUrl={baseUrl} />
      <Text style={styles.fine}>第一次登入會自動建立帳號</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', paddingHorizontal: theme.spacing.xxl, paddingVertical: theme.spacing.xxl },
  icon: { width: 88, height: 88, borderRadius: 22, alignSelf: 'center' },
  title: { marginTop: theme.spacing.lg, textAlign: 'center', color: theme.colors.ink, fontSize: 26, lineHeight: 34, fontWeight: '800' },
  tagline: { marginTop: theme.spacing.xs, textAlign: 'center', color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  features: { marginTop: theme.spacing.xxl, marginBottom: theme.spacing.xl, gap: theme.spacing.sm },
  feature: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.chip, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  mark: { width: 20, textAlign: 'center', color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  featureText: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  interrupted: { marginBottom: theme.spacing.sm, textAlign: 'center', color: theme.colors.accent, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  fine: { marginTop: theme.spacing.md, textAlign: 'center', color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
