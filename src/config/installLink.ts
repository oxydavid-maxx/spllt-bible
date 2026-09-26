/**
 * The friends' install page must download the APK itself. A github.com download link opened the
 * GitHub app's sign-in screen (then a Chrome/淘寶 chooser) on phones with the GitHub app installed,
 * so the page links an .apk served next to it, on the same site.
 */
export function checkDownloadHref(pageUrl: string, href: string): string[] {
  const page = new URL(pageUrl);
  let target: URL;
  try {
    target = new URL(href, page);
  } catch {
    return ['download link is not a valid URL'];
  }
  if (target.origin !== page.origin) return [`download link leaves the page's site (${target.hostname})`];
  if (!target.pathname.toLowerCase().endsWith('.apk')) return ['download link is not an .apk file'];
  return [];
}

/** The href of the page's download button: the first link with class "download". */
export function findDownloadHref(html: string): string | null {
  const anchor = html.match(/<a\b[^>]*\bclass="[^"]*\bdownload\b[^"]*"[^>]*>/i)?.[0];
  return anchor?.match(/\bhref="([^"]+)"/i)?.[1] ?? null;
}
