'use client';

import { DetailRow, DetailSheet } from '@/components/detail-sheet';
import { Chip } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { Supplier } from '@/lib/types';

/**
 * One supplier.
 *
 * `GET /procurement/api/v1/suppliers/:id` was left unwired as "suppliers are listed and
 * created, never opened by id" — a description of the UI rather than a decision about it.
 * The list shows a name and a code; `onTimeRate`, the number that decides whether to order
 * from them again, was only ever in the row nobody could open.
 */
export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const { t } = useT();
  return (
    <DetailSheet<Supplier>
      load={() => api.get<Supplier>(endpoints.procurement.suppliers.detail(supplierId), true)}
      deps={[supplierId]}
      errorMessage={t('opsFix.suppliers.detailError')}
    >
      {(supplier) => (
        <div className="divide-y divide-[color:var(--border-soft)]">
          <DetailRow label={t('opsFix.suppliers.detailCode')}>{supplier.code}</DetailRow>
          <DetailRow label={t('opsFix.suppliers.detailPhone')}>
            {supplier.contactPhone ?? '—'}
          </DetailRow>
          <DetailRow label={t('opsFix.suppliers.detailCategories')}>
            {supplier.categories.length === 0 ? (
              '—'
            ) : (
              <span className="flex flex-wrap justify-end gap-1">
                {supplier.categories.map((c) => (
                  <Chip key={c} tone="outline">
                    {c}
                  </Chip>
                ))}
              </span>
            )}
          </DetailRow>
          {/*
            null is not zero. A supplier with no completed purchase orders has no on-time
            rate yet, and printing "0%" would read as a supplier that has never once
            delivered on time — the opposite of "we do not know".
          */}
          <DetailRow label={t('opsFix.suppliers.detailOnTime')}>
            {supplier.onTimeRate === null
              ? t('opsFix.suppliers.detailOnTimeUnknown')
              : `${Math.round(supplier.onTimeRate * 100)}%`}
          </DetailRow>
          <DetailRow label={t('opsFix.suppliers.detailSince')}>
            {formatDateTime(supplier.createdAt)}
          </DetailRow>
        </div>
      )}
    </DetailSheet>
  );
}
