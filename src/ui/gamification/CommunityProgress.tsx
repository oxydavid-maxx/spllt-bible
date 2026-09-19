import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';

/**
 * Two lines at the foot of the points page: what the group has walked through, and how many days
 * it adds up to once there are enough people for that number to mean anything.
 *
 * There is no target and no bar, on purpose. A shared goal would make a quiet week feel like a
 * collective failure, and a young person who missed a few days would be reading their own absence
 * in it. This only ever goes up.
 */

export interface CommunityProgressProps {
  books: string[];
  personDays: number | null;
}

export function CommunityProgress({ books, personDays }: CommunityProgressProps) {
  if (books.length === 0) return null;
  return <View style={styles.card} accessibilityLabel="青牧處一起讀過的">
    <Text style={styles.books}>{`一起走過：${books.join('、')}`}</Text>
    {personDays === null ? null : <Text style={styles.count}>{`到目前一起讀了 ${personDays} 天次`}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.xxs },
  books: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  count: { color: theme.colors.muted, fontSize: theme.type.caption.size },
});
