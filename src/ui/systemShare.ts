import { Share } from 'react-native';

/**
 * The system share sheet for plain text. A module of its own so journalShare can still load it lazily:
 * a dynamic import of react-native compiles to metroImportAll, which runs every react-native getter and on
 * iOS builds PushNotificationIOS's NativeEventEmitter with no native module (a release-app crash).
 * Returns false when the member dismissed the sheet.
 */
export async function shareTextSheet(message: string): Promise<boolean> {
  const result = await Share.share({ message });
  return result.action !== Share.dismissedAction;
}
