'use client';

import { Badge } from '@/components/ui';
import { formatDate, formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { voucherState } from '@/lib/voucher-form';
import type { Voucher } from '@/lib/types';

const STATE_TONE = {
  active: 'success',
  upcoming: 'brand',
  expired: 'neutral',
  inactive: 'neutral',
} as const;

/**
 * What a voucher is, in one block: shared by head office's list and the depot console's.
 *
 * The depot list built its own line out of hard-coded Indonesian ("terpakai", "min Rp",
 * "Gratis ongkir (maks Rp …)") and said nothing about when a code runs or who may use it; head
 * office's said nothing about product scope. Both now read the same facts the same way.
 *
 * `burned`, when given, is the rupiah the code has discounted so far (head office reads it from
 * the burn summary); with a budget it becomes a bar, the only place a bar means something.
 */
export function VoucherSummary({
  voucher: v,
  depotName,
  burned,
}: {
  voucher: Voucher;
  depotName: (id: string) => string;
  burned?: number;
}) {
  const { t } = useT();
  const L = (k: string, vars?: Record<string, string | number>) => t(`hq.vouchers.list.${k}`, vars);
  const F = (k: string) => t(`hq.forms.voucher.${k}`);
  const state = voucherState(v);
  const discount =
    v.discountType === 'FREE_SHIPPING'
      ? F('freeShip')
      : v.discountType === 'PERCENTAGE'
        ? `${v.value}%${v.maxDiscount ? ` · ${F('maxDiscount')} ${formatIDR(v.maxDiscount)}` : ''}`
        : formatIDR(v.value);
  const when =
    v.validFrom && v.validUntil
      ? L('validRange', { from: formatDate(v.validFrom), to: formatDate(v.validUntil) })
      : v.validFrom
        ? L('validFrom', { from: formatDate(v.validFrom) })
        : v.validUntil
          ? L('validUntil', { to: formatDate(v.validUntil) })
          : null;
  const cap = v.budgetCap ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{v.code}</span>
        <Badge tone={STATE_TONE[state]}>{L(`state${state.charAt(0).toUpperCase()}${state.slice(1)}`)}</Badge>
        <Badge tone="neutral">{L(v.audience === 'GRANTED' ? 'granted' : 'public')}</Badge>
        <Badge tone="neutral">{v.depotId ? depotName(v.depotId) : L('allDepots')}</Badge>
        {(v.productId || v.categoryId) && <Badge tone="neutral">{F('scopedBadge')}</Badge>}
      </p>
      {v.description && <p className="truncate text-sm text-muted">{v.description}</p>}
      <p className="text-sm">
        {discount}
        {v.minSpend > 0 && ` · ${F('minOrder')} ${formatIDR(v.minSpend)}`}
      </p>
      {when && <p className="text-xs text-muted">{when}</p>}
      <p className="text-xs text-muted">
        {v.usageLimit != null ? L('usedOf', { n: v.usedCount, limit: v.usageLimit }) : L('used', { n: v.usedCount })}
      </p>
      {burned !== undefined &&
        (cap != null && cap > 0 ? (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${Math.min(100, Math.round((burned / cap) * 100))}%` }}
              />
            </div>
            <p className="text-xs text-muted">{L('budgetOf', { used: formatIDR(burned), cap: formatIDR(cap) })}</p>
          </>
        ) : (
          <p className="text-xs text-muted">
            {L('burn')}: {formatIDR(burned)} · {L('noBudget')}
          </p>
        ))}
    </div>
  );
}
