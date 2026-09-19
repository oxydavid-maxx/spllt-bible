/**
 * Hands the exported journal to whatever the phone can do with it.
 *
 * Preference order, best first: a real `.md` file through the system share sheet, which is what
 * lands in Google Drive or Files intact; then the text through the share sheet, which reaches a
 * messaging app; then the clipboard. Each step down still gets the writing out of this app, which
 * is the only thing export has to guarantee.
 *
 * Every native module is loaded on demand. Importing them at the top would make this module — and
 * so the journal screen — impossible to render under test, and would make an export helper a reason
 * a screen fails to load.
 */

export type ShareOutcome = 'shared' | 'copied' | 'failed';

const FILE_NAME = 'qingmu-journal.md';

export async function shareJournalExport(document: string): Promise<ShareOutcome> {
  try {
    const [sharing, fileSystem] = await Promise.all([import('expo-sharing'), import('expo-file-system')]);
    if (await sharing.isAvailableAsync()) {
      // ASCII filename on purpose: share targets mangle CJK names, and a file called ??????.md is
      // worse than one called qingmu-journal.md.
      const directory = (fileSystem as unknown as { cacheDirectory?: string }).cacheDirectory;
      if (directory) {
        const uri = `${directory}${FILE_NAME}`;
        await (fileSystem as unknown as { writeAsStringAsync(uri: string, contents: string): Promise<void> })
          .writeAsStringAsync(uri, document);
        await sharing.shareAsync(uri, { mimeType: 'text/markdown', dialogTitle: '匯出靈修日記', UTI: 'net.daringfireball.markdown' });
        return 'shared';
      }
    }
  } catch { /* fall through to the text routes */ }

  try {
    const { Share } = await import('react-native');
    const result = await Share.share({ message: document });
    if (result.action !== Share.dismissedAction) return 'shared';
  } catch { /* fall through to the clipboard */ }

  try {
    const clipboard = await import('expo-clipboard');
    await clipboard.setStringAsync(document);
    return 'copied';
  } catch {
    return 'failed';
  }
}
