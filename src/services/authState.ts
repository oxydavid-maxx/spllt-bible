type AuthExpiryHandler = () => void;
let expiryHandler: AuthExpiryHandler | null = null;

export function registerAuthExpiryHandler(handler: AuthExpiryHandler): void {
  expiryHandler = handler;
}

export function notifyAuthExpired(): void {
  expiryHandler?.();
}
