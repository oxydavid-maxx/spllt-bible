import { describe, expect, it, vi } from 'vitest';

// The church backend runs from its own dependency folder. Loading the APNs library only when an iPhone push is
// actually configured and sent means a backend whose folder predates @parse/node-apn still starts.
const loaded = vi.hoisted(() => ({ apns: false }));
vi.mock('../../server/apnsSender', () => {
  loaded.apns = true;
  return { createApnsSender: () => ({ send: async () => undefined, shutdown: () => undefined }) };
});

describe('APNs library loading', () => {
  it('is not loaded by a server without the APNs key trio', async () => {
    const { createRemoteConfiguration } = await import('../../server/remoteConfiguration');
    expect(createRemoteConfiguration({}).pushIos).toBeNull();
    expect(loaded.apns).toBe(false);
  });
});
