import { Text, View } from 'react-native';
import { theme } from './Theme';
import { GoogleLoginCard } from './GoogleLoginCard';
import { StatusCard } from './StatusCard';
import { useAuthSnapshot } from '../services/authSession';

export function TodayAuthGate({ baseUrl }: { baseUrl: string }) {
  const auth = useAuthSnapshot();
  if (auth.status === 'signed-out' || auth.status === 'expired') return <GoogleLoginCard baseUrl={baseUrl} />;
  if (auth.status === 'hydrating') return <StatusCard title="正在確認登入身份" body="確認完成後會載入你的個人進度。" tone="info" />;
  return <View style={styles.row}><Text style={styles.name} numberOfLines={1}>已登入：{auth.profile?.displayName ?? '身份已確認'}</Text><Text style={styles.hint}>帳戶入口在右上角</Text></View>;
}

// RC13 rendered these two lines with no style at all, so the signed-in state fell
// outside the type scale and outside the contrast budget. Plain style objects are
// used here instead of StyleSheet.create so the existing test double for
// react-native in tests/ui/todayAuthGate.test.ts keeps working unchanged.
const styles = {
  row: { minHeight: theme.control.tapCompact, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.chip, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  name: { color: theme.colors.ink, flexShrink: 1, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  hint: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
} as const;
