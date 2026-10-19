import dns, { type LookupAddress } from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { nat64Address, withNat64 } from '../../server/nat64Fallback';

// 2026-10-20: the home line loses IPv4 now and then while IPv6 keeps working. LINE (週刊 photos) and Azure (靈修
// voices) have no IPv6 address, so the backend falls back to a public NAT64 gateway for IPv4-only hosts.
type Callback = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[] | string, family?: number) => void;
const fakeLookup = (table: Record<string, LookupAddress[]>) => ((hostname: string, options: unknown, callback: Callback) => {
  const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
  const found = table[hostname];
  if (!found) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  if (all) return callback(null, found);
  return callback(null, found[0].address, found[0].family);
}) as unknown as typeof dns.lookup;
const lookupAll = (lookup: typeof dns.lookup, hostname: string, options: object = { all: true }) => new Promise<LookupAddress[]>((resolve, reject) => {
  (lookup as unknown as (h: string, o: object, c: Callback) => void)(hostname, options, (error, addresses) => (error ? reject(error) : resolve(addresses as LookupAddress[])));
});

describe('NAT64 fallback for IPv4-only hosts', () => {
  const original = dns.lookup;
  let server: Server | undefined;
  afterEach(() => { dns.lookup = original; server?.close(); server = undefined; });

  it('embeds an IPv4 address in a /96 prefix', () => {
    expect(nat64Address('20.27.177.113', '2a01:4f9:c010:3f02:64::')).toBe('2a01:4f9:c010:3f02:64:0:141b:b171');
    expect(nat64Address('140.82.121.3', '2a00:1098:2c::5:0:0')).toBe('2a00:1098:2c::5:8c52:7903');
  });

  it('adds gateway addresses after the IPv4 ones, only for hosts without IPv6 and only for all-address lookups', async () => {
    const lookup = withNat64(fakeLookup({
      'v4only.test': [{ address: '203.0.113.7', family: 4 }],
      'dual.test': [{ address: '2001:db8::7', family: 6 }, { address: '203.0.113.8', family: 4 }],
    }), (ipv4) => [`64:ff9b::${ipv4}`]);
    expect(await lookupAll(lookup, 'v4only.test')).toEqual([{ address: '203.0.113.7', family: 4 }, { address: '64:ff9b::203.0.113.7', family: 6 }]);
    expect(await lookupAll(lookup, 'dual.test')).toEqual([{ address: '2001:db8::7', family: 6 }, { address: '203.0.113.8', family: 4 }]);
    expect(await lookupAll(lookup, 'v4only.test', { all: true, family: 4 })).toEqual([{ address: '203.0.113.7', family: 4 }]);
    const single = await new Promise<string>((resolve) => (lookup as unknown as (h: string, o: object, c: Callback) => void)('v4only.test', {}, (_e, address) => resolve(address as string)));
    expect(single).toBe('203.0.113.7');
    await expect(lookupAll(lookup, 'missing.test')).rejects.toThrow('ENOTFOUND');
  });

  it('lets fetch reach a host whose IPv4 address does not answer, through the gateway address', async () => {
    server = createServer((_request, response) => response.end('reached'));
    await new Promise<void>((resolve) => server!.listen(0, '::1', resolve));
    const { port } = server.address() as AddressInfo;
    // 192.0.2.1 (TEST-NET-1) never answers, like GitHub/LINE/Azure while the home IPv4 is down.
    dns.lookup = withNat64(fakeLookup({ 'ipv4-down.test': [{ address: '192.0.2.1', family: 4 }] }), () => ['::1']);
    const started = Date.now();
    const response = await fetch(`http://ipv4-down.test:${port}/`, { signal: AbortSignal.timeout(8000) });
    expect(await response.text()).toBe('reached');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
