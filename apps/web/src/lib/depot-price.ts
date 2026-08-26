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
  /**
   * Whether a depot was known at all.
   *
   * Three states, not two: prices from the depot; prices we could not get FROM a known
   * depot (say so — the bill will differ); and no depot chosen yet, where the catalogue
   * price is simply what a shopper who has not said where they are gets, and labelling it
   * would be noise on every first visit.
   */
  depotKnown: boolean;
}

/** The depot's price for each id, or CATALOG basis when it cannot be established. */
export function useDepotPrices(productIds: string[]): DepotPrices {
  const { location } = useLocation();
  const depotId = location?.depotId ?? null;
  // Sorted + joined so a re-render with the same ids in a different order is not a new read.
  const key = [...new Set(productIds)].sort().join(',');

  /*
   * No depot, no call. With none chosen the server can only answer with catalogue prices,
   * which is exactly what `product.basePrice` already is — so asking costs the catalogue
   * page a network request to be told what it already had. The Lighthouse ratchet caught
   * that on the first run of this change (/products: 49 requests against a 48 ceiling),
   * which is the ratchet doing its job.
   */
  const { data } = useAsync<{ basis: PriceBasis; prices: ShelfPrice[] } | null>(
    () =>
      depotId && key.length > 0
        ? api
            .getCached<{ basis: PriceBasis; prices: ShelfPrice[] }>(
              endpoints.cart.shelfPrices(key.split(','), depotId),
            )
            .catch(() => null)
        : Promise.resolve(null),
    [depotId, key],
  );

  // No answer, or an answer in a shape this does not recognise, is CATALOG: the caller
  // labels what it shows rather than passing a catalogue price off as the depot's. Shape-
  // checked rather than trusted because a price screen must not be a screen that can crash.
  if (!data || !Array.isArray(data.prices)) {
    return { prices: new Map(), basis: 'CATALOG', depotKnown: Boolean(depotId) };
  }
  return {
    prices: new Map(data.prices.map((row) => [row.productId, row.unitPrice])),
    basis: data.basis === 'DEPOT' ? 'DEPOT' : 'CATALOG',
    depotKnown: true,
  };
}

/** The depot's price when it has one for this product, otherwise the catalogue price. */
export function priceOf(product: { id: string; basePrice: number }, depot: DepotPrices): number {
  return depot.prices.get(product.id) ?? product.basePrice;
}
