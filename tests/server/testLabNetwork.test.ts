import { describe, expect, it } from 'vitest';
import { isTestLabAddress } from '../../server/testLabNetwork';

// Google Play's pre-launch report signs in to the app with Google on Firebase Test Lab devices, and every
// one of them reaches the internet from the address blocks Google publishes for Test Lab.
describe('Firebase Test Lab device addresses', () => {
  it('recognises physical-device, Arm and x86 virtual-device addresses, IPv4 and IPv6', () => {
    for (const address of ['108.177.6.20', '70.32.150.200', '172.217.120.70', '199.36.156.10', '34.68.194.66', '199.192.115.17', '2001:4860:1008::1', '2001:4860:103a:5::9', '::ffff:108.177.6.20']) {
      expect(isTestLabAddress(address), address).toBe(true);
    }
  });

  it('does not match home, mobile or other Google addresses', () => {
    for (const address of ['114.34.1.1', '1.2.3.4', '8.8.8.8', '108.177.8.1', '2001:4860:4860::8888', '2402:7500::1']) {
      expect(isTestLabAddress(address), address).toBe(false);
    }
  });

  it('treats a missing or malformed address as not a test device', () => {
    for (const address of [undefined, '', 'abc', '108.177.6', '108.177.6.20, 1.2.3.4']) {
      expect(isTestLabAddress(address), String(address)).toBe(false);
    }
  });
});
