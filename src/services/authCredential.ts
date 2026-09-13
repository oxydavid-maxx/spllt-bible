/** Format recognition only; the server still verifies the stored credential hash. */
export function isDeviceSessionCredential(token: string): boolean {
  return /^qmd_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token);
}
export function isLegacySessionCredential(token: string): boolean {
  return /^qms_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}
