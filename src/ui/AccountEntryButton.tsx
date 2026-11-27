import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuthSnapshot } from '../services/authSession';
import { theme } from './Theme';
import { makeStyles } from './useAppTheme';

export function AccountEntryButton() {
  const styles = useStyles();
  const auth = useAuthSnapshot();
  const profile = auth.status === 'signed-in' && auth.session && auth.profile?.memberId === auth.session.memberId ? auth.profile : null;
  // Review 121 C9. 小明 signed in and still saw 人. The cause was NOT this label - it was that the
  // profile request hung forever, so no name ever arrived (fixed in authSession + accountSurface).
  // Deriving a letter from memberId was considered and REJECTED: a memberId is an opaque id such as
  // google:1234567, so it would have shown '1' - inventing an identity, which C9 forbids. The neutral
  // placeholder stays, and the account surface now reports a real error instead of spinning.
  const label = profile?.displayName.trim().slice(0, 1) || '人';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="開啟帳戶" onPress={() => router.push('/account')} style={styles.button}>
      {profile?.avatarUrl?.trim() ? <Image accessibilityLabel={`帳戶頭像：${profile.displayName}`} source={{ uri: profile.avatarUrl }} style={styles.image} /> : <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  button: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center' },
  label: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryFill, color: colors.onFill, fontSize: theme.type.heading.size, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  image: { width: 34, height: 34, borderRadius: 17, borderColor: colors.borderStrong, borderWidth: theme.control.hairline },
}));
