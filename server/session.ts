import { createHmac, timingSafeEqual } from 'node:crypto';

interface SessionPayload {
  memberId: string;
  issuedAt: number;
  expiresAt: number;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(memberId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), ttlSeconds = 3600): string {
  if (!secret.trim()) throw new Error('SESSION_SECRET_REQUIRED');
  const payload: SessionPayload = { memberId, issuedAt: nowSeconds, expiresAt: nowSeconds + ttlSeconds };
  const encoded = encode(JSON.stringify(payload));
  return `qms_${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  if (!token.startsWith('qms_') || !secret.trim()) return null;
  const [encoded, signature] = token.slice(4).split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.memberId || payload.expiresAt <= nowSeconds) return null;
    return payload.memberId;
  } catch {
    return null;
  }
}
