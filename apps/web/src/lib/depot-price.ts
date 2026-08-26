'use client';

/**
 * PG-03 — the price the shopper's own depot charges.
 *
 * Every customer-facing surface used to print `product.basePrice`: the catalogue grid, the
 * product page, and the "Tambah ke keranjang Rp…" button on it. The CART and the CHECKOUT
 * ask order-service, which prices each line against the depot that will fulfil it — its own
 * override, its active pricing rule, its wholesale bands. At a depot running a +10% rule the
 * shopper read Rp20.000 a galon on two screens, pressed a button that said Rp40.000, and
 * then saw Rp44.000 in the cart with nothing having changed but the screen.
 *
 * So the shelf asks the same question the till does. `location.depotId` is the depot behind
 * the shopper's chosen delivery location — the same one `useMemberRate` quotes against.
 *
 * Fails SOFT and says so: no location, no depot, or a failed read all come back as
 * `basis: 'CATALOG'`, and the caller shows the catalogue price LABELLED as an estimate
 * rather than passing it off as the depot's. That is exactly what the checkout summary
 * already does with `pricingBasis`.
 */

import { api } from './api';
import { endpoints } from './endpoints';
import { useLocation } from './location-context';
import { useAsync } from './use-async';

export type PriceBasis = 'DEPOT' | 'CATALOG';

interface ShelfPrice {
  productId: string;
  unitPrice: number;
}

export interface DepotPrices {
  /** productId -> the depot's price. Empty when `basis` is CATALOG. */
  prices: Map<string, number>;
  basis: PriceBasis;
}

/** The depot's price for each id, or CATALOG basis when it cannot be established. */
export function useDepotPrices(productIds: string[]): DepotPrices {
  const { location } = useLocation();
  const depotId = location?.depotId ?? null;
  // Sorted + joined so a re-render with the same ids in a different order is not a new read.
  const key = [...new Set(productIds)].sort().join(',');

  const { data } = useAsync<{ basis: PriceBasis; prices: ShelfPrice[] } | null>(
    () =>
      key.length > 0
        ? api
            .getCached<{ basis: PriceBasis; prices: ShelfPrice[] }>(
              endpoints.cart.shelfPrices(key.split(','), depotId),
            )
            .catch(() => null)
        : Promise.resolve(null),
    [depotId, key],
  );

  // No answer at all is CATALOG too: the caller labels what it shows rather than passing a
  // catalogue price off as the depot's.
  if (!data) return { prices: new Map(), basis: 'CATALOG' };
  return {
    prices: new Map(data.prices.map((row) => [row.productId, row.unitPrice])),
    basis: data.basis,
  };
}

/** The depot's price when it has one for this product, otherwise the catalogue price. */
export function priceOf(product: { id: string; basePrice: number }, depot: DepotPrices): number {
  return depot.prices.get(product.id) ?? product.basePrice;
}
