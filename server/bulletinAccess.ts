import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 週刊 pages on Android (2026-10-19). React Native's Android Image passes request headers to the native view only
 * when `source` is an array (Libraries/Image/Image.android.js), so a page asked for with `{ uri, headers }` arrives
 * without the member's bearer token and the page stays blank. Listing the 週刊 therefore also hands out this cookie.
 * It opens the 週刊 pages and nothing else. Android keeps it in the cookie store that fetch and image loading share
 * (NetworkingModule and FrescoModule both use ForwardingCookieHandler), so apps already installed load the pages
 * without an update.
 *
 * Value: base64url(memberId).expiresAtMs.base64url(HMAC-SHA256). It is renewed on every list read and checked
 * again against the member at every page read, so a disabled member is shut out at once.
 */
export const BULLETIN_COOKIE = 'qm_bulletin';
export const BULLETIN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600;

function sign(key: Uint8Array | string, payload: string): string {
  return createHmac('sha256', key).update(`bulletin-pages|${payload}`).digest('base64url');
}

export function issueBulletinCookie(memberId: string, key: Uint8Array | string, nowMs: number): string {
  const payload = `${Buffer.from(memberId, 'utf8').toString('base64url')}.${nowMs + BULLETIN_COOKIE_MAX_AGE_SECONDS * 1000}`;
  return `${BULLETIN_COOKIE}=${payload}.${sign(key, payload)}; Path=/api/bulletins/; Max-Age=${BULLETIN_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure`;
}

/** The member the request's 週刊 cookie was issued to, or null when it is missing, altered or expired. */
export function readBulletinCookie(cookieHeader: string | undefined, key: Uint8Array | string, nowMs: number): string | null {
  const value = (cookieHeader ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${BULLETIN_COOKIE}=`))?.slice(BULLETIN_COOKIE.length + 1);
  const parts = value?.split('.');
  if (!parts || parts.length !== 3) return null;
  const [member, expires, signature] = parts;
  const expected = Buffer.from(sign(key, `${member}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!/^\d+$/.test(expires) || Number(expires) <= nowMs) return null;
  const memberId = Buffer.from(member, 'base64url').toString('utf8');
  return memberId || null;
}
