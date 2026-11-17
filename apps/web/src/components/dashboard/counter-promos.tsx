'use client';

import { Card } from '@/components/ui';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { PromoRule } from '@/lib/types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * One line a cashier can read out loud: what the rule does, then where and when it holds.
 * Pure so the wording is testable without a render.
 */
export function describeCounterPromo(
  r: PromoRule,
  t: Translate,
  productName: (id: string) => string | undefined,
): string {
  const n = (v: number | null) => v ?? 0;
  let what: string;
  switch (r.kind) {
    case 'SPECIAL_PRICE':
      what = t('opsFix.walkIn.promoSpecialPrice', { price: formatIDR(n(r.specialPrice)) });
      break;
    case 'PERCENTAGE_OFF':
      what = t('opsFix.walkIn.promoPercentOff', { pct: n(r.percentOff) });
      break;
    case 'BUY_X_GET_Y':
      what = t('opsFix.walkIn.promoBuyGet', { buy: n(r.buyQty), get: n(r.getQty) });
      break;
    case 'BUNDLE_GIFT':
      what = t('opsFix.walkIn.promoBundleGift', { buy: n(r.buyQty), get: n(r.getQty) });
      break;
    case 'ORDER_DISCOUNT':
      what =
        r.percentOff !== null
          ? t('opsFix.walkIn.promoOrderPercent', {
              pct: r.percentOff,
              min: formatIDR(n(r.minSubtotal)),
            })
          : t('opsFix.walkIn.promoOrderAmount', {
              amount: formatIDR(n(r.discountAmount)),
              min: formatIDR(n(r.minSubtotal)),
            });
      break;
    case 'SHIPPING_DISCOUNT':
      what = t('opsFix.walkIn.promoShipping', { fee: formatIDR(n(r.shippingFeeOverride)) });
      break;
  }

  const parts = [what];
  const product = r.productId ? productName(r.productId) : undefined;
  if (product) parts.push(product);
  if (r.minQty > 1) parts.push(t('opsFix.walkIn.promoMinQty', { qty: r.minQty }));
  if (r.endTime) parts.push(t('opsFix.walkIn.promoUntil', { time: r.endTime }));
  if (r.firstOrderOnly) parts.push(t('opsFix.walkIn.promoFirstOrder'));
  return parts.join(' · ');
}

/**
 * The promos this counter would apply right now. Informational only: the server applies
 * them when the basket is priced, so the cashier has nothing to tick — the strip exists so
 * they can tell a buyer what is running before the buyer asks.
 *
 * Renders nothing when there is nothing to say, including when the list failed to load: a
 * strip that errors must not get in the way of ringing up a sale.
 */
/** What the till knows about the basket when it suggests "a little more". */
export interface NudgeBasket {
  qtyOf: (productId: string) => number;
  /** The server's subtotal for this basket, or null while it is being priced. */
  subtotal: number | null;
}

/**
 * The one sentence a cashier can say to sell a little more: "tambah 1 lagi, gratis 1".
 *
 * Only for a promo the basket is close to and has not reached, and only where the rule says
 * exactly what is missing — a product quantity, or an order subtotal. Rules tied to a
 * category or to a new buyer are left to the strip's own description: guessing would make the
 * cashier promise something the server then does not give.
 */
export function counterPromoNudge(
  r: PromoRule,
  basket: NudgeBasket,
  t: Translate,
  productName: (id: string) => string | undefined,
): string | null {
  if (r.firstOrderOnly) return null;
  if (r.kind === 'ORDER_DISCOUNT') {
    const min = r.minSubtotal ?? 0;
    if (basket.subtotal === null || basket.subtotal <= 0 || basket.subtotal >= min) return null;
    return t('opsFix.walkIn.nudgeSpendMore', {
      amount: formatIDR(min - basket.subtotal),
      promo: r.name,
    });
  }
  if (!r.productId) return null;
  const q = basket.qtyOf(r.productId);
  if (q === 0) return null;
  const name = productName(r.productId) ?? r.name;
  let need = 0;
  if (r.kind === 'BUY_X_GET_Y' || r.kind === 'BUNDLE_GIFT') {
    if (!r.buyQty || !r.getQty) return null;
    // Short of the minimum, or short of the next bonus: whichever is further.
    need = Math.max(
      r.minQty - q,
      q < r.buyQty ? r.buyQty - q : (r.buyQty - (q % r.buyQty)) % r.buyQty,
    );
  } else if (r.kind === 'SPECIAL_PRICE' || r.kind === 'PERCENTAGE_OFF') {
    need = r.minQty - q;
  }
  if (need <= 0) return null;
  if (r.maxQty !== null && q + need > r.maxQty) return null;
  return t('opsFix.walkIn.nudgeAddMore', { n: need, name, promo: r.name });
}

export function CounterPromoStrip({
  rules,
  productName,
  appliedIds = new Set<string>(),
  basket,
}: {
  rules: readonly PromoRule[];
  productName: (id: string) => string | undefined;
  /** Rules the server applied to THIS basket (fresh quote only). */
  appliedIds?: ReadonlySet<string>;
  basket?: NudgeBasket;
}) {
  const { t } = useT();
  if (rules.length === 0) return null;
  return (
    <Card className="space-y-2 p-3" testId="counter-promo-strip">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{t('opsFix.walkIn.promoStripTitle')}</span>
        <span className="text-[11.5px] text-muted">{t('opsFix.walkIn.promoStripHint')}</span>
      </div>
      <ul className="space-y-1.5">
        {rules.map((r) => {
          const applied = appliedIds.has(r.id);
          const nudge = !applied && basket ? counterPromoNudge(r, basket, t, productName) : null;
          return (
            <li key={r.id} className="text-sm">
              <span className="font-semibold">{r.name}</span>
              {applied && (
                <span className="ml-1.5 rounded-full bg-[color:var(--success-bg)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--success)]">
                  {t('opsFix.walkIn.promoApplied')}
                </span>
              )}
              <span className="text-muted"> — {describeCounterPromo(r, t, productName)}</span>
              {nudge && <p className="text-xs font-semibold text-brand-700">{nudge}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
