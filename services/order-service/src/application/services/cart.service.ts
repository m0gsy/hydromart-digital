import { Inject, Injectable } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { ProductUnavailableError } from '../../domain/errors';
import {
  DepotPrice,
  priceLines,
  resellerApplies,
  resellerDiscountFor,
} from '../../domain/pricing';
import { CartItemRecord, CartRepository } from '../ports/cart.repository';
import { DepotPricingPort } from '../ports/depot-pricing.port';
import { CatalogProduct, ProductCatalogPort } from '../ports/product-catalog.port';
import { ResellerDiscountPort } from '../ports/reseller-discount.port';
import { ORDER_TOKENS } from '../tokens';

/** A cart line enriched with live catalog data for display. */
export interface CartLineView {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /**
   * The catalog flag delivery is charged on, exposed so the checkout preview can count
   * galons the way `galonQuantity` in domain/pricing.ts does. Without it the web client had
   * to guess from the free-text `unit` label — the exact match that was removed here so a
   * label edit could not change what a customer is charged. A product flagged `isGallon`
   * but labelled "Botol 19L" previewed Rp0 ongkir and was then billed per galon.
   */
  isGallon: boolean;
  /** The catalogue photo, so the basket shows what the shop showed. Null = none. */
  imageUrl: string | null;
}

/**
 * A4: the agen price, as the order would apply it to THIS basket at THIS depot.
 *
 * The badge was already on the checkout screen. What was not there was the number: the
 * screen showed list price and a line reading "dihitung saat pesan", because the flat SOP
 * price applies per galon line and excludes wholesale-band lines, and the cart carried
 * neither fact. It carries both now, so the answer is computed once, here, by the same
 * function checkout bills with.
 */
export interface CartResellerView {
  /** A9: false when the agen is registered at a DIFFERENT depot than the one selling. */
  applies: boolean;
  discountPct: number;
  flatGallonPriceIdr: number;
  /**
   * Rupiah off this basket: 0 when `applies` is false, and `null` when these are catalog
   * prices rather than the depot's — a discount computed off the wrong prices is the very
   * thing A4 exists to stop, so the screen falls back to "dihitung saat pesan" instead.
   */
  discount: number | null;
}

/** Whose prices these are. Never guess on the customer's behalf. */
export type PricingBasis = 'DEPOT' | 'CATALOG';

export interface CartView {
  items: CartLineView[];
  subtotal: number;
  /** The depot this cart is being priced FOR, or null when the caller named none. */
  depotId: string | null;
  /**
   * `CATALOG` means exactly one thing: nobody could tell us the depot's own price, so
   * these are catalog base prices. It is stated rather than implied because the old cart
   * quietly served base prices as if they were the depot's, and the customer only found
   * out at the receipt.
   */
  pricingBasis: PricingBasis;
  /** Null when the caller is not an agen (or could not be checked). */
  reseller: CartResellerView | null;
}

/**
 * Manages a customer's active cart.
 *
 * Prices here are the SAME prices checkout bills: the depot's own row, its active pricing
 * rule and any matching wholesale band, resolved through `priceLines` in domain/pricing.ts
 * — one function, two callers (A1).
 *
 * A standing comment used to sit here saying pricing was "advisory — the authoritative
 * price is re-resolved at checkout". That defence does not survive contact with what the
 * code did. Advisory covers a price that MOVED between the cart and the button; it does
 * not cover a price that was never the price, computed from a different rule. This service
 * read `product.basePrice`, checkout read the depot's row, and on this repo's own stack a
 * galon at a depot with a live +10% rule was quoted Rp20.000 and billed Rp22.000 — not
 * staleness, a second pricing rule. Staleness is still real and still fine: checkout
 * re-resolves, and the price can legitimately have changed in between.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(ORDER_TOKENS.CartRepository) private readonly cart: CartRepository,
    @Inject(ORDER_TOKENS.ProductCatalog) private readonly catalog: ProductCatalogPort,
    @Inject(ORDER_TOKENS.DepotPricing) private readonly depotPricing: DepotPricingPort,
    @Inject(ORDER_TOKENS.ResellerDiscount) private readonly reseller: ResellerDiscountPort,
    private readonly config: OrderConfigService,
  ) {}

  /** Add `quantity` to the line, or set it when `absolute` is true. */
  async setItem(
    customerId: string,
    productId: string,
    quantity: number,
    absolute: boolean,
    depotId: string | null = null,
    authorization = '',
  ): Promise<CartView> {
    const product = await this.catalog.getProduct(productId);
    if (!product || !product.active) {
      throw new ProductUnavailableError(productId);
    }
    const existing = absolute ? null : await this.cart.findItem(customerId, productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    await this.cart.upsert(customerId, productId, nextQuantity);
    return this.view(customerId, depotId, authorization);
  }

  async removeItem(
    customerId: string,
    productId: string,
    depotId: string | null = null,
    authorization = '',
  ): Promise<CartView> {
    await this.cart.remove(customerId, productId);
    return this.view(customerId, depotId, authorization);
  }

  async clear(customerId: string): Promise<void> {
    await this.cart.clear(customerId);
  }

  /**
   * The cart as the customer sees it, priced at `depotId` when one is known (A2).
   *
   * Fails OPEN exactly like checkout does: an unreachable depot-service serves catalog
   * base prices rather than an empty cart — but says so through `pricingBasis`, so the
   * screen is never in a position to present them as the depot's.
   */
  async view(
    customerId: string,
    depotId: string | null = null,
    authorization = '',
  ): Promise<CartView> {
    const rows = await this.cart.findByCustomer(customerId);
    // The kill switch. Off = this service prices from the catalog as it always did, and
    // checkout is unaffected because checkout never asked this cart for a price.
    const pricingDepotId = depotId && this.config.cartDepotPricing(depotId) ? depotId : null;

    const [products, lookup, reseller] = await Promise.all([
      this.resolveAll(rows),
      pricingDepotId
        ? this.depotPricing.getPrices(
            pricingDepotId,
            rows.map((r) => r.productId),
            rows.map((r) => r.quantity),
          )
        : Promise.resolve({ prices: new Map<string, DepotPrice>(), unavailable: false }),
      // Fail-open and quiet: a cart is a preview, and an agen whose status could not be
      // read still sees list price — which is what they saw before this existed.
      // A5: the cart preview only needs the pricing, not the reason — there is no order yet
      // to write a note on. `?? null` collapses both "not an agen" and "could not read" back
      // to no agen price, which is the same fail-open the preview always had.
      authorization
        ? this.reseller
            .get(authorization)
            .then((r) => r.reseller)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    // Stale lines (product delisted) are surfaced as unavailable rather than priced, so
    // they are dropped before pricing rather than filtered out of it.
    const live = rows.filter((r) => products.get(r.productId)?.active === true);
    const priced = priceLines(live, products, lookup.prices);

    const items: CartLineView[] = priced.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      unit: i.unit,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
      isGallon: i.isGallon,
      imageUrl: products.get(i.productId)?.imageUrl ?? null,
    }));

    // A9 asks the DEPOT question, not the pricing-switch question: turning the switch off
    // must not hand cross-depot agen badges back, so this reads `depotId`, not the one the
    // switch may have blanked.
    const applies = resellerApplies(reseller, depotId);
    const basis: PricingBasis = pricingDepotId && !lookup.unavailable ? 'DEPOT' : 'CATALOG';
    return {
      items,
      subtotal: priced.subtotal,
      depotId,
      pricingBasis: basis,
      reseller: reseller
        ? {
            applies,
            discountPct: reseller.discountPct,
            flatGallonPriceIdr: reseller.flatGallonPriceIdr,
            discount:
              basis === 'CATALOG'
                ? null
                : applies
                  ? resellerDiscountFor(
                      reseller,
                      priced.items,
                      priced.subtotal,
                      priced.tieredProductIds,
                      priced.tierPricedTotal,
                    )
                  : 0,
          }
        : null,
    };
  }


  /**
   * The price a shopper should SEE for these products at this depot (PG-03).
   *
   * The catalogue grid and the product page printed `product.basePrice` while this service
   * and checkout priced every line against the depot: Rp20.000 on the shelf, Rp22.000 on the
   * bill, at any depot with a live pricing rule. Not staleness — a different rule.
   *
   * Deliberately the SAME `priceLines` the cart is billed through, at quantity 1, rather
   * than arithmetic in the browser: a second implementation of the price is exactly how the
   * two screens came to disagree. Wholesale bands are not applied here because a shelf price
   * has no quantity yet; the cart applies them the moment there is one.
   *
   * Fails OPEN like the cart, and says which: `CATALOG` means nobody could tell us the
   * depot's price, so the screen must label what it shows instead of passing it off.
   */
  async shelfPrices(
    depotId: string | null,
    productIds: string[],
  ): Promise<{ basis: PricingBasis; prices: { productId: string; unitPrice: number }[] }> {
    const ids = [...new Set(productIds.filter((id) => id.length > 0))];
    if (ids.length === 0) return { basis: 'CATALOG', prices: [] };

    const pricingDepotId = depotId && this.config.cartDepotPricing(depotId) ? depotId : null;
    const rows = ids.map((productId) => ({ productId, quantity: 1 }) as CartItemRecord);
    const [products, lookup] = await Promise.all([
      this.resolveAll(rows),
      pricingDepotId
        ? this.depotPricing.getPrices(pricingDepotId, ids)
        : Promise.resolve({ prices: new Map<string, DepotPrice>(), unavailable: false }),
    ]);

    const live = rows.filter((r) => products.get(r.productId)?.active === true);
    const priced = priceLines(live, products, lookup.prices);

    return {
      basis: pricingDepotId && !lookup.unavailable ? 'DEPOT' : 'CATALOG',
      prices: priced.items.map((i) => ({ productId: i.productId, unitPrice: i.unitPrice })),
    };
  }

  private async resolveAll(rows: CartItemRecord[]): Promise<Map<string, CatalogProduct>> {
    const entries = await Promise.all(
      rows.map(async (r) => [r.productId, await this.catalog.getProduct(r.productId)] as const),
    );
    const map = new Map<string, CatalogProduct>();
    for (const [id, product] of entries) {
      if (product) {
        map.set(id, product);
      }
    }
    return map;
  }
}
