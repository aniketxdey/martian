/**
 * Outbound HTTP for tenant-supplied URLs (custom MCP servers proxied by the gateway).
 *
 * The gateway runs inside Martian's network, so a tenant must not be able to reach
 * link-local metadata endpoints, loopback or private ranges through it (SSRF). The
 * check runs in the socket's DNS lookup, i.e. on the address actually connected to,
 * which also defeats DNS rebinding. Redirects are refused for the same reason.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32],
] as const) blocked.addSubnet(net, bits, "ipv6");

export class EgressError extends Error {}

/** True when the address is publicly routable. IPv4-mapped IPv6 is checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return !blocked.check(address, "ipv6");
  return false;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: any, callback: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "");
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad) return callback(new EgressError(`${hostname} resolves to a non-public address (${bad.address})`) as any, "");
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const publicOnly = new Agent({ connect: { lookup: guardedLookup as any }, headersTimeout: 120_000, bodyTimeout: 300_000 });

/**
 * fetch() for tenant-supplied URLs. Set MARTIAN_ALLOW_PRIVATE_EGRESS=true only for
 * single-tenant installs where custom MCP servers live on a private network.
 */
export async function tenantFetch(url: string, init: Parameters<typeof undiciFetch>[1] = {}) {
  const u = new URL(url);
  const allowPrivate = process.env.MARTIAN_ALLOW_PRIVATE_EGRESS === "true";
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) {
    throw new EgressError("custom MCP servers must use https");
  }
  if (u.username || u.password) throw new EgressError("credentials in the URL are not allowed; use the Authorization header");
  // Literal IPs skip DNS lookup, so check them here.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host) && !isPublicAddress(host)) throw new EgressError(`${host} is not a public address`);
  return undiciFetch(url, { ...init, redirect: "error", ...(allowPrivate ? {} : { dispatcher: publicOnly }) });
}
