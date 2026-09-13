import { describe, expect, it } from 'vitest';
import { createGoogleIdentity } from '../../src/services/googleIdentity';

describe('Google identity boundary', () => {
  it('requires configured OAuth client IDs and does not use a fixture as release auth', async () => {
    await expect(createGoogleIdentity({}).start()).resolves.toMatchObject({ status: 'CONFIG_REQUIRED' });
    await expect(
      createGoogleIdentity({ clientId: 'client.apps.googleusercontent.com', release: true }).start(),
    ).resolves.not.toMatchObject({ status: 'FIXTURE_AUTHENTICATED' });
  });
});
