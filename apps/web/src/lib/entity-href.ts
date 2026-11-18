/**
 * PR-2: a name on a console screen is a door to that thing's own page.
 *
 * Settlements named a courier, refunds named an order, an order named its buyer — all as
 * plain text, so the reader retyped them into search. This is the one table of where each
 * kind of thing lives in each console, and it asks `canOpenRoute` before answering: `null`
 * means "no page this reader can open in this build", and the caller draws the plain text
 * it always drew.
 *
 * Where no screen for one record exists, the nearest list is the door (owner decision
 * 2026-11-18): a stock-count approval opens the stock list, a gallon one the returns list.
 */
import { canOpenRoute, type ConsoleSide } from '@/lib/route-access';

type Role = string | null | undefined;

export type EntityKind = 'order' | 'customer' | 'courier' | 'depot' | 'supplier' | 'stock' | 'gallon';

/** order-service `domain/anonymous.ts`: the buyer on a counter sale with no account. */
const ANONYMOUS_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';

const q = encodeURIComponent;

/** `ref` is the record's id, except on the HQ customer screen: it looks up an ACCOUNT phone. */
const TARGETS: Record<EntityKind, Partial<Record<ConsoleSide, (ref: string) => string>>> = {
  order: {
    dashboard: (id) => `/dashboard/orders?order=${q(id)}`,
    hq: (id) => `/hq/orders/detail?id=${q(id)}`,
  },
  customer: {
    dashboard: (id) => `/dashboard/customers/detail?id=${q(id)}`,
    hq: (phone) => `/hq/customers?phone=${q(phone)}`,
  },
  courier: { dashboard: (id) => `/dashboard/team-performance?driver=${q(id)}` },
  depot: { hq: (id) => `/hq/depots/detail?id=${q(id)}` },
  supplier: { dashboard: () => '/dashboard/suppliers' },
  stock: { dashboard: () => '/dashboard/inventory' },
  gallon: { dashboard: () => '/dashboard/returns' },
};

export function entityHref(
  kind: EntityKind,
  ref: string | null | undefined,
  side: ConsoleSide,
  role: Role,
): string | null {
  if (!ref || ref === ANONYMOUS_CUSTOMER_ID) return null;
  const build = TARGETS[kind][side];
  if (!build) return null;
  const href = build(ref);
  return canOpenRoute(href, role) ? href : null;
}
