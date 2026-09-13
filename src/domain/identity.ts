export type IdentityProvider = 'google' | 'line';

export function memberKey(provider: IdentityProvider, subject: string): string {
  const normalizedSubject = subject.trim();
  if (!normalizedSubject) throw new Error('identity subject is required');
  return `${provider}:${normalizedSubject}`;
}
