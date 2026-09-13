export interface GoogleIdentityOptions {
  clientId?: string | null;
  release?: boolean;
  authorize?: (clientId: string) => Promise<{ idToken: string }>;
}

export type GoogleIdentityResult =
  | { status: 'CONFIG_REQUIRED'; reason: string }
  | { status: 'AUTH_FLOW_UNAVAILABLE'; reason: string }
  | { status: 'AUTHENTICATED'; idToken: string };

export function createGoogleIdentity(options: GoogleIdentityOptions = {}) {
  return {
    async start(): Promise<GoogleIdentityResult> {
      if (!options.clientId?.trim()) {
        return { status: 'CONFIG_REQUIRED', reason: 'Google OAuth client ID is not configured' };
      }
      if (!options.authorize) {
        return {
          status: 'AUTH_FLOW_UNAVAILABLE',
          reason: options.release
            ? 'Native OAuth flow must be wired before a release build'
            : 'No OAuth executor was injected for this environment',
        };
      }
      const result = await options.authorize(options.clientId);
      return { status: 'AUTHENTICATED', idToken: result.idToken };
    },
  };
}
