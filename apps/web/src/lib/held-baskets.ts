// Counter baskets set aside while the buyer fetches their money, so the next person in the
// queue can be served and the first one picked up again afterwards.
//
// Kept in this browser on purpose: a held basket is a till convenience, not a record. It is
// not an order, reserves no stock, and is worth nothing once the buyer has gone — so it is
// keyed by depot, capped, and expires within the working day rather than living on a server.

export interface HeldBasket {
  id: string;
  savedAt: number;
  /** productId → quantity, exactly what the stepper held. */
  qty: Record<string, number>;
  name: string;
  phone: string;
  voucher: string;
  buyerId: string | null;
  /** The cashier's note on this sale, kept so holding a basket does not lose it. */
  note?: string;
  /**
   * The delivery form as it was. Held with the basket because a basket restored as a pick-up
   * would quote without the ongkir and silently be a different sale from the one set aside.
   */
  delivery?: HeldDelivery;
}

export interface HeldDelivery {
  on: boolean;
  recipient: string;
  phone: string;
  line: string;
  city: string;
  notes: string;
}

/** More than this is a queue nobody can keep track of, and a held basket nobody collects. */
export const MAX_HELD = 5;
/** Long enough to cover a lunch break, short enough that yesterday's basket is gone. */
export const HELD_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * `scope` is depot AND cashier. A till is often one browser used by several people over a
 * day, and a basket carries a buyer's name and number: it should be the cashier's own, not
 * whoever signs in next.
 */
const key = (scope: string) => `hm.walkin.held.${scope}`;

const isDelivery = (v: unknown): v is HeldDelivery => {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.on === 'boolean' &&
    ['recipient', 'phone', 'line', 'city', 'notes'].every((k) => typeof d[k] === 'string')
  );
};

const isBasket = (v: unknown): v is HeldBasket => {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.savedAt === 'number' &&
    typeof b.qty === 'object' &&
    b.qty !== null &&
    Object.values(b.qty as Record<string, unknown>).every((n) => Number.isInteger(n) && (n as number) > 0) &&
    typeof b.name === 'string' &&
    typeof b.phone === 'string' &&
    typeof b.voucher === 'string' &&
    (b.buyerId === null || typeof b.buyerId === 'string') &&
    (b.note === undefined || typeof b.note === 'string') &&
    (b.delivery === undefined || isDelivery(b.delivery))
  );
};

/** Whatever is still worth showing. Unreadable, malformed and expired entries are dropped. */
export function loadHeld(scope: string, now: number = Date.now()): HeldBasket[] {
  try {
    const raw = window.localStorage.getItem(key(scope));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isBasket)
      .filter((b) => now - b.savedAt >= 0 && now - b.savedAt < HELD_TTL_MS)
      .slice(0, MAX_HELD);
  } catch {
    return [];
  }
}

/** Best effort: a till whose storage is full or blocked still sells, it just cannot hold. */
export function saveHeld(scope: string, list: HeldBasket[]): boolean {
  try {
    if (list.length === 0) window.localStorage.removeItem(key(scope));
    else window.localStorage.setItem(key(scope), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Adds one, oldest last, or refuses when the queue is already full. */
export function addHeld(
  list: readonly HeldBasket[],
  basket: HeldBasket,
): { list: HeldBasket[]; added: boolean } {
  if (list.length >= MAX_HELD) return { list: [...list], added: false };
  return { list: [...list, basket], added: true };
}

export const removeHeld = (list: readonly HeldBasket[], id: string): HeldBasket[] =>
  list.filter((b) => b.id !== id);

/**
 * The quantities a held basket can still be sold at. Stock moved while it sat there, so each
 * line is cut to what is available now; a line with nothing left is dropped. `dropped` says
 * how many lines were cut or lost, so the cashier is told rather than surprised.
 */
export function restoreQuantities(
  basket: HeldBasket,
  availableById: ReadonlyMap<string, number>,
): { qty: Record<string, number>; adjusted: number } {
  const qty: Record<string, number> = {};
  let adjusted = 0;
  for (const [productId, wanted] of Object.entries(basket.qty)) {
    const have = Math.min(wanted, availableById.get(productId) ?? 0);
    if (have !== wanted) adjusted += 1;
    if (have > 0) qty[productId] = have;
  }
  return { qty, adjusted };
}

export const itemCount = (basket: Pick<HeldBasket, 'qty'>): number =>
  Object.values(basket.qty).reduce((sum, n) => sum + n, 0);
