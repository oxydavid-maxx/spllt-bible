import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { taipeiDate } from '../../src/domain/gamificationV1';
import { preserveReadingDateOnReturn, setSelectedReadingDate } from '../../src/ui/readingSession';

/** The visible 讀經 tab is the entry point; focus means the member explicitly returned to that tab. */
export default function TodayScreen() {
  useFocusEffect(useCallback(() => {
    if (!preserveReadingDateOnReturn()) setSelectedReadingDate(taipeiDate());
    router.replace('/reader');
  }, []));
  return null;
}
