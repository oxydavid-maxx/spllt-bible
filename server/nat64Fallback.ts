import dns, { type LookupAddress } from 'node:dns';
import { isIPv4 } from 'node:net';

/**
 * IPv4 fallback for the backend's outbound connections (光佑 2026-10-20). The home line loses IPv4 now and then
 * while IPv6 keeps working (2026-10-19: three outages, the longest 23:00–05:52). bible.com, Google and Apple have
 * IPv6; LINE (週刊 photos, api.line.me / api-data.line.me) and Azure Speech (靈修 voices) do not.
 *
 * For a host that resolves to IPv4 only, an all-address lookup also returns the same address embedded in the /96
 * prefix of a public NAT64 gateway (nat64.net, two sites), after the IPv4 ones. Node's connection racing
 * (autoSelectFamily, on by default; fetch uses it) tries IPv4 first and moves to the next address when one does not
 * connect within its attempt timeout, so a working IPv4 line is still used as before and the gateway only carries
 * traffic while IPv4 is down. TLS still runs end to end with the real host name; the gateway relays bytes only.
 * Hosts with their own IPv6 address, and lookups that ask for one address or for IPv4 only, are left unchanged.
 */
export const NAT64_PREFIXES = ['2a01:4f9:c010:3f02:64::', '2a00:1098:2c::5:0:0'] as const;

/** The IPv4 address written into the last 32 bits of a /96 prefix, e.g. 20.27.177.113 → …:141b:b171. */
export function nat64Address(ipv4: string, prefix: string): string {
  const groups = expand(prefix).slice(0, 6);
  const [a, b, c, d] = ipv4.split('.').map(Number);
  const hex = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
  return compress([...groups, ...hex]);
}

function expand(address: string): string[] {
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = address.includes('::') && tail ? tail.split(':') : [];
  const zeros = Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...(address.includes('::') ? zeros : []), ...right].map((group) => (parseInt(group, 16) || 0).toString(16));
}

function compress(groups: string[]): string {
  let best = { start: -1, length: 0 };
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== '0') { i += 1; continue; }
    let j = i;
    while (j < groups.length && groups[j] === '0') j += 1;
    if (j - i > best.length && j - i > 1) best = { start: i, length: j - i };
    i = j;
  }
  if (best.start < 0) return groups.join(':');
  return `${groups.slice(0, best.start).join(':')}::${groups.slice(best.start + best.length).join(':')}`;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Wraps a dns.lookup-shaped function; `synthesize` maps one IPv4 address to its gateway addresses. */
export function withNat64(base: typeof dns.lookup, synthesize: (ipv4: string) => string[] = (ipv4) => NAT64_PREFIXES.map((prefix) => nat64Address(ipv4, prefix))): typeof dns.lookup {
  const call = base as unknown as (hostname: string, options: unknown, callback: LookupCallback) => void;
  const wrapped = (hostname: string, optionsOrCallback: unknown, maybeCallback?: LookupCallback) => {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as LookupCallback;
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    const family = typeof options === 'number' ? options : typeof options === 'object' && options !== null ? (options as { family?: number | string }).family : undefined;
    if (!all || family === 4 || family === 'IPv4' || isIPv4(hostname)) return call(hostname, options, callback);
    call(hostname, options, (error, addresses, ...rest) => {
      if (error || !Array.isArray(addresses) || addresses.some((entry) => entry.family === 6)) return callback(error, addresses, ...rest);
      const gateways = addresses.filter((entry) => entry.family === 4).slice(0, 2)
        .flatMap((entry) => synthesize(entry.address).map((address) => ({ address, family: 6 })));
      callback(null, [...addresses, ...gateways]);
    });
  };
  return wrapped as unknown as typeof dns.lookup;
}

let installed = false;
/** Makes every later outbound connection in this process use the fallback (net.connect reads dns.lookup per call). */
export function installNat64Fallback(log: (line: string) => void = (line) => console.log(line)): void {
  if (installed) return;
  installed = true;
  dns.lookup = withNat64(dns.lookup.bind(dns) as typeof dns.lookup);
  log(`NAT64_FALLBACK_ON prefixes=${NAT64_PREFIXES.length}`);
}
