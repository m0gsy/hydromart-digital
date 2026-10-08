import { Inject, Injectable } from '@nestjs/common';
import { money } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { ProductUnavailableError } from '../../domain/errors';
import { applyPromoQuote } from '../../domain/promo-adjustment';
import { DepotPrice, priceLines, resellerApplies, resellerDiscountFor } from '../../domain/pricing';
import { CartItemRecord, CartRepository } from '../ports/cart.repository';
import { OrderRepository } from '../ports/order.repository';
import { DepotPricingPort } from '../ports/depot-pricing.port';
import { CatalogProduct, ProductCatalogPort } from '../ports/product-catalog.port';
import { AutoApplyGift, PromoAutoApplyPort } from '../ports/promo-auto-apply.port';
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
  /**
   * CA-3-23: lines dropped because their product is delisted or gone.
   *
   * The comment beside the filter has always said these are "surfaced as unavailable
   * rather than priced". They were not surfaced anywhere: the row vanished from the
   * customer's cart between one visit and the next, with no message and no trace, and the
   * only sign was a total that had gone down.
   *
   * Empty on the overwhelming majority of reads, so this costs nothing to carry.
   */
  removed: CartRemovedLineView[];
  /** Null when no promo applies, no depot was named, or promo-service could not be reached. */
  promo: CartPromoView | null;
}

/**
 * What the automatic promo rules would take off this basket (item 5). Checkout applies them
 * regardless; this exists so the cart shows the SAME total instead of a higher one that
 * quietly drops at the button. Lines in `items` stay at their pre-promo price.
 */
export interface CartPromoView {
  /** Basket subtotal after promos — what checkout will bill for the goods. */
  subtotal: number;
  /** Rupiah the promos take off (pre-promo subtotal minus `subtotal`). */
  savings: number;
  /** Only the lines a promo touched. */
  lines: { productId: string; unitPriceAfter: number; freeQty: number }[];
  /** A SHIPPING_DISCOUNT's per-galon fee, before checkout caps it at the depot's own. */
  shippingFeeOverride: number | null;
  /** ORDER_DISCOUNT: rupiah off the goods once the post-promo subtotal reaches its minimum. */
  orderDiscount: number;
  /**
   * BUNDLE_GIFT: free products the basket earns. Whether the depot has them in stock is only
   * known at checkout, where a gift it cannot cover is dropped rather than failing the order.
   */
  gifts: { productId: string; productName: string; quantity: number }[];
}

/** A cart line that can no longer be sold, named so the customer can be told which. */
export interface CartRemovedLineView {
  productId: string;
  /** The catalogue's name if it still has a row; null when the product is gone entirely. */
  productName: string | null;
  quantity: number;
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
    @Inject(ORDER_TOKENS.PromoAutoApply) private readonly promoAutoApply: PromoAutoApplyPort,
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
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
    // CA-3-23: kept, not counted. These are not priced and not billed; they exist so the
    // screen can say a word about the row that disappeared.
    const removed: CartRemovedLineView[] = rows
      .filter((r) => products.get(r.productId)?.active !== true)
      .map((r) => ({
        productId: r.productId,
        productName: products.get(r.productId)?.name ?? null,
        quantity: r.quantity,
      }));
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
    // Same quote, same skip rules and same fail-open as checkout, so the preview cannot
    // promise a price checkout then disagrees with. Needs a depot: rules are depot-scoped.
    let promo: CartPromoView | null = null;
    // What the discounts below are computed ON. Checkout takes the reseller percentage off
    // the POST-promo basket, so the preview must too or the two screens disagree.
    let billed: { items: typeof priced.items; subtotal: number } = priced;
    if (depotId && priced.items.length > 0) {
      const firstOrder = await this.isFirstOrder(customerId);
      const quote = await this.promoAutoApply.quote(
        depotId,
        'APP',
        priced.items.map((i) => ({
          productId: i.productId,
          categoryId: priced.categoryIdByProductId.get(i.productId) ?? null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          skipPromo: priced.tieredProductIds.has(i.productId),
        })),
        firstOrder,
      );
      const after = applyPromoQuote(priced.items, quote, priced.tieredProductIds);
      billed = after;
      const touched = after.appliedLines.filter((l) => l.appliedRuleIds.length > 0 || l.freeQty > 0);
      const orderDiscount = Math.min(Math.max(0, quote.orderDiscountAmount ?? 0), after.subtotal);
      const gifts = await this.resolveGifts(quote.gifts ?? []);
      if (touched.length > 0 || quote.shippingFeeOverride != null || orderDiscount > 0 || gifts.length > 0) {
        promo = {
          subtotal: after.subtotal,
          savings: money(priced.subtotal - after.subtotal),
          lines: touched.map((l) => ({
            productId: l.productId,
            unitPriceAfter: l.unitPriceAfter,
            freeQty: l.freeQty,
          })),
          shippingFeeOverride: quote.shippingFeeOverride ?? null,
          orderDiscount,
          gifts,
        };
      }
    }

    const applies = resellerApplies(reseller, depotId);
    const basis: PricingBasis = pricingDepotId && !lookup.unavailable ? 'DEPOT' : 'CATALOG';
    return {
      items,
      removed,
      promo,
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
                      billed.items,
                      billed.subtotal,
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

  /** Same definition as checkout's: no earlier active/completed order; unknown means not new. */
  private async isFirstOrder(customerId: string): Promise<boolean> {
    try {
      return (await this.orders.customerLifetime(customerId)).orderCount === 0;
    } catch {
      return false;
    }
  }

  /** Gift products the customer can see by name; one that cannot be read is simply not shown. */
  private async resolveGifts(
    gifts: AutoApplyGift[],
  ): Promise<{ productId: string; productName: string; quantity: number }[]> {
    if (gifts.length === 0) return [];
    const quantity = new Map<string, number>();
    for (const g of gifts) quantity.set(g.productId, (quantity.get(g.productId) ?? 0) + g.quantity);
    try {
      const products = await this.catalog.getProducts([...quantity.keys()]);
      return [...quantity].flatMap(([productId, qty]) => {
        const product = products.get(productId);
        return product && product.active ? [{ productId, productName: product.name, quantity: qty }] : [];
      });
    } catch {
      return [];
    }
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
