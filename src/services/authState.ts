export interface AuthExpiryOwner { memberId: string; sessionToken: string; }
type AuthExpiryHandler = (owner?: AuthExpiryOwner) => void;
let expiryHandler: AuthExpiryHandler | null = null;

export function registerAuthExpiryHandler(handler: AuthExpiryHandler): void {
  expiryHandler = handler;
}

export function notifyAuthExpired(owner?: AuthExpiryOwner): void {
  expiryHandler?.(owner);
}
