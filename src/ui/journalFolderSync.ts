import { Platform } from 'react-native';

/**
 * Whether the journal offers "同時存到我選的資料夾".
 *
 * Keeping a copy in a folder the member picked needs a lasting grant to that folder, which only Android's
 * Storage Access Framework gives (expo-file-system `StorageAccessFramework` is Android-only). On iOS the
 * button could only ever fail with 沒有選擇資料夾, so the journal offers 匯出全部 alone; its share sheet saves
 * the file to Files or a cloud drive.
 */
export function folderSyncSupported(platform: string = Platform.OS): boolean {
  return platform === 'android';
}
