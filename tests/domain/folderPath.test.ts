import { describe, expect, it } from 'vitest';
import { describeFolderUri } from '../../src/domain/folderPath';

// Android hands back a grant as `content://…/tree/primary%3ADocuments%2FObsidian`, which tells the
// person who just picked a folder nothing. They picked it to put their journal somewhere specific,
// so the one thing the screen owes them is enough of the path to recognise it.

describe('the folder you picked, in words you picked it by', () => {
  it('reads back the end of a deep path', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FObsidian%2F%E9%9D%92%E7%89%A7%2F70_%E7%B4%80%E9%8C%84%2F%E9%9D%88%E4%BF%AE%E6%97%A5%E8%A8%98'))
      .toBe('…/青牧/70_紀錄/靈修日記');
  });

  it('shows a short path whole, with no ellipsis to decode', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FObsidian'))
      .toBe('Documents/Obsidian');
  });

  it('ignores the document half of a tree-document uri', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3ANotes/document/primary%3ANotes%2Fsub'))
      .toBe('Notes');
  });

  it('names the internal storage root rather than showing nothing', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3A')).toBe('內部儲存空間');
  });

  it('keeps a memory card readable too', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ABackup%2F%E6%97%A5%E8%A8%98'))
      .toBe('Backup/日記');
  });

  it('does not turn a plus sign in a folder name into a space', () => {
    expect(describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3AC%2B%2B')).toBe('C++');
  });

  it('says nothing at all when there is nothing it can honestly read', () => {
    expect(describeFolderUri(null)).toBeNull();
    expect(describeFolderUri('')).toBeNull();
    expect(describeFolderUri('content://com.android.providers.downloads.documents/document/12')).toBeNull();
    expect(describeFolderUri('content://x/tree/primary%3A%E4%B8%8D%2%E5%AE%8C')).toBeNull();
  });
});
