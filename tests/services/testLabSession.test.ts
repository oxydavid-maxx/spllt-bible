import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/services/apiClient';

describe('Google session Test Lab request payload', () => {
  it.each([true, false])('sends boolean %s alongside the device session option', async (firebaseTestLab) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: '', memberId: '', fetchImpl });
    await client.establishSession('synthetic-token', { persistentDevice: true, firebaseTestLab });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/api/session/google', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ session_type: 'device', firebase_test_lab: firebaseTestLab }),
    }));
  });

  it('omits the signal for iOS and old clients', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const client = createApiClient({ baseUrl: 'https://api.example.test', token: '', memberId: '', fetchImpl });
    await client.establishSession('synthetic-token', { persistentDevice: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ session_type: 'device' });
  });
});
