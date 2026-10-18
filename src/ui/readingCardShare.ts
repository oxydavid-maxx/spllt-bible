/** Identical official Expo path on Android and iOS. Native modules stay lazy until export. */
export async function shareReadingCard(html: string, isCurrent: () => boolean = () => true): Promise<void> {
  const [print, sharing] = await Promise.all([import('expo-print'), import('expo-sharing')]);
  if (!isCurrent()) return;
  if (!await sharing.isAvailableAsync()) throw new Error('這支手機目前無法開啟分享面板。');
  // Expo measures pages at 72ppi. @page in the HTML removes Android's WebView margins;
  // the margins option does the same on iOS. textZoom prevents Android font scaling the card.
  const { uri } = await print.printToFileAsync({ html, width: 595, height: 842, margins: { top: 0, bottom: 0, left: 0, right: 0 }, textZoom: 100 });
  if (!isCurrent()) return;
  await sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: '匯出讀經卡' });
}
