/**
 * Turning an Android folder grant back into something a person recognises.
 *
 * A grant looks like `content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FObsidian`.
 * Somebody who just picked a folder for their journal wants to see that they picked the right one,
 * and none of that string says so. This is the whole of the translation, kept away from any Android
 * API so it can be tested as what it is: string handling.
 */

/** How many trailing segments identify a folder. Three is enough to tell two 靈修日記 apart. */
const RECOGNISABLE_SEGMENTS = 3;

export function describeFolderUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const marker = uri.indexOf('/tree/');
  if (marker < 0) return null;

  // A picked folder can arrive as a tree uri or as a tree-and-document uri. The tree half is the
  // grant; the document half only repeats it, so it stops at the first unescaped separator.
  const encoded = uri.slice(marker + '/tree/'.length).split('/')[0];
  let decoded: string;
  try { decoded = decodeURIComponent(encoded); } catch { return null; }

  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  const volume = decoded.slice(0, colon);
  const segments = decoded.slice(colon + 1).split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) return volume === 'primary' ? '內部儲存空間' : volume;
  if (segments.length <= RECOGNISABLE_SEGMENTS) return segments.join('/');
  return `…/${segments.slice(-RECOGNISABLE_SEGMENTS).join('/')}`;
}
