'use client';

import { Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

interface TaxPreview {
  amount: number;
  percent: number | null;
}

/**
 * FR-034: "Sudah termasuk PPN 11%" under a total the customer is about to pay.
 *
 * The server does the arithmetic — the same function checkout records on the order — so the
 * figure read here is the one stored. Prices already include PPN, so this only explains the total
 * and never changes it. It says nothing when there is no PPN or the read fails: a missing note is
 * not a reason to stop somebody paying.
 */
export function TaxPreviewLine({ total }: { total: number }) {
  const { t } = useT();
  const preview = useAsync<TaxPreview | null>(
    () =>
      total > 0
        ? api.get<TaxPreview>(endpoints.orders.taxPreview(total), true).catch(() => null)
        : Promise.resolve(null),
    [total],
  );
  if (!preview.data || preview.data.amount <= 0) return null;
  return (
    <div className="flex justify-between text-xs text-muted">
      <span>{t('order.detail.taxIncluded', { pct: preview.data.percent ?? 0 })}</span>
      <Money amount={preview.data.amount} />
    </div>
  );
}
