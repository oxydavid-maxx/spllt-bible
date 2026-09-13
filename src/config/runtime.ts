export type ContentMode = 'C_PENDING_ACCESS' | 'C_TECHNICAL_PROBE' | 'C_READY' | 'C_NOT_AVAILABLE';

export interface RuntimeConfig {
  apiBaseUrl: string;
  contentMode: ContentMode;
  googleClientId: string | null;
  googleServerClientId: string | null;
  youVersionAppKey: string | null;
}

function optional(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function runtimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  return {
    apiBaseUrl: env.QINGMU_API_BASE_URL?.trim() || 'http://127.0.0.1:8787',
    contentMode: 'C_PENDING_ACCESS',
    googleClientId: optional(env, 'QINGMU_GOOGLE_CLIENT_ID'),
    googleServerClientId: optional(env, 'QINGMU_GOOGLE_SERVER_CLIENT_ID'),
    youVersionAppKey: optional(env, 'QINGMU_YOUVERSION_APP_KEY'),
  };
}
