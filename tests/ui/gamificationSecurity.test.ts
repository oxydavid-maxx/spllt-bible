import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: false })) }));
import { buildFriendQrPayload, parseFriendQrPayload } from '../../src/services/gamificationQr';
import { createAdminUnlockGuard } from '../../src/services/adminUnlockGuard';

describe('gamification security boundaries', () => {
  it('accepts only the Qingmu friend URI and claims each scanned payload once', () => {
    const payload = buildFriendQrPayload('opaque-token');
    expect(payload).toBe('qingmu://friend/add?token=opaque-token');
    expect(parseFriendQrPayload(payload)).toBe('opaque-token');
    expect(parseFriendQrPayload('https://example.test/?token=opaque-token')).toBeNull();
  });

  it('fails closed when native authentication is cancelled and unlocks only after success', async () => {
    let result: 'success' | 'cancel' = 'cancel';
    const guard = createAdminUnlockGuard({ authenticate: async () => result === 'success' });
    expect(guard.state).toBe('locked');
    await expect(guard.unlock()).resolves.toBe(false);
    expect(guard.state).toBe('locked');
    result = 'success';
    await expect(guard.unlock()).resolves.toBe(true);
    expect(guard.state).toBe('unlocked');
    guard.clear();
    expect(guard.state).toBe('locked');
  });
});
