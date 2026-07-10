/**
 * Pure routing core. Given an incoming request path and the segment -> upstream
 * base URL map, return the target for its first path segment, or null when the
 * first segment names no known service.
 *
 * Example: resolveRoute('/orders/api/v1/orders', { orders: 'http://host:3004' })
 *          -> { target: 'http://host:3004', segment: 'orders' }
 */
export function resolveRoute(
  path: string,
  upstreams: Record<string, string>,
): { target: string; segment: string } | null {
  const segment = path.split('/').filter(Boolean)[0];
  if (!segment) return null;
  const target = upstreams[segment];
  return target ? { target, segment } : null;
}
