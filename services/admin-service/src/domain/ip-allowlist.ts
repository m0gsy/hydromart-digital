/**
 * ADM-6 — the IP allowlist, finally read by something.
 *
 * It was written on the HQ security screen, stored by admin-service, and evaluated by
 * nothing: no gateway, no guard. The page's own note called that "the same lie in a smaller
 * font". This is where it stops being one for the surface admin-service actually owns — the
 * partner API, whose keys and whose policy both live in this service.
 *
 * Not the HQ console itself: those requests arrive through the gateway, which this service
 * cannot see past, and pretending otherwise would be a second lie. The screen says so.
 *
 * Entries are plain addresses (`203.0.113.7`) or IPv4 CIDR (`203.0.113.0/24`). An empty
 * list means "from anywhere", which is what it has always meant.
 */
export function ipAllowed(address: string | null, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!address) return false; // an allowlist we cannot evaluate refuses, it does not wave through
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return allowlist.some((entry) => matches(ip, entry.trim()));
}

function matches(ip: string, entry: string): boolean {
  if (!entry) return false;
  if (!entry.includes('/')) return entry === ip;
  const [network, bitsRaw] = entry.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = toInt(ip);
  const b = toInt(network);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function toInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = ((out << 8) | n) >>> 0;
  }
  return out;
}
