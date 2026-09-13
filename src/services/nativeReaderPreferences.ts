import * as SecureStore from 'expo-secure-store';
import { getYouVersionVersionOptions } from '../config/youVersionContent';
import { createReaderPreferencesStore, type ReaderPreferencesStore } from './readerPreferences';

/** One store per Reader screen. Only the signed-in entries use SecureStore; guest stays in memory. */
export function createNativeReaderPreferencesStore(): ReaderPreferencesStore {
  const versions = getYouVersionVersionOptions();
  if (!versions[0]) throw new Error('NO_READER_VERSIONS_CONFIGURED');
  return createReaderPreferencesStore({
    getItem: key => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  }, {
    allowedVersionIds: versions.map(version => version.versionId),
    defaultVersionId: versions[0].versionId,
  });
}
