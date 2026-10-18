/** Identical official Expo path on Android and iOS. Native modules stay lazy until export. */
export async function shareReadingCard(html: string, fileName: string, isCurrent: () => boolean = () => true): Promise<void> {
  const [print, sharing] = await Promise.all([import('expo-print'), import('expo-sharing')]);
  if (!isCurrent()) return;
  if (!await sharing.isAvailableAsync()) throw new Error('這支手機目前無法開啟分享面板。');
  // Expo measures pages at 72ppi. @page in the HTML removes Android's WebView margins;
  // the margins option does the same on iOS. textZoom prevents Android font scaling the card.
  const { uri } = await print.printToFileAsync({ html, width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 }, textZoom: 100 });
  if (!isCurrent()) return;
  await sharing.shareAsync(await renamed(uri, fileName), { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: '匯出讀經卡' });
}

/** expo-print names the file with a random id; the share sheet and the receiver show that name. */
async function renamed(uri: string, fileName: string): Promise<string> {
  try {
    const { File, Paths } = await import('expo-file-system');
    const file = new File(uri);
    file.moveSync(new File(Paths.cache, fileName), { overwrite: true });
    return file.uri;
  } catch {
    return uri; // The name is a convenience; the card itself must still be shared.
  }
}
