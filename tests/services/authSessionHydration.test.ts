import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { createAuthSessionController } from '../../src/services/authSession';

describe('root auth hydration lifecycle', () => {
  it('hydrates one persisted session and exposes an explicit signed-in snapshot', async () => {
    const secure = {
      getItemAsync: vi.fn(async (key: string) => key.endsWith('.token') ? 'qms_session' : 'member:one'),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const controller = createAuthSessionController({ secureStore: secure });

    await expect(controller.hydrate()).resolves.toMatchObject({
      status: 'signed-in',
      session: { memberId: 'member:one', sessionToken: 'qms_session' },
    });
    expect(secure.getItemAsync).toHaveBeenCalledWith('qingmu.session.token');
    expect(secure.getItemAsync).toHaveBeenCalledWith('qingmu.session.member');
  });

  it('expires without clearing local-progress ownership', async () => {
    const secure = {
      getItemAsync: vi.fn(async () => 'expired-value'),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const controller = createAuthSessionController({ secureStore: secure });

    await controller.hydrate();
    controller.markExpired();

    expect(controller.getSnapshot()).toMatchObject({ status: 'expired' });
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });
});
