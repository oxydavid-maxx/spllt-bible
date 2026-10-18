import { readFileSync } from 'node:fs';

/**
 * 後台規則與文件 (維護者 2026-10-17): the back-office documents (prize sheet, reading plan, rota, sign-up form)
 * listed for administrators. The addresses live in a private file ([{"name": …, "url": …}]), never in this public
 * repository; it is read on each request, so a new link needs no restart. A missing or broken file lists nothing.
 */
export interface AdminLink { name: string; url: string }

export function readAdminLinks(file: string | undefined): AdminLink[] {
  if (!file?.trim()) return [];
  try {
    const value = JSON.parse(readFileSync(file.trim(), 'utf8')) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const link = item as Partial<AdminLink> | null;
      if (!link || typeof link.name !== 'string' || !link.name.trim() || typeof link.url !== 'string') return [];
      try { return new URL(link.url).protocol === 'https:' ? [{ name: link.name.trim().slice(0, 40), url: link.url }] : []; } catch { return []; }
    });
  } catch {
    return [];
  }
}
