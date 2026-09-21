/**
 * The network side of the weekly job. No credentials anywhere in this file, and that is deliberate:
 * everything it reaches is already link-readable, so the job can run from a scheduled task without
 * anybody minting a key for it or a key expiring quietly six months later.
 */

const TIMEOUT_MS = 60_000;

async function get(url: string, kind: 'text' | 'binary'): Promise<string | Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) return null;
    if (kind === 'text') return await response.text();
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A folder's contents through Drive's embedded view.
 *
 * Undocumented, and the one part of this job that could stop working without warning. It is used
 * only here; the app never touches it, because the app reads the published JSON instead. So the
 * blast radius of Google changing this is "the Tuesday run logs a failure", not "the phone breaks".
 */
export async function fetchFolderHtml(folderId: string): Promise<string | null> {
  return await get(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, 'text') as string | null;
}

/** Plain text of a Google Slides deck. */
export async function fetchSlidesText(fileId: string): Promise<string | null> {
  return await get(`https://docs.google.com/presentation/d/${fileId}/export/txt`, 'text') as string | null;
}

/** Plain text of a Google Doc. */
export async function fetchDocText(fileId: string): Promise<string | null> {
  return await get(`https://docs.google.com/document/d/${fileId}/export?format=txt`, 'text') as string | null;
}

/** A whole workbook, so a tab can be addressed by the name a person sees. */
export async function fetchWorkbook(fileId: string): Promise<Buffer | null> {
  return await get(`https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`, 'binary') as Buffer | null;
}

/** An uploaded binary — a .pptx that was never converted, for instance. */
export async function fetchDriveFile(fileId: string): Promise<Buffer | null> {
  return await get(`https://drive.google.com/uc?export=download&id=${fileId}`, 'binary') as Buffer | null;
}
