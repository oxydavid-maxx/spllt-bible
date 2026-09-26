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

/**
 * The update notice every installed app reads (announcements/app-version.json) must announce the
 * release being published and send people to the install page. On 2026-09-26 it still named 0.5.9
 * and a GitHub asset six releases later, so no installed app ever offered an update.
 */
export function checkUpdateNotice(
  published: { versionCode: number; url: string } | null,
  release: { versionCode: number; pageUrl: string },
): string[] {
  if (!published) return ['the update notice (announcements/app-version.json) is missing or unreadable'];
  const problems: string[] = [];
  if (published.versionCode !== release.versionCode) {
    problems.push(`the update notice announces versionCode ${published.versionCode}, not this release's ${release.versionCode}`);
  }
  if (published.url !== release.pageUrl) problems.push(`the update notice points at ${published.url}, not the install page ${release.pageUrl}`);
  return problems;
}

/** The href of the page's download button: the first link with class "download". */
export function findDownloadHref(html: string): string | null {
  const anchor = html.match(/<a\b[^>]*\bclass="[^"]*\bdownload\b[^"]*"[^>]*>/i)?.[0];
  return anchor?.match(/\bhref="([^"]+)"/i)?.[1] ?? null;
}
