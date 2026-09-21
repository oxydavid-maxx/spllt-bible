import { StyleSheet, Text, View } from 'react-native';
import type { CommunityBookGoal } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/**
 * The foot of the points page: the one book the group is finishing together, then what it has read
 * so far and how many days that adds up to once there are enough people for the number to mean
 * anything.
 *
 * The goal is built so that it cannot be failed. A chapter lights the moment ANY one person has read
 * it, there is no deadline, and nothing counts down — so a quiet week is not a collective failure,
 * and a young person who missed a fortnight does not read their own absence in it. They see the
 * chapters somebody else carried while they were away, and the number of people who walked each one.
 */

export interface CommunityProgressProps {
  books: string[];
  personDays: number | null;
  currentBook?: CommunityBookGoal | null;
}

export function CommunityProgress({ books, personDays, currentBook }: CommunityProgressProps) {
  if (books.length === 0 && !currentBook) return null;
  const lit = currentBook?.chapters.filter((entry) => entry.readers !== null).length ?? 0;
  return <View style={styles.card} accessibilityLabel="青牧處一起讀過的">
    {currentBook ? <View style={styles.goal}>
      <View style={styles.goalLine}>
        <Text style={styles.goalTitle} numberOfLines={1}>
          {currentBook.complete ? `一起讀完了${currentBook.book}` : `一起讀完 ${currentBook.book}`}
        </Text>
        {currentBook.complete ? null : <Text style={styles.goalCount}>{`${lit} / ${currentBook.chapters.length} 章`}</Text>}
      </View>
      <View style={styles.chapters}>
        {currentBook.chapters.map((entry) => {
          const read = entry.readers !== null;
          // The count sits BELOW the pill rather than inside it. Stacked in one small box, a
          // chapter 1 read by 1 person renders as a 1 above a 1 and is read as eleven.
          return <View
            key={entry.chapter}
            accessibilityLabel={read ? `第 ${entry.chapter} 章，${entry.readers} 人讀過` : `第 ${entry.chapter} 章，還沒有人讀過`}
            style={styles.chapterColumn}
          >
            <View style={[styles.chapter, read && styles.chapterLit]}>
              <Text style={[styles.chapterNumber, read && styles.chapterNumberLit]}>{String(entry.chapter)}</Text>
            </View>
            {/* A chapter nobody has reached carries no number. A 0 there would be a scoreboard. */}
            {read ? <Text style={styles.chapterReaders}>{String(entry.readers)}</Text> : null}
          </View>;
        })}
      </View>
    </View> : null}
    {books.length > 0 ? <Text style={styles.books}>{`一起走過：${books.join('、')}`}</Text> : null}
    {personDays === null ? null : <Text style={styles.count}>{`到目前一起讀了 ${personDays} 天次`}</Text>}
  </View>;
}

const CHAPTER_SIZE = 34;

const styles = StyleSheet.create({
  card: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.xs },
  goal: { gap: theme.spacing.xs },
  goalLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  goalTitle: { color: theme.colors.ink, fontSize: theme.type.label.size, fontWeight: '800', flexShrink: 1 },
  goalCount: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  chapters: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  chapterColumn: { width: CHAPTER_SIZE, alignItems: 'center', gap: 2 },
  chapter: { width: CHAPTER_SIZE, height: CHAPTER_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.chip, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  chapterLit: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chapterNumber: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '800' },
  chapterNumberLit: { color: theme.colors.white },
  chapterReaders: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '700' },
  books: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  count: { color: theme.colors.muted, fontSize: theme.type.caption.size },
});
