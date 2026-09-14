const FRIEND_QR_PREFIX = 'qingmu://friend/add?token=';

export function buildFriendQrPayload(token: string): string {
  if (!token.trim() || /[\s#?&]/.test(token)) throw new Error('INVALID_FRIEND_TOKEN');
  return `${FRIEND_QR_PREFIX}${encodeURIComponent(token)}`;
}

export function parseFriendQrPayload(value: string): string | null {
  if (!value.startsWith(FRIEND_QR_PREFIX)) return null;
  const encoded = value.slice(FRIEND_QR_PREFIX.length);
  if (!encoded || encoded.includes('&') || encoded.includes('#')) return null;
  try {
    const token = decodeURIComponent(encoded);
    return token && !/[\s#?&]/.test(token) ? token : null;
  } catch { return null; }
}
