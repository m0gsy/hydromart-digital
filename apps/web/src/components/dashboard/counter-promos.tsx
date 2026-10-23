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
export function CounterPromoStrip({
  rules,
  productName,
}: {
  rules: readonly PromoRule[];
  productName: (id: string) => string | undefined;
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
        {rules.map((r) => (
          <li key={r.id} className="text-sm">
            <span className="font-semibold">{r.name}</span>
            <span className="text-muted"> — {describeCounterPromo(r, t, productName)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
