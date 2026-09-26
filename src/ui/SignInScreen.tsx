import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BRAND_ICON } from './brandIcon';
import { GoogleLoginCard } from './GoogleLoginCard';
import { theme } from './Theme';

const FEATURES = [
  ['✓', '每天讀完按「完成」，記下自己的進度'],
  ['✎', '寫靈修日記，只有自己看得到'],
  ['♡', '和朋友互相鼓勵、看誰報名活動'],
] as const;

/**
 * The first screen when nobody is signed in. Everything the app keeps (completion, the journal,
 * points, friends) belongs to an account, so sign-in comes before the tabs instead of hiding in the
 * reader's ⋯ menu. The same Google sign-in as everywhere else; the first sign-in creates the member.
 */
export function SignInScreen({ baseUrl }: { baseUrl: string }) {
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
      <GoogleLoginCard baseUrl={baseUrl} variant="welcome" />
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
  fine: { marginTop: theme.spacing.md, textAlign: 'center', color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
