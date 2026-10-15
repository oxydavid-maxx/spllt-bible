import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * Google Play's pre-launch report installs every new upload on Firebase Test Lab devices, and its crawler
 * signs in to the app with Google by itself (Play Console Help, "Use pre-launch reports to identify issues";
 * there is no switch for this). Each upload therefore made about a dozen made-up members that read, voted
 * and showed up in the rankings until the maintainer turned them off by hand (2026-10-14).
 *
 * The same help page points to this list for telling those devices apart: "All network traffic initiated by
 * Test Lab devices originates from the following IP address blocks"
 * (https://firebase.google.com/docs/test-lab/overview#ip-blocks, also `gcloud beta firebase test ip-blocks list`).
 * Copied 2026-10-15; Google updates it about once a year, newest entries May 2026.
 */
const TEST_LAB_IP_BLOCKS: ReadonlyArray<string> = [
  // Android and iOS physical devices, Arm virtual devices.
  '70.32.128.0/19', '108.177.6.0/23', '108.177.18.192/26', '108.177.29.64/27', '108.177.31.160/27', '199.36.156.8/29',
  '199.36.156.16/28', '209.85.131.0/27', '70.32.128.48/28', '70.32.150.192/27', '108.177.6.0/27', '108.177.24.160/27',
  '108.177.29.0/27', '108.177.25.128/27', '108.177.26.128/26', '108.177.29.192/26', '172.217.120.64/26', '172.217.120.128/26',
  '2001:4860:1008::/48', '2001:4860:1018::/48', '2001:4860:1019::/48', '2001:4860:1020::/48', '2001:4860:1022::/48',
  '2001:4860:101d::/48', '2001:4860:101e::/48', '2001:4860:1031::/48', '2001:4860:1037::/48', '2001:4860:1038::/48',
  '2001:4860:103a::/48',
  // Android virtual devices (not Arm).
  '34.68.194.64/29', '34.69.234.64/29', '34.73.34.72/29', '34.73.178.72/29', '34.74.10.72/29', '34.136.2.136/29',
  '34.136.50.136/29', '34.145.234.144/29', '35.192.160.56/29', '35.196.166.80/29', '35.196.169.240/29', '35.203.128.0/28',
  '35.234.176.160/28', '35.243.2.0/27', '35.245.243.240/29', '199.192.115.0/30', '199.192.115.8/30', '199.192.115.16/29',
];

const blocks = new BlockList();
for (const block of TEST_LAB_IP_BLOCKS) {
  const [network, prefix] = block.split('/');
  blocks.addSubnet(network, Number(prefix), isIPv6(network) ? 'ipv6' : 'ipv4');
}

/** The client address Cloudflare reports for a request (`cf-connecting-ip`); anything malformed is not a test device. */
export function isTestLabAddress(address: string | undefined): boolean {
  const value = address?.trim() ?? '';
  const ipv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)?.[1] ?? (isIPv4(value) ? value : null);
  if (ipv4) return isIPv4(ipv4) && blocks.check(ipv4, 'ipv4');
  return isIPv6(value) && blocks.check(value, 'ipv6');
}
