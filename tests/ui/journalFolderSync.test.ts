import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { folderSyncSupported } from '../../src/ui/journalFolderSync';

// Keeping a copy in a folder the member picked needs a lasting folder grant, which only Android gives. On an
// iPhone the button could only fail ("沒有選擇資料夾"), so the journal offers 匯出全部 alone there.
describe('journal folder sync', () => {
  it('is offered on Android', () => {
    expect(folderSyncSupported()).toBe(true);
    expect(folderSyncSupported('android')).toBe(true);
  });

  it('is not offered on iOS', () => {
    expect(folderSyncSupported('ios')).toBe(false);
  });

  it('gates the folder and stop-sync buttons in the journal tab', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('app/(tabs)/journal.tsx', 'utf8');
    const gate = source.indexOf('folderSyncSupported() ?');
    expect(gate).toBeGreaterThan(-1);
    for (const label of ["'同時存到我選的資料夾'", '"停止同步到資料夾"']) expect(source.indexOf(label)).toBeGreaterThan(gate);
    expect(source.indexOf('"匯出靈修日記"')).toBeLessThan(gate);
  });
});
