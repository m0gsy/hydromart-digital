'use client';

import { DetailRow, DetailSheet } from '@/components/detail-sheet';
import { Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { Delivery } from '@/lib/types';

/**
 * One delivery, read by staff.
 *
 * `GET /deliveries/api/v1/deliveries/:id` was the only one of the five orphan routes with
 * no written reason — recorded, never decided. It carries its own authorisation
 * (`assertDepotAccess`, commented "close the by-id vector"), the courier side has the same
 * route and a screen, and the dispatcher tracing one late delivery had nothing to open.
 */
export function DeliveryDetail({ deliveryId }: { deliveryId: string }) {
  const { t } = useT();
  return (
    <DetailSheet<Delivery>
      load={() => api.get<Delivery>(endpoints.deliveries.detail(deliveryId), true)}
      deps={[deliveryId]}
      errorMessage={t('dashC.tracking.detailError')}
    >
      {(d) => (
        <div className="divide-y divide-[color:var(--border-soft)]">
          <DetailRow label={t('dashC.tracking.detailOrder')}>{d.orderNumber}</DetailRow>
          <DetailRow label={t('dashC.tracking.detailStatus')}>
            {t(`delivery.status.${d.status}`)}
          </DetailRow>
          <DetailRow label={t('dashC.tracking.detailAddress')}>{d.destinationAddress}</DetailRow>
          <DetailRow label={t('dashC.tracking.detailPhone')}>{d.recipientPhone ?? '—'}</DetailRow>
          {/*
            COD is the field a dispatcher is usually calling about. `null` and `0` both mean
            "no cash to collect", and saying "Rp 0" for a non-COD delivery would have
            somebody asking a courier for money that was never owed.
          */}
          <DetailRow label={t('dashC.tracking.detailCod')}>
            {d.codAmount ? <Money amount={d.codAmount} /> : t('dashC.tracking.detailNoCod')}
          </DetailRow>
          <DetailRow label={t('dashC.tracking.detailAssigned')}>
            {formatDateTime(d.assignedAt)}
          </DetailRow>
        </div>
      )}
    </DetailSheet>
  );
}
