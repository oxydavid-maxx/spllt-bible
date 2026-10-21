/**
 * What this phone tells its own server about itself (光佑 2026-10-21: 「以後能不能紀錄誰用的是什麼版本？」):
 * platform, store version, build, the running OTA update and a random installation id. server/clientInstalls.ts
 * keeps the newest report per installation with the day it was last opened, for the 全體 (管理) list only.
 *
 * No react-native here: the API clients that use it also load in Node. src/services/clientInfoNative.ts fills
 * it in once at startup; until then requests go out exactly as before, and the server records nothing.
 */
export interface ClientInfo {
  installId: string;
  platform: 'android' | 'ios';
  version: string;
  build: string | null;
  updateId: string | null;
}

let current: ClientInfo | null = null;

export function setClientInfo(info: ClientInfo | null): void {
  current = info;
}

/** The five headers server/clientInstalls.ts reads; empty until the installation is known. */
export function clientHeaders(): Record<string, string> {
  if (!current) return {};
  return {
    'x-qingmu-client-install': current.installId,
    'x-qingmu-client-platform': current.platform,
    'x-qingmu-client-version': current.version,
    ...(current.build ? { 'x-qingmu-client-build': current.build } : {}),
    ...(current.updateId ? { 'x-qingmu-client-update': current.updateId } : {}),
  };
}

/**
 * The fetch every client of this app's server builds its requests with. Adds the headers without replacing the
 * request's own, and passes the request through untouched while nothing is known yet.
 */
export function withClientHeaders(fetchImpl: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const extra = clientHeaders();
    if (Object.keys(extra).length === 0) return init === undefined ? fetchImpl(input) : fetchImpl(input, init);
    const own = init?.headers;
    const ownHeaders: Record<string, string> = own === undefined ? {}
      : Array.isArray(own) ? Object.fromEntries(own)
      : typeof (own as Headers).forEach === 'function' ? (() => { const copy: Record<string, string> = {}; (own as Headers).forEach((value, key) => { copy[key] = value; }); return copy; })()
      : own as Record<string, string>;
    return fetchImpl(input, { ...init, headers: { ...extra, ...ownHeaders } });
  }) as typeof fetch;
}
